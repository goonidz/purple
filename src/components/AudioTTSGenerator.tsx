import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play, Download, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";

interface AudioTTSGeneratorProps {
  projectId: string;
  projectSummary: string | null;
  onAudioGenerated?: (audioUrl: string) => void;
}

export function AudioTTSGenerator({ projectId, projectSummary, onAudioGenerated }: AudioTTSGeneratorProps) {
  const [text, setText] = useState(projectSummary || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (projectSummary && !text) {
      setText(projectSummary);
    }
  }, [projectSummary]);

  const handleJobComplete = useCallback((job: GenerationJob) => {
    if (job.job_type !== "audio_generation") return;
    const audioUrl = job.metadata?.audioUrl;
    if (audioUrl) {
      setGeneratedAudioUrl(audioUrl);
      onAudioGenerated?.(audioUrl);
      toast.success("Audio généré avec succès !");
    }
    setIsGenerating(false);
  }, [onAudioGenerated]);

  const handleJobFailed = useCallback((job: GenerationJob) => {
    if (job.job_type !== "audio_generation") return;
    toast.error(`Erreur: ${job.error_message || "Échec de la génération audio"}`);
    setIsGenerating(false);
  }, []);

  const { activeJobs, startJob, cancelJob } = useGenerationJobs({
    projectId,
    onJobComplete: handleJobComplete,
    onJobFailed: handleJobFailed,
  });

  const ttsJob = activeJobs.find(
    (j) => j.job_type === "audio_generation" && (j.status === "pending" || j.status === "processing")
  );

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Veuillez entrer du texte à convertir en audio");
      return;
    }
    if (!projectId) {
      toast.error("Aucun projet sélectionné");
      return;
    }

    setIsGenerating(true);
    setGeneratedAudioUrl(null);

    try {
      await startJob("audio_generation" as any, {
        text: text.trim(),
        voice: "Puck",
        styleInstruction: "Lis pour une vidéo youtube sur des docus finances: ",
        provider: "gemini_tts",
      });
    } catch (err: any) {
      toast.error(`Erreur: ${err.message}`);
      setIsGenerating(false);
    }
  };

  const handleCancel = async () => {
    if (ttsJob) {
      await cancelJob(ttsJob.id);
      setIsGenerating(false);
    }
  };

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimatedChunks = Math.max(1, Math.ceil(wordCount / 250));
  const estimatedMinutes = Math.ceil((estimatedChunks * 6.5) / 60);

  const progress = ttsJob?.progress || 0;
  const total = ttsJob?.total || ttsJob?.metadata?.totalChunks || estimatedChunks;
  const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Volume2 className="h-5 w-5" />
        <h3 className="text-lg font-semibold">Génération Audio (Gemini TTS)</h3>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tts-text">Texte à convertir</Label>
        <Textarea
          id="tts-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Collez ou écrivez le texte du script ici..."
          className="min-h-[200px] text-sm"
          disabled={isGenerating}
        />
        <p className="text-xs text-muted-foreground">
          {wordCount} mots &middot; ~{estimatedChunks} chunk{estimatedChunks > 1 ? "s" : ""} &middot; ~{estimatedMinutes} min estimée{estimatedMinutes > 1 ? "s" : ""}
        </p>
      </div>

      {ttsJob && (ttsJob.status === "pending" || ttsJob.status === "processing") && (
        <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {ttsJob.status === "pending"
                  ? "En attente de traitement..."
                  : `Chunk ${progress}/${total} en cours...`}
              </span>
            </div>
            <span className="text-muted-foreground">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !text.trim() || !projectId}
          className="flex-1"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Génération en cours...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Générer l'audio
            </>
          )}
        </Button>
        {isGenerating && ttsJob && (
          <Button variant="outline" onClick={handleCancel}>
            Annuler
          </Button>
        )}
      </div>

      {generatedAudioUrl && (
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Audio généré</span>
            <Button asChild variant="outline" size="sm">
              <a href={generatedAudioUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-2" />
                Télécharger
              </a>
            </Button>
          </div>
          <audio controls className="w-full">
            <source src={generatedAudioUrl} />
          </audio>
        </div>
      )}
    </Card>
  );
}
