import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Check, ChevronLeft, ChevronRight, Play, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PexelsVideo {
  pexelId: number;
  url: string;
  thumbnail: string;
  duration: number;
  width: number;
  height: number;
  keyword: string;
}

interface SelectedClip {
  pexelId: number;
  url: string;
  thumbnail: string;
  startTime: number;
  duration: number;
  totalDuration: number;
}

interface SceneResult {
  sceneIndex: number;
  text: string;
  pexelsResults: PexelsVideo[];
  pexelsClips: any[];
}

interface VideoClipSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sceneResults: SceneResult[];
}

export default function VideoClipSelectorModal({
  open,
  onOpenChange,
  projectId,
  sceneResults,
}: VideoClipSelectorModalProps) {
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [selections, setSelections] = useState<Record<number, SelectedClip[]>>(() => {
    const init: Record<number, SelectedClip[]> = {};
    for (const sr of sceneResults) {
      if (sr.pexelsClips && sr.pexelsClips.length > 0) {
        init[sr.sceneIndex] = sr.pexelsClips.map((c: any) => ({
          pexelId: c.pexelId,
          url: c.url,
          thumbnail: c.thumbnail || '',
          startTime: c.startTime || 0,
          duration: c.duration || 5,
          totalDuration: c.totalDuration || c.duration || 10,
        }));
      }
    }
    return init;
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  if (sceneResults.length === 0) return null;

  const currentScene = sceneResults[Math.min(currentSceneIdx, sceneResults.length - 1)];
  const sceneSelections = selections[currentScene.sceneIndex] || [];

  const isSelected = (pexelId: number) => sceneSelections.some((c) => c.pexelId === pexelId);

  const toggleVideo = (video: PexelsVideo) => {
    const sceneKey = currentScene.sceneIndex;
    const current = selections[sceneKey] || [];
    if (isSelected(video.pexelId)) {
      setSelections({ ...selections, [sceneKey]: current.filter((c) => c.pexelId !== video.pexelId) });
    } else {
      setSelections({
        ...selections,
        [sceneKey]: [
          ...current,
          {
            pexelId: video.pexelId,
            url: video.url,
            thumbnail: video.thumbnail,
            startTime: 0,
            duration: Math.min(5, video.duration),
            totalDuration: video.duration,
          },
        ],
      });
    }
  };

  const updateClip = (pexelId: number, field: "startTime" | "duration", value: number) => {
    const sceneKey = currentScene.sceneIndex;
    const current = selections[sceneKey] || [];
    setSelections({
      ...selections,
      [sceneKey]: current.map((c) => {
        if (c.pexelId !== pexelId) return c;
        if (field === "startTime") {
          const maxStart = Math.max(0, c.totalDuration - 1);
          const newStart = Math.min(value, maxStart);
          const maxDur = c.totalDuration - newStart;
          return { ...c, startTime: newStart, duration: Math.min(c.duration, maxDur) };
        }
        const maxDur = c.totalDuration - c.startTime;
        return { ...c, duration: Math.min(value, maxDur) };
      }),
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates = sceneResults.map((sr) => {
        const clips = selections[sr.sceneIndex] || [];
        return supabase
          .from("project_scenes")
          .update({
            pexels_clips: clips.length > 0
              ? {
                  clips: clips.map((c) => ({
                    pexelId: c.pexelId,
                    url: c.url,
                    thumbnail: c.thumbnail,
                    startTime: c.startTime,
                    duration: c.duration,
                  })),
                  reason: "Sélection manuelle"
                }
              : null,
          })
          .eq("project_id", projectId)
          .eq("scene_index", sr.sceneIndex);
      });

      await Promise.all(updates);
      toast.success("Sélection de vidéos sauvegardée !");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erreur lors de la sauvegarde");
    } finally {
      setIsSaving(false);
    }
  };

  const totalSelected = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Vidéos Pexels — Scène {currentScene.sceneIndex + 1}/{sceneResults.length}</span>
            <span className="text-sm font-normal text-muted-foreground">{totalSelected} clip(s) sélectionné(s)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="bg-muted/50 rounded-lg p-3 mb-2">
          <p className="text-sm line-clamp-2">{currentScene.text}</p>
          {currentScene.pexelsResults[0]?.keyword && (
            <p className="text-xs text-muted-foreground mt-1">
              Mot-clé : <span className="font-medium">{currentScene.pexelsResults[0].keyword}</span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {currentScene.pexelsResults.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Aucune vidéo trouvée pour cette scène</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {currentScene.pexelsResults.map((video) => {
                const selected = isSelected(video.pexelId);
                return (
                  <div
                    key={video.pexelId}
                    className={`relative group rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      selected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/30"
                    }`}
                    onClick={() => toggleVideo(video)}
                  >
                    <div className="aspect-video bg-muted relative">
                      <img
                        src={video.thumbnail}
                        alt={video.keyword}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                        {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, "0")}
                      </div>
                      <button
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewUrl(video.url);
                        }}
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      {selected && (
                        <div className="absolute top-1 left-1 bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {sceneSelections.length > 0 && (
            <div className="border-t pt-3 space-y-3">
              <p className="text-sm font-medium">Clips sélectionnés pour cette scène</p>
              {sceneSelections.map((clip) => (
                <div key={clip.pexelId} className="flex items-center gap-4 bg-muted/50 rounded-lg p-3">
                  <img src={clip.thumbnail} alt="" className="w-20 h-12 object-cover rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-16">Début</span>
                      <Slider
                        value={[clip.startTime]}
                        min={0}
                        max={Math.max(0, clip.totalDuration - 1)}
                        step={0.5}
                        onValueChange={([v]) => updateClip(clip.pexelId, "startTime", v)}
                        className="flex-1"
                      />
                      <span className="text-xs font-mono w-10 text-right">{clip.startTime.toFixed(1)}s</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-16">Durée</span>
                      <Slider
                        value={[clip.duration]}
                        min={0.5}
                        max={Math.max(0.5, clip.totalDuration - clip.startTime)}
                        step={0.5}
                        onValueChange={([v]) => updateClip(clip.pexelId, "duration", v)}
                        className="flex-1"
                      />
                      <span className="text-xs font-mono w-10 text-right">{clip.duration.toFixed(1)}s</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => toggleVideo({ pexelId: clip.pexelId } as PexelsVideo)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentSceneIdx === 0}
              onClick={() => setCurrentSceneIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentSceneIdx >= sceneResults.length - 1}
              onClick={() => setCurrentSceneIdx((i) => Math.min(sceneResults.length - 1, i + 1))}
            >
              Suivant
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Sauvegarde..." : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Sauvegarder ({totalSelected} clips)
                </>
              )}
            </Button>
          </div>
        </div>

        {previewUrl && (
          <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
            <DialogContent className="max-w-3xl p-2">
              <video
                ref={videoRef}
                src={previewUrl}
                controls
                autoPlay
                className="w-full rounded-lg"
              />
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
