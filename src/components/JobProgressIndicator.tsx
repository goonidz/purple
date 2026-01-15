import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, X, CheckCircle2, AlertCircle, Clock, Square, Check, Zap } from "lucide-react";
import { useState, useEffect } from "react";
import { GenerationJob, JobType } from "@/hooks/useGenerationJobs";
import { VideoRenderJob } from "@/hooks/useVideoRenderJobs";
import { GpuRenderJob } from "@/hooks/useGpuRenderJobs";
import { cn } from "@/lib/utils";

interface JobProgressIndicatorProps {
  job: GenerationJob;
  onCancel?: (jobId: string) => void;
  className?: string;
}

export function JobProgressIndicator({ job, onCancel, className }: JobProgressIndicatorProps) {
  // For chunked jobs, calculate global progress using metadata
  const metadata = job.metadata || {};
  
  // For upscale jobs specifically, ensure we use the correct total
  let totalItems: number;
  let globalProgress: number;
  
  if (job.job_type === 'upscale') {
    // For upscale jobs:
    // - totalGlobal is the ORIGINAL total of all images to upscale (set in processUpscaleJob)
    // - totalToUpscale is the count of images needing upscale when this chunk started
    // - job.total should be set to totalGlobal but may not be updated yet
    // Prefer totalGlobal from metadata, then job.total, then totalToUpscale
    totalItems = metadata.totalGlobal || job.total || metadata.totalToUpscale || 1;
    
    // For upscale, job.progress is already calculated as global progress in the webhook
    globalProgress = job.progress || 0;
  } else {
    // For other job types
    totalItems = metadata.totalGlobal || metadata.totalImages || metadata.totalPrompts || metadata.totalMissing || job.total || 1;
    globalProgress = job.progress || 0;
    
    // For other chunked jobs, calculate from remainingAfterChunk
    if (metadata.remainingAfterChunk !== undefined && metadata.remainingAfterChunk >= 0) {
      const chunkSize = metadata.chunkSize || job.total || 0;
      const completedBeforeChunk = Math.max(0, totalItems - metadata.remainingAfterChunk - chunkSize);
      globalProgress = completedBeforeChunk + (job.progress || 0);
    }
  }
  
  // Clamp progress to not exceed total
  globalProgress = Math.min(globalProgress, totalItems);
  
  const progressPercent = totalItems > 0 ? Math.min(100, (globalProgress / totalItems) * 100) : 0;
  const isActive = job.status === 'pending' || job.status === 'processing';

  const getJobTypeLabel = (type: JobType): string => {
    switch (type) {
      case 'transcription':
        return 'Transcription';
      case 'prompts':
        return 'Génération des prompts';
      case 'images':
        return 'Génération des images';
      case 'qa':
        return 'Vérification des images';
      case 'qa_regen':
        return 'Régénération des images rejetées';
      case 'thumbnails':
        return 'Génération des miniatures';
      case 'upscale':
        return 'Upscaling des images';
      case 'single_animation':
        return 'Animation de la scène';
      default:
        return 'Génération';
    }
  };

  const getStatusIcon = () => {
    switch (job.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  return (
    <Card className={cn("p-3 border-primary/20 bg-primary/5", className)}>
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          {getStatusIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium">
                {getJobTypeLabel(job.job_type)}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {globalProgress}/{totalItems}
              </span>
            </div>
            {isActive && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCancel(job.id)}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <Square className="h-3 w-3 mr-1" />
                Arrêter
              </Button>
            )}
          </div>
          {isActive && (
            <Progress value={progressPercent} className="h-1.5" />
          )}
          {job.status === 'failed' && job.error_message && (
            <p className="text-xs text-destructive mt-1 line-clamp-2">
              {job.error_message}
            </p>
          )}
        </div>
      </div>
      {isActive && (
        <p className="text-xs text-muted-foreground mt-2">
          Vous pouvez quitter cette page. La génération continue en arrière-plan.
        </p>
      )}
    </Card>
  );
}

interface ActiveJobsBannerProps {
  jobs: GenerationJob[];
  onCancel?: (jobId: string) => void;
  className?: string;
}

interface VideoRenderJobIndicatorProps {
  job: VideoRenderJob;
  className?: string;
  onCancel?: (jobId: string) => void;
}

export function VideoRenderJobIndicator({ job, className, onCancel }: VideoRenderJobIndicatorProps) {
  // Use localStorage key based on job ID to persist dismissal state
  const dismissedKey = `video-render-dismissed-${job.id}`;
  const [isDismissed, setIsDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(dismissedKey) === 'true';
    }
    return false;
  });
  
  const isActive = job.status === 'pending' || job.status === 'processing';
  const isCompleted = job.status === 'completed';
  // Clamp progress between 0 and 100 to avoid display issues
  const progressPercent = Math.max(0, Math.min(100, job.progress || 0));

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(dismissedKey, 'true');
      // Dispatch custom event to notify parent component
      const event = new CustomEvent('video-render-dismissed', { detail: job.id });
      window.dispatchEvent(event);
    }
  };

  // Don't show if dismissed - return null immediately
  if (isDismissed) {
    return null;
  }

  const getStatusIcon = () => {
    switch (job.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  // For completed jobs, only show the success message (no card wrapper)
  if (isCompleted) {
    return (
      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border border-border">
        <span className="text-lg">🎉</span>
        <span className="text-sm font-medium text-foreground flex-1">
          Rendu terminé !
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Card className={cn("p-3 border-primary/20 bg-primary/5", className)}>
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          {getStatusIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium">
                Rendu vidéo
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {progressPercent}%
              </span>
            </div>
            {isActive && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCancel(job.id)}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <Square className="h-3 w-3 mr-1" />
                Arrêter
              </Button>
            )}
          </div>
          {isActive && job.status !== 'cancelled' && (
            <>
              <Progress value={progressPercent} className="h-1.5 mb-2" />
              {job.current_step && (
                <div className="flex items-center gap-2 text-xs mb-2">
                  {job.current_step.includes('terminée') ? (
                    <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                  ) : (
                    <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0" />
                  )}
                  <span className="text-muted-foreground">{job.current_step}</span>
                </div>
              )}
              {job.steps && job.steps.length > 0 && (
                <div className="space-y-1 max-h-[100px] overflow-y-auto">
                  {job.steps.slice(-3).map((step, index) => (
                    <div key={index} className="flex items-center gap-2 text-xs">
                      <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                      <span className="text-muted-foreground">{step.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {job.status === 'cancelled' && (
            <p className="text-xs text-muted-foreground mt-1">
              Rendu annulé
            </p>
          )}
          {job.status === 'failed' && job.error_message && (
            <p className="text-xs text-destructive mt-1 line-clamp-2">
              {job.error_message}
            </p>
          )}
        </div>
      </div>
      {isActive && job.status !== 'cancelled' && (
        <p className="text-xs text-muted-foreground mt-2">
          Vous pouvez quitter cette page. Le rendu continue en arrière-plan.
        </p>
      )}
    </Card>
  );
}

export function ActiveJobsBanner({ jobs, onCancel, className }: ActiveJobsBannerProps) {
  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing');

  if (activeJobs.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {activeJobs.map(job => (
        <JobProgressIndicator 
          key={job.id} 
          job={job} 
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}

interface ActiveVideoRenderJobsBannerProps {
  jobs: VideoRenderJob[];
  className?: string;
  onCancel?: (jobId: string) => void;
}

export function ActiveVideoRenderJobsBanner({ jobs, className, onCancel }: ActiveVideoRenderJobsBannerProps) {
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const dismissed = new Set<string>();
      jobs.forEach(j => {
        if (j.status === 'completed') {
          const dismissedKey = `video-render-dismissed-${j.id}`;
          if (localStorage.getItem(dismissedKey) === 'true') {
            dismissed.add(j.id);
          }
        }
      });
      return dismissed;
    }
    return new Set<string>();
  });

  // Listen for dismissal events and update state
  useEffect(() => {
    const handleDismiss = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setDismissedJobs(prev => {
        const updated = new Set(prev);
        updated.add(customEvent.detail);
        return updated;
      });
    };

    window.addEventListener('video-render-dismissed', handleDismiss);
    return () => {
      window.removeEventListener('video-render-dismissed', handleDismiss);
    };
  }, []);

  // Update dismissed jobs when jobs list changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = new Set<string>();
      jobs.forEach(j => {
        if (j.status === 'completed') {
          const dismissedKey = `video-render-dismissed-${j.id}`;
          if (localStorage.getItem(dismissedKey) === 'true') {
            dismissed.add(j.id);
          }
        }
      });
      setDismissedJobs(dismissed);
    }
  }, [jobs]);

  // Include active jobs (pending/processing) and completed jobs (filter out dismissed ones)
  const activeJobs = jobs.filter(j => {
    if (j.status === 'pending' || j.status === 'processing') {
      return true;
    }
    // Include completed jobs only if not dismissed
    if (j.status === 'completed') {
      // Check both state and localStorage for reliability
      if (dismissedJobs.has(j.id)) {
        return false;
      }
      if (typeof window !== 'undefined') {
        const dismissedKey = `video-render-dismissed-${j.id}`;
        if (localStorage.getItem(dismissedKey) === 'true') {
          return false;
        }
      }
      return true;
    }
    return false;
  });

  console.log('ActiveVideoRenderJobsBanner - jobs:', jobs.length, 'active:', activeJobs.length, activeJobs);

  if (activeJobs.length === 0) {
    console.log('ActiveVideoRenderJobsBanner - No active jobs, returning null');
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      {activeJobs.map(job => (
        <VideoRenderJobIndicator 
          key={job.id} 
          job={job}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}

interface GpuRenderJobIndicatorProps {
  job: GpuRenderJob;
  onCancel?: (jobId: string) => void;
  className?: string;
}

export function GpuRenderJobIndicator({ job, onCancel, className }: GpuRenderJobIndicatorProps) {
  const progressPercent = Math.min(100, job.progress || 0);
  const isActive = job.status === 'pending' || job.status === 'processing';

  const getStatusIcon = () => {
    switch (job.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  return (
    <Card className={cn("p-3 border-primary/20 bg-primary/5", className)}>
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          {getStatusIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-yellow-500" />
                Rendu vidéo GPU
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {progressPercent}%
              </span>
            </div>
            {isActive && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCancel(job.id)}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <Square className="h-3 w-3 mr-1" />
                Arrêter
              </Button>
            )}
          </div>
          {isActive && job.status !== 'cancelled' && (
            <>
              <Progress value={progressPercent} className="h-1.5 mb-2" />
              {job.worker_id && (
                <div className="flex items-center gap-2 text-xs mb-2">
                  <Loader2 className="h-3 w-3 text-primary animate-spin flex-shrink-0" />
                  <span className="text-muted-foreground">Worker: {job.worker_id}</span>
                </div>
              )}
            </>
          )}
          {job.status === 'cancelled' && (
            <p className="text-xs text-muted-foreground mt-1">
              Rendu annulé
            </p>
          )}
          {job.status === 'failed' && job.error_message && (
            <p className="text-xs text-destructive mt-1 line-clamp-2">
              {job.error_message}
            </p>
          )}
        </div>
      </div>
      {isActive && job.status !== 'cancelled' && (
        <p className="text-xs text-muted-foreground mt-2">
          Vous pouvez quitter cette page. Le rendu continue en arrière-plan.
        </p>
      )}
    </Card>
  );
}

interface ActiveGpuRenderJobsBannerProps {
  jobs: GpuRenderJob[];
  className?: string;
  onCancel?: (jobId: string) => void;
}

export function ActiveGpuRenderJobsBanner({ jobs, className, onCancel }: ActiveGpuRenderJobsBannerProps) {
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const dismissed = new Set<string>();
      jobs.forEach(j => {
        if (j.status === 'completed') {
          const dismissedKey = `gpu-render-dismissed-${j.id}`;
          if (localStorage.getItem(dismissedKey) === 'true') {
            dismissed.add(j.id);
          }
        }
      });
      return dismissed;
    }
    return new Set<string>();
  });

  // Listen for dismissal events and update state
  useEffect(() => {
    const handleDismiss = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setDismissedJobs(prev => {
        const updated = new Set(prev);
        updated.add(customEvent.detail);
        return updated;
      });
    };

    window.addEventListener('gpu-render-dismissed', handleDismiss);
    return () => {
      window.removeEventListener('gpu-render-dismissed', handleDismiss);
    };
  }, []);

  // Update dismissed jobs when jobs list changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = new Set<string>();
      jobs.forEach(j => {
        if (j.status === 'completed') {
          const dismissedKey = `gpu-render-dismissed-${j.id}`;
          if (localStorage.getItem(dismissedKey) === 'true') {
            dismissed.add(j.id);
          }
        }
      });
      setDismissedJobs(dismissed);
    }
  }, [jobs]);

  // Include active jobs (pending/processing) and completed jobs (filter out dismissed ones)
  const activeJobs = jobs.filter(j => {
    if (j.status === 'pending' || j.status === 'processing') {
      return true;
    }
    // Include completed jobs only if not dismissed
    if (j.status === 'completed') {
      if (dismissedJobs.has(j.id)) {
        return false;
      }
      return true;
    }
    return false;
  });

  console.log('[GPU] ActiveGpuRenderJobsBanner - jobs:', jobs.length, 'active:', activeJobs.length, activeJobs);

  if (activeJobs.length === 0) {
    console.log('[GPU] ActiveGpuRenderJobsBanner - No active jobs, returning null');
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      {activeJobs.map(job => (
        <GpuRenderJobIndicator 
          key={job.id} 
          job={job}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}
