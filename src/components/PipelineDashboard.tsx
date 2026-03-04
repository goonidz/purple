import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Loader2, Check, AlertTriangle } from "lucide-react";

interface PipelineRow {
  id: string;
  current_step: string;
  step_status: string;
  error: string | null;
  created_at: string;
  calendar_entry_id: string;
  card_title: string;
  channel_name: string | null;
  channel_color: string | null;
}

const STEPS = [
  "create_project", "generate_script", "wait_script",
  "generate_audio", "wait_audio", "transcribe",
  "wait_transcription", "create_scenes", "generate_prompts",
  "wait_prompts", "generate_images", "wait_images",
];

const STEP_LABELS = [
  "Projet", "Script", "Script...", "Audio", "Audio...",
  "Transcription", "Transcription...", "Scènes",
  "Prompts", "Prompts...", "Images", "Images...",
];

function getStepText(step: string): string {
  if (step === "create_project") return "Création du projet...";
  if (step === "generate_script" || step === "wait_script") return "Génération du script...";
  if (step === "generate_audio" || step === "wait_audio") return "Génération audio...";
  if (step === "transcribe" || step === "wait_transcription") return "Transcription en cours...";
  if (step === "create_scenes") return "Création des scènes...";
  if (step === "generate_prompts" || step === "wait_prompts") return "Génération des prompts...";
  if (step === "generate_images" || step === "wait_images") return "Génération des images...";
  if (step === "completed") return "Terminé";
  if (step === "failed") return "Échoué";
  return step;
}

interface PipelineDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PipelineDashboard({ isOpen, onClose }: PipelineDashboardProps) {
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setPipelines([]);
      setLoading(true);
      return;
    }

    let cancelled = false;

    const fetchPipelines = async () => {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from("auto_pipelines" as any)
        .select("id, current_step, step_status, error, created_at, calendar_entry_id")
        .or(`current_step.not.in.(completed,failed),updated_at.gte.${twentyFourHoursAgo}`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (cancelled || !data) return;

      const rows = data as any[];
      const calendarIds = [...new Set(rows.map((r: any) => r.calendar_entry_id))];

      let cardMap: Record<string, { title: string; channel_name: string | null; channel_color: string | null }> = {};
      if (calendarIds.length > 0) {
        const { data: cards } = await supabase
          .from("content_calendar")
          .select("id, title, channels:channel_id(name, color)")
          .in("id", calendarIds);

        if (cards) {
          for (const card of cards as any[]) {
            cardMap[card.id] = {
              title: card.title,
              channel_name: card.channels?.name || null,
              channel_color: card.channels?.color || null,
            };
          }
        }
      }

      if (cancelled) return;

      const enriched: PipelineRow[] = rows.map((r: any) => ({
        id: r.id,
        current_step: r.current_step,
        step_status: r.step_status,
        error: r.error,
        created_at: r.created_at,
        calendar_entry_id: r.calendar_entry_id,
        card_title: cardMap[r.calendar_entry_id]?.title || "Sans titre",
        channel_name: cardMap[r.calendar_entry_id]?.channel_name || null,
        channel_color: cardMap[r.calendar_entry_id]?.channel_color || null,
      }));

      setPipelines(enriched);
      setLoading(false);
    };

    fetchPipelines();
    const interval = setInterval(fetchPipelines, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isOpen]);

  const active = pipelines.filter(p => p.current_step !== "completed" && p.step_status !== "failed");
  const recent = pipelines.filter(p => p.current_step === "completed" || p.step_status === "failed");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pipelines auto-génération</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto -mx-2 px-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pipelines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Aucun pipeline récent</p>
          ) : (
            <div className="space-y-2 pb-2">
              {active.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">En cours ({active.length})</p>
                  {active.map(p => <PipelineCard key={p.id} pipeline={p} />)}
                </>
              )}
              {recent.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mt-4">Récents</p>
                  {recent.map(p => <PipelineCard key={p.id} pipeline={p} />)}
                </>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function PipelineCard({ pipeline }: { pipeline: PipelineRow }) {
  const isCompleted = pipeline.current_step === "completed";
  const isFailed = pipeline.step_status === "failed";
  const currentIdx = STEPS.indexOf(pipeline.current_step);

  return (
    <div className={cn(
      "p-3 rounded-lg border min-w-0 overflow-hidden",
      isCompleted && "border-green-500/20 bg-green-500/5",
      isFailed && "border-red-500/20 bg-red-500/5",
      !isCompleted && !isFailed && "border-primary/20 bg-primary/5",
    )}>
      <div className="flex items-center gap-2 mb-1.5">
        {pipeline.channel_color && (
          <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: pipeline.channel_color }} />
        )}
        <span className="text-sm font-medium truncate flex-1">{pipeline.card_title}</span>
        {isCompleted && <Check className="h-4 w-4 text-green-600 flex-shrink-0" />}
        {isFailed && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
        {!isCompleted && !isFailed && <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />}
      </div>

      {pipeline.channel_name && (
        <p className="text-xs text-muted-foreground mb-2">{pipeline.channel_name}</p>
      )}

      {!isCompleted && !isFailed && (
        <div className="flex gap-0.5 mb-1 min-w-0">
          {STEPS.map((step, i) => {
            const isDone = i < currentIdx;
            const isCurrent = i === currentIdx;
            return (
              <div key={step} className="flex-1" title={STEP_LABELS[i]}>
                <div className={cn(
                  "h-1.5 rounded-full transition-all",
                  isDone ? "bg-primary" : isCurrent ? "bg-primary/50 animate-pulse" : "bg-muted",
                )} />
              </div>
            );
          })}
        </div>
      )}

      <p className={cn(
        "text-xs",
        isCompleted && "text-green-700 dark:text-green-400",
        isFailed && "text-red-600",
        !isCompleted && !isFailed && "text-muted-foreground",
      )}>
        {getStepText(pipeline.current_step)}
      </p>

      {isFailed && pipeline.error && (
        <p className="text-xs text-red-500/80 mt-1 truncate">{pipeline.error}</p>
      )}
    </div>
  );
}
