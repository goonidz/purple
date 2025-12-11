import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, X, CheckCircle2, AlertCircle, Clock, Square } from "lucide-react";
import { GenerationJob, JobType } from "@/hooks/useGenerationJobs";
import { cn } from "@/lib/utils";

interface JobProgressIndicatorProps {
  job: GenerationJob;
  onCancel?: (jobId: string) => void;
  className?: string;
}

export function JobProgressIndicator({ job, onCancel, className }: JobProgressIndicatorProps) {
  const progressPercent = job.total > 0 ? (job.progress / job.total) * 100 : 0;
  const isActive = job.status === 'pending' || job.status === 'processing';

  const getJobTypeLabel = (type: JobType): string => {
    switch (type) {
      case 'transcription':
        return 'Transcription';
      case 'prompts':
        return 'Génération des prompts';
      case 'images':
        return 'Génération des images';
      case 'thumbnails':
        return 'Génération des miniatures';
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {getStatusIcon()}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {getJobTypeLabel(job.job_type)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {job.progress}/{job.total}
                </span>
              </div>
              {isActive && onCancel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(job.id)}
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
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
              <p className="text-xs text-destructive mt-1 truncate">
                {job.error_message}
              </p>
            )}
          </div>
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
