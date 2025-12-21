import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type JobType = 'transcription' | 'prompts' | 'images' | 'thumbnails' | 'test_images' | 'single_prompt' | 'single_image' | 'upscale';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJob {
  id: string;
  project_id: string | null;
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
  autoRetryImages?: boolean; // Auto-retry if images are missing after job completes
  standalone?: boolean; // If true, jobs are tracked by user only (no project filter)
}

export function useGenerationJobs({ projectId, onJobComplete, onJobFailed, autoRetryImages = false, standalone = false }: UseGenerationJobsOptions) {
  const [activeJobs, setActiveJobs] = useState<GenerationJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 10; // Maximum auto-retries

  // Use refs to avoid stale closures
  const onJobCompleteRef = useRef(onJobComplete);
  const onJobFailedRef = useRef(onJobFailed);
  const activeJobsRef = useRef(activeJobs);
  const projectIdRef = useRef(projectId);
  
  useEffect(() => {
    onJobCompleteRef.current = onJobComplete;
    onJobFailedRef.current = onJobFailed;
    projectIdRef.current = projectId;
  }, [onJobComplete, onJobFailed, projectId]);

  // Keep activeJobsRef in sync
  useEffect(() => {
    activeJobsRef.current = activeJobs;
  }, [activeJobs]);

  // Check for missing images and auto-retry
  const checkAndRetryMissingImages = useCallback(async (completedJob: GenerationJob) => {
    if (!autoRetryImages || completedJob.job_type !== 'images') return;
    if (retryCount >= maxRetries) {
      console.log('Max retries reached, stopping auto-retry');
      toast.info(`Génération terminée. ${retryCount} tentatives effectuées.`);
      return;
    }

    const targetProjectId = projectIdRef.current || completedJob.project_id;
    
    try {
      // Fetch current project data to check for missing images
      const { data: project } = await supabase
        .from('projects')
        .select('prompts')
        .eq('id', targetProjectId)
        .single();

      if (!project?.prompts) return;

      const prompts = project.prompts as any[];
      const missingCount = prompts.filter(p => p && p.prompt && !p.imageUrl).length;

      console.log(`Job completed. Missing images: ${missingCount}/${prompts.length}`);

      if (missingCount > 0) {
        console.log(`Auto-retrying for ${missingCount} missing images (attempt ${retryCount + 1}/${maxRetries})`);
        toast.info(`${missingCount} images manquantes. Relance automatique...`);
        
        setRetryCount(prev => prev + 1);
        
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Start a new job for missing images
        const { error } = await supabase.functions.invoke('start-generation-job', {
          body: { 
            projectId: targetProjectId, 
            jobType: 'images', 
            metadata: { skipExisting: true, autoRetry: true } 
          }
        });

        if (error) {
          console.error('Auto-retry failed:', error);
        }
      } else {
        console.log('All images generated successfully!');
        toast.success(`Toutes les images ont été générées ! (${retryCount > 0 ? `${retryCount + 1} tentatives` : '1 tentative'})`);
        setRetryCount(0); // Reset retry count on success
      }
    } catch (error) {
      console.error('Error checking for missing images:', error);
    }
  }, [autoRetryImages, retryCount]);

  // Subscribe to realtime updates for jobs
  useEffect(() => {
    // In standalone mode, skip all project-based tracking
    if (standalone) return;
    if (!projectId) return;

    // Initial fetch - wrapped to avoid issues with callback order
    const doInitialFetch = async () => {
      try {
        const { data, error } = await supabase
          .from('generation_jobs')
          .select('*')
          .eq('project_id', projectId)
          .in('status', ['pending', 'processing'])
          .order('created_at', { ascending: false });

        if (error) throw error;
        setActiveJobs((data || []) as unknown as GenerationJob[]);
      } catch (error) {
        console.error('Error fetching initial active jobs:', error);
      }
    };
    
    doInitialFetch();

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
              // If we no longer track this job (already removed), ignore the update
              const existingJob = prev.find(j => j.id === updatedJob.id);
              if (!existingJob) {
                return prev;
              }
              
              // If job completed or failed, trigger callbacks and remove from active
              if (updatedJob.status === 'completed') {
                // Use ref to get latest callback
                onJobCompleteRef.current?.(updatedJob);
                // Check for missing images and auto-retry (async, don't await)
                checkAndRetryMissingImages(updatedJob);
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

    // Periodic re-fetch to catch any jobs we might have missed
    const refetchInterval = setInterval(doInitialFetch, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(refetchInterval);
    };
  }, [projectId, checkAndRetryMissingImages]);

  // Fallback polling when realtime doesn't work (also primary tracking for standalone mode)
  useEffect(() => {
    if ((!projectId && !standalone) || activeJobs.length === 0) return;

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
            // Check for missing images and auto-retry
            checkAndRetryMissingImages(typedJob);
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
  }, [projectId, standalone, activeJobs.length]); // Only depend on length to avoid infinite re-renders

  const fetchActiveJobs = useCallback(async () => {
    // Skip fetch in standalone mode (no project to fetch from)
    if (standalone || !projectId) return;

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
      
      // Reset retry count when manually fetching jobs
      setRetryCount(0);
    } catch (error) {
      console.error('Error fetching active jobs:', error);
    }
  }, [projectId, standalone]);
  const startJob = useCallback(async (
    jobType: JobType, 
    metadata: Record<string, any> = {},
    overrideProjectId?: string
  ): Promise<{ jobId: string; total: number } | null> => {
    const targetProjectId = overrideProjectId || projectId;
    const isStandaloneJob = metadata.standalone === true;
    
    if (!targetProjectId && !isStandaloneJob) {
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
        project_id: isStandaloneJob ? null : targetProjectId,
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
      
      console.log('Adding new job to activeJobs:', newJob.id, newJob.job_type, 'standalone:', isStandaloneJob);
      
      // Force immediate state update with functional update
      setActiveJobs(prev => {
        const exists = prev.find(j => j.id === data.jobId);
        if (exists) {
          console.log('Job already exists in activeJobs');
          return prev;
        }
        const updated = [...prev, newJob];
        console.log('Updated activeJobs count:', updated.length);
        return updated;
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
    case 'upscale':
      return "Upscaling des images démarré en arrière-plan. Vous pouvez quitter cette page.";
    default:
      return "Génération démarrée en arrière-plan";
  }
}
