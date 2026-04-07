import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const REMOTION_SERVICE_URL =
  (import.meta as any).env?.VITE_REMOTION_SERVICE_URL ||
  "https://purpleai.duckdns.org/remotion-api";

interface AnimatorPreviewProps {
  projectId: string;
  hasCompletedScenes: boolean;
}

export function AnimatorPreview({ projectId, hasCompletedScenes }: AnimatorPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewMeta, setPreviewMeta] = useState<{ durationInFrames: number; fps: number; totalDuration: number } | null>(null);

  const loadPreview = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/preview-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Preview generation failed");

      setPreviewUrl(data.previewUrl);
      setPreviewMeta({
        durationInFrames: data.durationInFrames,
        fps: data.fps,
        totalDuration: data.totalDuration,
      });
    } catch (err: any) {
      console.error("[AnimatorPreview] Error:", err);
      toast.error(`Erreur preview: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  if (!hasCompletedScenes) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">
          Aucune scène Animator générée. Lancez la génération dans l'onglet Vidéo.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!previewUrl && !isLoading && (
        <Card className="p-12 text-center space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Play className="h-12 w-12 text-purple-500/50" />
            <p className="text-muted-foreground">
              Prévisualisez les animations Remotion directement dans le navigateur, sans lancer de rendu MP4.
            </p>
            <Button onClick={loadPreview} className="gap-2">
              <Play className="h-4 w-4" />
              Charger la preview
            </Button>
          </div>
        </Card>
      )}

      {isLoading && (
        <Card className="p-12 text-center space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
            <p className="text-muted-foreground">
              Compilation du bundle Remotion en cours...
            </p>
            <p className="text-xs text-muted-foreground/60">
              Cela peut prendre 10-20 secondes
            </p>
          </div>
        </Card>
      )}

      {previewUrl && !isLoading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-medium">Preview Animator</h3>
              {previewMeta && (
                <span className="text-xs text-muted-foreground">
                  {previewMeta.totalDuration.toFixed(1)}s · {previewMeta.durationInFrames} frames · {previewMeta.fps}fps
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadPreview} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Recharger
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(previewUrl, "_blank")}
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ouvrir
              </Button>
            </div>
          </div>
          <div className="relative w-full rounded-xl overflow-hidden border border-border bg-black" style={{ aspectRatio: "16/9" }}>
            <iframe
              src={previewUrl}
              className="w-full h-full border-0"
              allow="autoplay"
              title="Animator Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}
