import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type GpuRenderJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface GpuRenderJob {
  id: string;
  project_id: string;
  user_id: string;
  status: GpuRenderJobStatus;
  progress: number;
  video_url: string | null;
  error_message: string | null;
  payload: Record<string, any>;
  worker_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UseGpuRenderJobsOptions {
  projectId: string | null;
  onJobComplete?: (job: GpuRenderJob) => void;
  onJobFailed?: (job: GpuRenderJob) => void;
}

export function useGpuRenderJobs({ projectId, onJobComplete, onJobFailed }: UseGpuRenderJobsOptions) {
  const [activeJobs, setActiveJobs] = useState<GpuRenderJob[]>([]);
  const [allJobs, setAllJobs] = useState<GpuRenderJob[]>([]);
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
          .from('gpu_render_jobs')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('❌ Error fetching GPU render jobs:', error);
          setAllJobs([]);
          setActiveJobs([]);
          return;
        }
        
        const jobs = (data || []) as GpuRenderJob[];
        console.log('📥 Initial fetch - GPU render jobs:', jobs.length);
        setAllJobs(jobs);
        const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
        console.log('📥 Initial fetch - active GPU jobs:', active.length);
        setActiveJobs(active);
      } catch (error) {
        console.error('Error fetching GPU render jobs:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    doInitialFetch();
  }, [projectId]);

  // Subscribe to realtime updates for GPU jobs
  useEffect(() => {
    if (!projectId) return;

    // Subscribe to realtime updates
    console.log('[GPU] Setting up realtime subscription for project:', projectId);
    const channel = supabase
      .channel(`gpu-render-jobs-${projectId}`, {
        config: {
          broadcast: { self: true },
        },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gpu_render_jobs',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          const job = payload.new as GpuRenderJob;
          console.log('🔔 [GPU] Realtime update for GPU render job:', payload.eventType, job.id, job.status, job.progress, 'current_step:', job.current_step);
          
          if (payload.eventType === 'INSERT') {
            console.log('✅ [GPU] New GPU render job inserted:', job.id);
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
            console.log('🔄 [GPU] Job updated:', job.id, 'status:', job.status, 'progress:', job.progress, 'current_step:', job.current_step);
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
            console.log('❌ [GPU] Job deleted:', job.id);
            setAllJobs(prev => prev.filter(j => j.id !== job.id));
            setActiveJobs(prev => prev.filter(j => j.id !== job.id));
          }
        }
      )
      .subscribe((status) => {
        console.log('[GPU] Realtime subscription status:', status);
      });

    return () => {
      console.log('[GPU] Cleaning up realtime subscription');
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
        .from('gpu_render_jobs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[GPU] Error refreshing jobs:', error);
        return;
      }
      
      const jobs = (data || []) as GpuRenderJob[];
      console.log('🔄 [GPU] Refreshed jobs:', jobs.length);
      setAllJobs(jobs);
      const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
      setActiveJobs(active);
    } catch (error) {
      console.error('[GPU] Error refreshing jobs:', error);
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
