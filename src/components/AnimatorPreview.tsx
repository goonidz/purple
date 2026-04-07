import { useState, useCallback, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw, ExternalLink, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

const REMOTION_SERVICE_URL =
  (import.meta as any).env?.VITE_REMOTION_SERVICE_URL ||
  "https://purpleai.duckdns.org/remotion-api";

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sceneIndex?: number;
}

interface AnimatorPreviewProps {
  projectId: string;
  hasCompletedScenes: boolean;
}

export function AnimatorPreview({ projectId, hasCompletedScenes }: AnimatorPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewMeta, setPreviewMeta] = useState<{
    durationInFrames: number;
    fps: number;
    totalDuration: number;
  } | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);

  // Frame sync
  const [currentFrame, setCurrentFrame] = useState(0);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number | null>(null);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for frame updates from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "remotion-frame" && typeof e.data.frame === "number") {
        setCurrentFrame(e.data.frame);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Compute active scene from current frame
  useEffect(() => {
    if (!previewMeta || segments.length === 0) return;
    const time = currentFrame / previewMeta.fps;
    const idx = segments.findIndex((s) => time >= s.start && time < s.end);
    setActiveSceneIndex(idx >= 0 ? idx : null);
  }, [currentFrame, segments, previewMeta]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

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
      if (data.segments) setSegments(data.segments);
    } catch (err: any) {
      console.error("[AnimatorPreview] Error:", err);
      toast.error(`Erreur preview: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const sendEdit = useCallback(async () => {
    if (!chatInput.trim() || activeSceneIndex == null || isEditing) return;

    const instruction = chatInput.trim();
    const sceneIdx = activeSceneIndex;
    setChatInput("");
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: instruction, sceneIndex: sceneIdx },
    ]);
    setIsEditing(true);

    try {
      const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/edit-scene`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sceneIndex: sceneIdx,
          instruction,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Edit failed");

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Scene ${sceneIdx + 1} modifiée. Rechargement de la preview...`,
          sceneIndex: sceneIdx,
        },
      ]);

      await loadPreview();
    } catch (err: any) {
      console.error("[AnimatorPreview] Edit error:", err);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Erreur: ${err.message}`, sceneIndex: sceneIdx },
      ]);
      toast.error(`Erreur: ${err.message}`);
    } finally {
      setIsEditing(false);
    }
  }, [chatInput, activeSceneIndex, isEditing, projectId, loadPreview]);

  if (!hasCompletedScenes) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">
          Aucune scène Animator générée. Lancez la génération dans l'onglet Vidéo.
        </p>
      </Card>
    );
  }

  const currentTime = previewMeta ? currentFrame / previewMeta.fps : 0;
  const activeSegment = activeSceneIndex != null ? segments[activeSceneIndex] : null;

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
          {/* Header */}
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

          {/* Player iframe */}
          <div className="relative w-full rounded-xl overflow-hidden border border-border bg-black" style={{ aspectRatio: "16/9" }}>
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0"
              allow="autoplay"
              title="Animator Preview"
            />
          </div>

          {/* Active scene badge */}
          {segments.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {activeSceneIndex != null && activeSegment ? (
                <>
                  <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                    Scene {activeSceneIndex + 1} / {segments.length}
                  </Badge>
                  <span className="text-muted-foreground">
                    {activeSegment.start.toFixed(1)}s – {activeSegment.end.toFixed(1)}s
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="text-muted-foreground truncate max-w-md">
                    {activeSegment.text.substring(0, 80)}{activeSegment.text.length > 80 ? "..." : ""}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {currentTime.toFixed(1)}s — Mets play pour détecter la scène active
                </span>
              )}
            </div>
          )}

          {/* Chat area */}
          <Card className="border border-border overflow-hidden">
            {/* Messages */}
            <div className="max-h-48 overflow-y-auto p-3 space-y-2">
              {chatMessages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  <Sparkles className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" />
                  Décrivez ce qui ne va pas — l'IA modifiera la scène en cours
                </p>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm px-3 py-1.5 rounded-lg max-w-[85%] ${
                    msg.role === "user"
                      ? "ml-auto bg-purple-500/10 text-purple-200"
                      : "mr-auto bg-muted text-muted-foreground"
                  }`}
                >
                  {msg.sceneIndex != null && (
                    <span className="text-[10px] opacity-50 mr-1">Scene {msg.sceneIndex + 1}</span>
                  )}
                  {msg.content}
                </div>
              ))}
              {isEditing && (
                <div className="mr-auto flex items-center gap-2 text-sm text-muted-foreground px-3 py-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Modification en cours...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border p-2 flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendEdit()}
                placeholder={
                  activeSceneIndex != null
                    ? `Modifier la scène ${activeSceneIndex + 1}...`
                    : "Lancez la lecture pour détecter la scène"
                }
                disabled={isEditing || activeSceneIndex == null}
                className="text-sm h-9"
              />
              <Button
                size="sm"
                onClick={sendEdit}
                disabled={isEditing || !chatInput.trim() || activeSceneIndex == null}
                className="h-9 px-3"
              >
                {isEditing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
