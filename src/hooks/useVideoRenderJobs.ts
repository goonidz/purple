import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type VideoRenderJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface VideoRenderJob {
  id: string;
  project_id: string;
  user_id: string;
  status: VideoRenderJobStatus;
  progress: number;
  job_id: string;
  status_url: string | null;
  video_url: string | null;
  file_size_mb: number | null;
  duration_seconds: number | null;
  error_message: string | null;
  steps: Array<{ message: string; timestamp: string }>;
  current_step: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface UseVideoRenderJobsOptions {
  projectId: string | null;
  onJobComplete?: (job: VideoRenderJob) => void;
  onJobFailed?: (job: VideoRenderJob) => void;
}

export function useVideoRenderJobs({ projectId, onJobComplete, onJobFailed }: UseVideoRenderJobsOptions) {
  const [activeJobs, setActiveJobs] = useState<VideoRenderJob[]>([]);
  const [allJobs, setAllJobs] = useState<VideoRenderJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Use refs to avoid stale closures
  const onJobCompleteRef = useRef(onJobComplete);
  const onJobFailedRef = useRef(onJobFailed);
  const projectIdRef = useRef(projectId);
  
  useEffect(() => {
    onJobCompleteRef.current = onJobComplete;
    onJobFailedRef.current = onJobFailed;
    projectIdRef.current = projectId;
  }, [onJobComplete, onJobFailed, projectId]);

  // Initial fetch on mount
  useEffect(() => {
    if (!projectId) return;

    const doInitialFetch = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('video_render_jobs')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('❌ Error fetching video render jobs:', error);
          setAllJobs([]);
          setActiveJobs([]);
          return;
        }
        
        const jobs = (data || []) as VideoRenderJob[];
        console.log('📥 Initial fetch - video render jobs:', jobs.length);
        setAllJobs(jobs);
        const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
        console.log('📥 Initial fetch - active jobs:', active.length);
        setActiveJobs(active);
      } catch (error) {
        console.error('Error fetching video render jobs:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    doInitialFetch();
  }, [projectId]);

  // Poll for job updates from VPS
  useEffect(() => {
    if (!projectId) return;

    const pollInterval = setInterval(async () => {
      // Fetch active jobs from database to ensure we have the latest
      const { data: activeJobsFromDb } = await supabase
        .from('video_render_jobs')
        .select('*')
        .eq('project_id', projectId)
        .in('status', ['pending', 'processing']);

      if (!activeJobsFromDb || activeJobsFromDb.length === 0) return;
      
      for (const job of activeJobsFromDb) {
        if (!job.status_url) continue;

        try {
          const response = await fetch(job.status_url);
          if (!response.ok) continue;
          
          const data = await response.json();
          
          // Always update progress, steps, and currentStep for real-time updates
          const updateData: any = {
            updated_at: new Date().toISOString(),
          };

          // Always update progress (even if same value) to trigger realtime
          if (data.progress !== undefined) {
            updateData.progress = data.progress;
          }
          if (data.status) {
            updateData.status = data.status;
          }
          if (data.videoUrl) {
            updateData.video_url = data.videoUrl;
          }
          if (data.fileSizeMB !== undefined) {
            updateData.file_size_mb = data.fileSizeMB;
          }
          if (data.duration !== undefined) {
            updateData.duration_seconds = data.duration;
          }
          if (data.steps) {
            updateData.steps = data.steps;
          }
          if (data.currentStep !== undefined) {
            updateData.current_step = data.currentStep;
          }
          if (data.error) {
            updateData.error_message = data.error;
          }
          if (data.status === 'completed' && !job.completed_at) {
            updateData.completed_at = new Date().toISOString();
          }
          if (data.status === 'failed' && !job.completed_at) {
            updateData.completed_at = new Date().toISOString();
          }

          // Always update to trigger realtime (even if values are the same)
          const { error: updateError } = await supabase
            .from('video_render_jobs')
            .update(updateData)
            .eq('id', job.id);
          
          if (updateError) {
            console.error('Error updating job in database:', updateError);
          } else {
            // Also update local state immediately for faster UI updates
            const updatedJob = { ...job, ...updateData } as VideoRenderJob;
            setAllJobs(prev => prev.map(j => j.id === job.id ? updatedJob : j));
            setActiveJobs(prev => {
              const updated = prev.map(j => j.id === job.id ? updatedJob : j);
              // Remove if completed or failed
              if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
                return updated.filter(j => j.id !== job.id);
              }
              // Update existing or add if not present
              if (!updated.find(j => j.id === job.id) && (updatedJob.status === 'pending' || updatedJob.status === 'processing')) {
                return [...updated, updatedJob];
              }
              return updated;
            });
          }
        } catch (error) {
          console.error('Error polling job status:', error);
        }
      }
    }, 1000); // Poll every 1 second for faster updates

    return () => clearInterval(pollInterval);
  }, [projectId]);

  // Subscribe to realtime updates for jobs
  useEffect(() => {
    if (!projectId) return;

    // Subscribe to realtime updates
    console.log('Setting up realtime subscription for project:', projectId);
    const channel = supabase
      .channel(`video-render-jobs-${projectId}`, {
        config: {
          broadcast: { self: true },
        },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'video_render_jobs',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          const job = payload.new as VideoRenderJob;
          console.log('🔔 Realtime update for video render job:', payload.eventType, job.id, job.status, job.progress);
          
          if (payload.eventType === 'INSERT') {
            console.log('✅ New video render job inserted:', job.id);
            setAllJobs(prev => {
              // Avoid duplicates
              if (prev.find(j => j.id === job.id)) return prev;
              return [job, ...prev];
            });
            if (job.status === 'pending' || job.status === 'processing') {
              setActiveJobs(prev => {
                // Avoid duplicates
                if (prev.find(j => j.id === job.id)) return prev;
                return [job, ...prev];
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            console.log('🔄 Job updated:', job.id, 'status:', job.status, 'progress:', job.progress, 'currentStep:', job.current_step);
            setAllJobs(prev => prev.map(j => j.id === job.id ? job : j));
            setActiveJobs(prev => {
              const updated = prev.map(j => j.id === job.id ? job : j);
              // Remove if completed, failed, or cancelled
              if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
                const filtered = updated.filter(j => j.id !== job.id);
                
                // Call callbacks
                if (job.status === 'completed' && onJobCompleteRef.current) {
                  onJobCompleteRef.current(job);
                } else if (job.status === 'failed' && onJobFailedRef.current) {
                  onJobFailedRef.current(job);
                }
                
                return filtered;
              }
              // Update existing or add if not present
              if (!updated.find(j => j.id === job.id) && (job.status === 'pending' || job.status === 'processing')) {
                return [...updated, job];
              }
              return updated;
            });
          } else if (payload.eventType === 'DELETE') {
            console.log('❌ Job deleted:', job.id);
            setAllJobs(prev => prev.filter(j => j.id !== job.id));
            setActiveJobs(prev => prev.filter(j => j.id !== job.id));
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const hasActiveJob = activeJobs.length > 0;

  const getJobById = useCallback((jobId: string) => {
    return allJobs.find(j => j.id === jobId);
  }, [allJobs]);

  const refreshJobs = useCallback(async () => {
    if (!projectId) return;
    
    try {
      const { data, error } = await supabase
        .from('video_render_jobs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error refreshing jobs:', error);
        return;
      }
      
      const jobs = (data || []) as VideoRenderJob[];
      console.log('🔄 Refreshed jobs:', jobs.length);
      setAllJobs(jobs);
      const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
      setActiveJobs(active);
    } catch (error) {
      console.error('Error refreshing jobs:', error);
    }
  }, [projectId]);

  return {
    activeJobs,
    allJobs,
    isLoading,
    hasActiveJob,
    getJobById,
    refreshJobs,
  };
}




