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
  // For chunked jobs, calculate global progress using metadata
  const metadata = job.metadata || {};
  
  // Total is the global total from metadata, or fallback to job.total
  const totalItems = metadata.totalImages || metadata.totalPrompts || metadata.totalMissing || job.total;
  
  // For chunked jobs, calculate completed items from remaining
  // remainingAfterChunk tells us how many are left after this chunk's batch was initiated
  // So completed = total - remaining + current chunk progress
  let globalProgress = job.progress;
  
  if (metadata.remainingAfterChunk !== undefined) {
    // Items completed before this chunk = total - remaining
    const completedBeforeChunk = totalItems - metadata.remainingAfterChunk - (metadata.chunkSize || job.total);
    globalProgress = Math.max(0, completedBeforeChunk) + job.progress;
  }
  
  const progressPercent = totalItems > 0 ? (globalProgress / totalItems) * 100 : 0;
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
