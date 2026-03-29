import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type GpuRenderJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface GpuRenderJob {
  id: string;
  project_id: string;
  user_id: string;
  status: GpuRenderJobStatus;
  progress: number;
  current_step: string | null;
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

  const activeJobsRef = useRef(activeJobs);
  useEffect(() => { activeJobsRef.current = activeJobs; }, [activeJobs]);

  // Initial fetch on mount + periodic refresh for new jobs
  useEffect(() => {
    if (!projectId) return;

    const doFetch = async (isInitial = false) => {
      try {
        if (isInitial) setIsLoading(true);
        const { data, error } = await supabase
          .from('gpu_render_jobs')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[GPU] Error fetching jobs:', error);
          return;
        }
        
        const jobs = (data || []) as GpuRenderJob[];
        setAllJobs(jobs);
        const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');

        setActiveJobs(prev => {
          const prevCompleted = prev.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');
          for (const done of prevCompleted) {
            const fresh = jobs.find(j => j.id === done.id);
            if (fresh?.status === 'completed' && onJobCompleteRef.current) onJobCompleteRef.current(fresh);
            if (fresh?.status === 'failed' && onJobFailedRef.current) onJobFailedRef.current(fresh);
          }
          return active;
        });
      } catch (error) {
        console.error('[GPU] Error fetching jobs:', error);
      } finally {
        if (isInitial) setIsLoading(false);
      }
    };
    
    doFetch(true);
    const interval = setInterval(() => doFetch(false), 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Poll active jobs for progress updates (faster than the 5s refresh)
  useEffect(() => {
    if (!projectId || activeJobs.length === 0) return;

    const pollInterval = setInterval(async () => {
      const currentJobs = activeJobsRef.current;
      if (currentJobs.length === 0) return;

      try {
        const jobIds = currentJobs.map(j => j.id);
        const { data, error } = await supabase
          .from('gpu_render_jobs')
          .select('*')
          .in('id', jobIds);

        if (error || !data) return;

        for (const job of data) {
          const typed = job as GpuRenderJob;
          const existing = currentJobs.find(j => j.id === typed.id);
          if (!existing) continue;

          if (typed.status === 'completed' && existing.status !== 'completed') {
            onJobCompleteRef.current?.(typed);
            setActiveJobs(prev => prev.filter(j => j.id !== typed.id));
            setAllJobs(prev => prev.map(j => j.id === typed.id ? typed : j));
          } else if (typed.status === 'failed' && existing.status !== 'failed') {
            onJobFailedRef.current?.(typed);
            setActiveJobs(prev => prev.filter(j => j.id !== typed.id));
            setAllJobs(prev => prev.map(j => j.id === typed.id ? typed : j));
          } else if (typed.status === 'cancelled') {
            setActiveJobs(prev => prev.filter(j => j.id !== typed.id));
            setAllJobs(prev => prev.map(j => j.id === typed.id ? typed : j));
          } else if (typed.progress !== existing.progress || typed.current_step !== existing.current_step || typed.status !== existing.status) {
            setActiveJobs(prev => prev.map(j => j.id === typed.id ? typed : j));
            setAllJobs(prev => prev.map(j => j.id === typed.id ? typed : j));
          }
        }
      } catch (error) {
        console.error('[GPU] Polling error:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [projectId, activeJobs.length]);

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
