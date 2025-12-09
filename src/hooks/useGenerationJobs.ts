import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type JobType = 'transcription' | 'prompts' | 'images' | 'thumbnails' | 'test_images' | 'single_prompt' | 'single_image';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJob {
  id: string;
  project_id: string;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  progress: number;
  total: number;
  error_message: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface UseGenerationJobsOptions {
  projectId: string | null;
  onJobComplete?: (job: GenerationJob) => void;
  onJobFailed?: (job: GenerationJob) => void;
}

export function useGenerationJobs({ projectId, onJobComplete, onJobFailed }: UseGenerationJobsOptions) {
  const [activeJobs, setActiveJobs] = useState<GenerationJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Use refs to avoid stale closures
  const onJobCompleteRef = useRef(onJobComplete);
  const onJobFailedRef = useRef(onJobFailed);
  const activeJobsRef = useRef(activeJobs);
  
  useEffect(() => {
    onJobCompleteRef.current = onJobComplete;
    onJobFailedRef.current = onJobFailed;
  }, [onJobComplete, onJobFailed]);

  // Keep activeJobsRef in sync
  useEffect(() => {
    activeJobsRef.current = activeJobs;
  }, [activeJobs]);

  // Subscribe to realtime updates for jobs
  useEffect(() => {
    if (!projectId) return;

    // Initial fetch
    fetchActiveJobs();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`jobs-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'generation_jobs',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          console.log('Job update received:', payload);
          
          if (payload.eventType === 'INSERT') {
            const newJob = payload.new as GenerationJob;
            setActiveJobs(prev => {
              // Check if job already exists
              if (prev.find(j => j.id === newJob.id)) return prev;
              return [...prev, newJob];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedJob = payload.new as GenerationJob;
            
            setActiveJobs(prev => {
              // If job completed or failed, trigger callbacks and remove from active
              if (updatedJob.status === 'completed') {
                // Use ref to get latest callback
                onJobCompleteRef.current?.(updatedJob);
                return prev.filter(j => j.id !== updatedJob.id);
              } else if (updatedJob.status === 'failed') {
                onJobFailedRef.current?.(updatedJob);
                return prev.filter(j => j.id !== updatedJob.id);
              } else if (updatedJob.status === 'cancelled') {
                return prev.filter(j => j.id !== updatedJob.id);
              }
              
              // Update the job in the list
              return prev.map(j => j.id === updatedJob.id ? updatedJob : j);
            });
          } else if (payload.eventType === 'DELETE') {
            setActiveJobs(prev => prev.filter(j => j.id !== (payload.old as any).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  // Fallback polling when realtime doesn't work
  useEffect(() => {
    if (!projectId || activeJobs.length === 0) return;

    console.log('Starting polling fallback for', activeJobs.length, 'active jobs:', activeJobs.map(j => j.id));

    const pollInterval = setInterval(async () => {
      // Use ref to get current jobs to avoid stale closure
      const currentJobs = activeJobsRef.current;
      if (currentJobs.length === 0) return;

      try {
        const jobIds = currentJobs.map(j => j.id);
        console.log('Polling for jobs:', jobIds);
        
        const { data, error } = await supabase
          .from('generation_jobs')
          .select('*')
          .in('id', jobIds);

        if (error) {
          console.error('Polling error:', error);
          return;
        }
        
        if (!data || data.length === 0) {
          console.log('No jobs found in polling response');
          return;
        }

        console.log('Polling response:', data.map(j => ({ id: j.id, status: j.status })));

        data.forEach(job => {
          const typedJob = job as unknown as GenerationJob;
          const existingJob = currentJobs.find(j => j.id === typedJob.id);
          
          if (!existingJob) {
            console.log('Job not found in current jobs:', typedJob.id);
            return;
          }
          
          console.log(`Job ${typedJob.id}: existing status=${existingJob.status}, new status=${typedJob.status}`);
          
          // Check if status changed to completed or failed
          if (typedJob.status === 'completed' && existingJob.status !== 'completed') {
            console.log('Polling detected job completed:', typedJob.id);
            onJobCompleteRef.current?.(typedJob);
            setActiveJobs(prev => prev.filter(j => j.id !== typedJob.id));
          } else if (typedJob.status === 'failed' && existingJob.status !== 'failed') {
            console.log('Polling detected job failed:', typedJob.id);
            onJobFailedRef.current?.(typedJob);
            setActiveJobs(prev => prev.filter(j => j.id !== typedJob.id));
          } else if (typedJob.status === 'cancelled') {
            console.log('Polling detected job cancelled:', typedJob.id);
            setActiveJobs(prev => prev.filter(j => j.id !== typedJob.id));
          } else if (typedJob.status === 'processing' || typedJob.status === 'pending') {
            // Update progress without triggering re-render if nothing changed
            if (typedJob.progress !== existingJob.progress) {
              setActiveJobs(prev => prev.map(j => j.id === typedJob.id ? typedJob : j));
            }
          }
        });
      } catch (error) {
        console.error('Error polling job status:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => {
      console.log('Stopping polling fallback');
      clearInterval(pollInterval);
    };
  }, [projectId, activeJobs.length]); // Only depend on length to avoid infinite re-renders

  const fetchActiveJobs = useCallback(async () => {
    if (!projectId) return;

    try {
      const { data, error } = await supabase
        .from('generation_jobs')
        .select('*')
        .eq('project_id', projectId)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Type cast to handle the enum types
      setActiveJobs((data || []) as unknown as GenerationJob[]);
    } catch (error) {
      console.error('Error fetching active jobs:', error);
    }
  }, [projectId]);

  const startJob = useCallback(async (
    jobType: JobType, 
    metadata: Record<string, any> = {},
    overrideProjectId?: string
  ): Promise<{ jobId: string; total: number } | null> => {
    const targetProjectId = overrideProjectId || projectId;
    
    if (!targetProjectId) {
      toast.error("Aucun projet sélectionné");
      return null;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('start-generation-job', {
        body: { projectId: targetProjectId, jobType, metadata }
      });

      if (error) throw error;

      if (data.error) {
        if (data.existingJobId) {
          toast.info("Une génération est déjà en cours pour ce projet");
        } else {
          throw new Error(data.error);
        }
        return null;
      }

      toast.success(getJobStartMessage(jobType));
      
      // Immediately add the job to activeJobs so polling can start
      const newJob: GenerationJob = {
        id: data.jobId,
        project_id: targetProjectId,
        user_id: '',
        job_type: jobType,
        status: 'pending',
        progress: 0,
        total: data.total,
        error_message: null,
        metadata: metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null
      };
      
      setActiveJobs(prev => {
        if (prev.find(j => j.id === data.jobId)) return prev;
        return [...prev, newJob];
      });
      
      return { jobId: data.jobId, total: data.total };
    } catch (error: any) {
      console.error('Error starting job:', error);
      toast.error(error.message || "Erreur lors du démarrage de la génération");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'cancelled' })
        .eq('id', jobId);

      if (error) throw error;

      toast.info("Génération annulée");
      setActiveJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (error: any) {
      console.error('Error cancelling job:', error);
      toast.error("Erreur lors de l'annulation");
    }
  }, []);

  const getJobByType = useCallback((jobType: JobType): GenerationJob | undefined => {
    return activeJobs.find(j => j.job_type === jobType);
  }, [activeJobs]);

  const hasActiveJob = useCallback((jobType?: JobType): boolean => {
    if (jobType) {
      return activeJobs.some(j => j.job_type === jobType);
    }
    return activeJobs.length > 0;
  }, [activeJobs]);

  return {
    activeJobs,
    isLoading,
    startJob,
    cancelJob,
    fetchActiveJobs,
    getJobByType,
    hasActiveJob
  };
}

function getJobStartMessage(jobType: JobType): string {
  switch (jobType) {
    case 'transcription':
      return "Transcription démarrée en arrière-plan";
    case 'prompts':
      return "Génération des prompts démarrée en arrière-plan. Vous pouvez quitter cette page.";
    case 'images':
      return "Génération des images démarrée en arrière-plan. Vous pouvez quitter cette page.";
    case 'thumbnails':
      return "Génération des miniatures démarrée en arrière-plan";
    case 'test_images':
      return "Test des 2 premières scènes démarré en arrière-plan. Vous pouvez quitter cette page.";
    case 'single_prompt':
      return "Génération du prompt démarrée en arrière-plan";
    case 'single_image':
      return "Génération de l'image démarrée en arrière-plan";
    default:
      return "Génération démarrée en arrière-plan";
  }
}
