import { useState, useCallback, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw, ExternalLink, Send, Sparkles, Camera, X, AlertTriangle, ChevronLeft, ChevronRight, Wrench, Bot, Square, Check, XCircle, Eye } from "lucide-react";
import { toast } from "sonner";
import { useGenerationJobs } from "@/hooks/useGenerationJobs";
import { supabase } from "@/integrations/supabase/client";

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

interface QAScreenshot {
  sceneIndex: number;
  timestamp: number;
  success: boolean;
  url: string | null;
  error?: string;
}

interface AnimatorPreviewProps {
  projectId: string;
  hasCompletedScenes: boolean;
}

export function AnimatorPreview({ projectId, hasCompletedScenes }: AnimatorPreviewProps) {
  const { startJob, cancelJob, hasActiveJob, getJobByType } = useGenerationJobs({ projectId });
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
  const [isRebuilding, setIsRebuilding] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resumeFrameRef = useRef<number | null>(null);

  // QA Screenshots
  const [qaScreenshots, setQaScreenshots] = useState<QAScreenshot[]>([]);
  const [isLoadingQA, setIsLoadingQA] = useState(false);
  const [showQAGrid, setShowQAGrid] = useState(false);
  const [expandedScreenshot, setExpandedScreenshot] = useState<number | null>(null);
  const [qaFixInput, setQaFixInput] = useState("");

  // QA Agent (job-based)
  const [qaChildJobs, setQaChildJobs] = useState<any[]>([]);
  const qaJob = getJobByType('qa_scenes');
  const qaJobRunning = !!qaJob && qaJob.status === 'processing';
  const qaLogEndRef = useRef<HTMLDivElement>(null);

  const seekToScene = useCallback((sceneIndex: number) => {
    if (!previewMeta || !segments[sceneIndex]) return;
    const seg = segments[sceneIndex];
    const targetTime = seg.start + (seg.end - seg.start) * 0.8;
    const frame = Math.round(targetTime * previewMeta.fps);
    iframeRef.current?.contentWindow?.postMessage({ type: "remotion-seek", frame }, "*");
    iframeRef.current?.contentWindow?.postMessage({ type: "remotion-pause" }, "*");
  }, [previewMeta, segments]);

  const navigateScreenshot = useCallback((direction: "next" | "prev") => {
    if (qaScreenshots.length === 0 || expandedScreenshot == null) return;
    const newIdx = direction === "next"
      ? (expandedScreenshot + 1) % qaScreenshots.length
      : (expandedScreenshot - 1 + qaScreenshots.length) % qaScreenshots.length;
    setExpandedScreenshot(newIdx);
    seekToScene(newIdx);
  }, [expandedScreenshot, qaScreenshots.length, seekToScene]);

  // Keyboard navigation for QA grid
  useEffect(() => {
    if (!showQAGrid || expandedScreenshot == null || qaScreenshots.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateScreenshot("next");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateScreenshot("prev");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showQAGrid, expandedScreenshot, qaScreenshots.length]);

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

  const sendEdit = useCallback(async (opts?: { screenshotUrl?: string; overrideInstruction?: string; overrideSceneIndex?: number; agentMode?: boolean }): Promise<{ success: boolean; tokens?: { input: number; output: number } }> => {
    const instruction = opts?.overrideInstruction || chatInput.trim();
    const sceneIdx = opts?.overrideSceneIndex ?? activeSceneIndex;
    const agent = opts?.agentMode ?? false;
    if (!instruction || sceneIdx == null || isEditing) return { success: false };

    if (!agent && !opts?.overrideInstruction) setChatInput("");
    if (!agent) {
      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: instruction + (opts?.screenshotUrl ? " 📷" : ""), sceneIndex: sceneIdx },
      ]);
    }
    setIsEditing(true);

    try {
      const body: any = { projectId, sceneIndex: sceneIdx, instruction };
      if (opts?.screenshotUrl) body.screenshotUrl = opts.screenshotUrl;
      const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/edit-scene`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Edit failed");

      const editTokens = data.tokens;

      if (!agent) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Scene ${sceneIdx + 1} modifiée. Mise à jour...`, sceneIndex: sceneIdx },
        ]);
      }

      // In agent mode, skip preview rebuild (agent will rebuild once at end)
      if (!agent) {
        resumeFrameRef.current = currentFrame;
        setIsRebuilding(true);
        try {
          const resp2 = await fetch(`${REMOTION_SERVICE_URL}/animator/preview-bundle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
          });
          const data2 = await resp2.json();
          if (!resp2.ok) throw new Error(data2.error || "Preview rebuild failed");
          setPreviewUrl(data2.previewUrl);
          if (data2.segments) setSegments(data2.segments);
        } finally {
          setIsRebuilding(false);
        }
      }

      // Refresh QA screenshot if the grid is open and has this scene
      if (qaScreenshots.length > 0 && qaScreenshots.some(s => s.sceneIndex === sceneIdx)) {
        setQaScreenshots((prev) =>
          prev.map((s) => s.sceneIndex === sceneIdx ? { ...s, success: true, url: null, error: undefined } : s)
        );
        try {
          const resp3 = await fetch(`${REMOTION_SERVICE_URL}/animator/qa-screenshots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, sceneIndex: sceneIdx }),
          });
          const data3 = await resp3.json();
          if (data3.screenshot) {
            setQaScreenshots((prev) =>
              prev.map((s) => s.sceneIndex === sceneIdx ? data3.screenshot : s)
            );
            if (!agent) toast.success(`Screenshot scène ${sceneIdx + 1} mis à jour`);
          }
        } catch (e) {
          console.warn("[AnimatorPreview] Screenshot refresh failed:", e);
        }
      }

      return { success: true, tokens: editTokens };
    } catch (err: any) {
      console.error("[AnimatorPreview] Edit error:", err);
      if (!agent) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Erreur: ${err.message}`, sceneIndex: sceneIdx },
        ]);
        toast.error(`Erreur: ${err.message}`);
      }
      return { success: false };
    } finally {
      setIsEditing(false);
    }
  }, [chatInput, activeSceneIndex, isEditing, projectId, currentFrame, qaScreenshots.length]);

  const loadQAScreenshots = useCallback(async () => {
    if (!projectId || isLoadingQA) return;
    setIsLoadingQA(true);
    setShowQAGrid(true);
    try {
      const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/qa-screenshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "QA screenshots failed");
      setQaScreenshots(data.screenshots || []);
      const failed = data.failed || 0;
      if (failed > 0) {
        toast.warning(`${data.completed}/${data.total} screenshots générés (${failed} en erreur)`);
      } else {
        toast.success(`${data.total} screenshots générés`);
      }
    } catch (err: any) {
      console.error("[AnimatorPreview] QA error:", err);
      toast.error(`Erreur QA: ${err.message}`);
    } finally {
      setIsLoadingQA(false);
    }
  }, [projectId, isLoadingQA]);

  // Poll QA child jobs for live progress
  useEffect(() => {
    if (!qaJob) { setQaChildJobs([]); return; }
    const fetchChildren = async () => {
      const { data } = await supabase
        .from('generation_jobs')
        .select('id, status, metadata, created_at')
        .eq('parent_job_id', qaJob.id)
        .order('created_at', { ascending: true });
      if (data) setQaChildJobs(data);
    };
    fetchChildren();
    const interval = setInterval(fetchChildren, 3000);
    return () => clearInterval(interval);
  }, [qaJob?.id, qaJob?.status, qaJob?.progress]);

  // Auto-scroll QA log
  useEffect(() => {
    const el = qaLogEndRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [qaChildJobs]);

  const launchQAAgent = useCallback(async () => {
    if (!projectId || hasActiveJob('qa_scenes')) return;
    setShowQAGrid(true);
    await startJob('qa_scenes', {});
  }, [projectId, startJob, hasActiveJob]);

  const stopQAAgent = useCallback(async () => {
    if (qaJob) await cancelJob(qaJob.id);
  }, [qaJob, cancelJob]);

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
              <Button
                variant="outline"
                size="sm"
                onClick={loadQAScreenshots}
                disabled={isLoadingQA}
                className="gap-1.5"
              >
                {isLoadingQA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                QA Visuel
              </Button>
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
            {isRebuilding && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-xl">
                <div className="flex items-center gap-2 bg-black/70 px-4 py-2 rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                  <span className="text-sm text-white/80">Mise à jour...</span>
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0"
              allow="autoplay"
              title="Animator Preview"
              onLoad={() => {
                if (resumeFrameRef.current != null && iframeRef.current?.contentWindow) {
                  const frame = resumeFrameRef.current;
                  resumeFrameRef.current = null;
                  // Small delay to let the Player mount
                  setTimeout(() => {
                    iframeRef.current?.contentWindow?.postMessage({ type: "remotion-seek", frame }, "*");
                    iframeRef.current?.contentWindow?.postMessage({ type: "remotion-pause" }, "*");
                  }, 500);
                }
              }}
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

          {/* QA Screenshot Grid */}
          {showQAGrid && (
            <Card className="border border-border overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium">QA Visuel</span>
                  {qaScreenshots.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {qaScreenshots.filter(s => s.success).length}/{qaScreenshots.length} scenes
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {qaScreenshots.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={loadQAScreenshots} disabled={isLoadingQA} className="h-7 px-2">
                      <RefreshCw className={`h-3 w-3 ${isLoadingQA ? "animate-spin" : ""}`} />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setShowQAGrid(false)} className="h-7 px-2">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {isLoadingQA && qaScreenshots.length === 0 && (
                <div className="p-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-purple-500 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Capture des screenshots en cours...</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">~1s par scène</p>
                </div>
              )}

              {qaScreenshots.length > 0 && (
                <div className="p-2 grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-1.5 max-h-[500px] overflow-y-auto">
                  {qaScreenshots.map((shot) => (
                    <div
                      key={shot.sceneIndex}
                      className={`relative group cursor-pointer rounded overflow-hidden border ${
                        expandedScreenshot === shot.sceneIndex ? "border-purple-500 ring-1 ring-purple-500/50" :
                        shot.success ? "border-border hover:border-purple-500/50" : "border-red-500/30 bg-red-500/5"
                      } transition-all`}
                      onClick={() => {
                        if (shot.success) {
                          seekToScene(shot.sceneIndex);
                          setExpandedScreenshot(shot.sceneIndex);
                        }
                      }}
                    >
                      {shot.success && shot.url ? (
                        <img
                          src={shot.url}
                          alt={`Scene ${shot.sceneIndex + 1}`}
                          className="w-full aspect-video object-cover"
                          loading="lazy"
                        />
                      ) : shot.success && !shot.url ? (
                        <div className="w-full aspect-video flex items-center justify-center bg-purple-500/5">
                          <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                        </div>
                      ) : (
                        <div className="w-full aspect-video flex items-center justify-center">
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80 flex justify-between">
                        <span>{shot.sceneIndex + 1}</span>
                        <span>{shot.timestamp.toFixed(1)}s</span>
                      </div>
                      {shot.success && (
                        <div className="absolute inset-0 bg-purple-500/0 group-hover:bg-purple-500/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 text-[10px] px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              seekToScene(shot.sceneIndex);
                            }}
                          >
                            Voir
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded screenshot with nav */}
              {expandedScreenshot != null && (() => {
                const shot = qaScreenshots.find(s => s.sceneIndex === expandedScreenshot);
                if (!shot) return null;
                return (
                  <div className="p-3 border-t border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => navigateScreenshot("prev")}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-medium">
                          Scene {shot.sceneIndex + 1}/{qaScreenshots.length} — {shot.timestamp.toFixed(1)}s
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => navigateScreenshot("next")}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <span className="text-[10px] text-muted-foreground/50">← →</span>
                      </div>
                      <div className="flex gap-1">
                      </div>
                    </div>
                    {shot.url ? (
                      <img
                        src={shot.url}
                        alt={`Scene ${shot.sceneIndex + 1}`}
                        className="w-full rounded border border-border"
                      />
                    ) : (
                      <div className="w-full rounded border border-border bg-muted/30 flex items-center justify-center" style={{ aspectRatio: "16/9" }}>
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                          <span className="text-xs text-muted-foreground">Capture en cours...</span>
                        </div>
                      </div>
                    )}
                    {/* AI Fix area */}
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={qaFixInput}
                        onChange={(e) => setQaFixInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && qaFixInput.trim() && shot.url) {
                            e.preventDefault();
                            sendEdit({
                              overrideSceneIndex: shot.sceneIndex,
                              overrideInstruction: qaFixInput.trim(),
                              screenshotUrl: shot.url,
                            });
                            setQaFixInput("");
                          }
                        }}
                        placeholder="Décrivez le problème à corriger..."
                        disabled={isEditing || !shot.url}
                        className="text-sm h-9"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 px-3 gap-1.5 shrink-0"
                        disabled={isEditing || !qaFixInput.trim() || !shot.url}
                        onClick={() => {
                          if (qaFixInput.trim() && shot.url) {
                            sendEdit({
                              overrideSceneIndex: shot.sceneIndex,
                              overrideInstruction: qaFixInput.trim(),
                              screenshotUrl: shot.url,
                            });
                            setQaFixInput("");
                          }
                        }}
                      >
                        {isEditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        className="h-9 px-3 gap-1.5 shrink-0 bg-purple-600 hover:bg-purple-700"
                        disabled={isEditing || !shot.url}
                        onClick={() => {
                          if (shot.url) {
                            const base = "Fix the visual issues in this scene. Ensure text is readable, properly positioned, and doesn't overlap. Fix any layout or animation problems visible in the screenshot, usually by repositioning or resizing element.";
                            const instruction = qaFixInput.trim() ? `${base}\n\nAdditional context: ${qaFixInput.trim()}` : base;
                            sendEdit({
                              overrideSceneIndex: shot.sceneIndex,
                              overrideInstruction: instruction,
                              screenshotUrl: shot.url,
                            });
                            setQaFixInput("");
                          }
                        }}
                      >
                        {isEditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                        Fix it
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </Card>
          )}

          {/* QA Agent (job-based) */}
          {(showQAGrid || qaJob || qaChildJobs.length > 0) && (() => {
            const total = qaJob?.total || qaChildJobs.length;
            const completed = qaChildJobs.filter(j => j.status === 'completed');
            const failed = qaChildJobs.filter(j => j.status === 'failed');
            const processing = qaChildJobs.filter(j => j.status === 'processing');
            const done = completed.length + failed.length;
            const passed = completed.filter(j => j.metadata?.pass).length;
            const fixed = completed.filter(j => j.metadata?.fixed).length;
            const gavUp = completed.filter(j => j.metadata?.pass === false).length;
            const qaTokens = qaJob?.metadata?.tokens || { input: 0, output: 0 };
            const isQaDone = qaJob?.status === 'completed' || qaJob?.status === 'cancelled';

            return (
              <Card className="border border-border overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium">QA Agent</span>
                    {qaJobRunning && (
                      <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]">
                        {processing.length} en cours
                      </Badge>
                    )}
                    {isQaDone && qaJob?.status === 'completed' && (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                        Terminé
                      </Badge>
                    )}
                    {qaJob?.status === 'cancelled' && (
                      <Badge variant="secondary" className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                        Annulé
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!qaJobRunning ? (
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700"
                        onClick={launchQAAgent}
                        disabled={isLoadingQA || hasActiveJob('qa_scenes')}
                      >
                        <Eye className="h-3 w-3" />
                        Lancer
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs gap-1.5"
                        onClick={stopQAAgent}
                      >
                        <Square className="h-3 w-3" />
                        Stop
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {total > 0 && (
                  <div className="px-3 pt-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>{done}/{total} vérifiées</span>
                      <span>
                        <span className="text-green-400">{passed} OK</span>
                        {fixed > 0 && <span className="text-blue-400 ml-2">{fixed} corrigées</span>}
                        {gavUp > 0 && <span className="text-orange-400 ml-2">{gavUp} non corrigées</span>}
                        {failed.length > 0 && <span className="text-red-400 ml-2">{failed.length} erreurs</span>}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all duration-300"
                        style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Live log from child jobs — only show notable events */}
                {qaChildJobs.length > 0 && (() => {
                  const notable = qaChildJobs.filter(j =>
                    j.status === 'processing' ||
                    j.status === 'failed' ||
                    (j.status === 'completed' && j.metadata?.fixed) ||
                    (j.status === 'completed' && j.metadata?.pass === false)
                  );
                  return (
                    <div className="p-2 max-h-60 overflow-y-auto space-y-0.5">
                      {notable.length === 0 && done > 0 && (
                        <div className="text-[11px] text-muted-foreground/60 px-1.5 py-0.5">
                          Aucun problème détecté pour l'instant...
                        </div>
                      )}
                      {notable.map((job) => {
                        const si = job.metadata?.sceneIndex ?? 0;
                        const isFixed = job.status === 'completed' && job.metadata?.fixed;
                        const isFailed = job.status === 'completed' && job.metadata?.pass === false;
                        const isError = job.status === 'failed';
                        const isProcessing = job.status === 'processing';

                        return (
                          <div key={job.id} className="flex items-start gap-1.5 text-[11px] py-0.5 px-1.5 rounded hover:bg-muted/30">
                            {isProcessing && <Loader2 className="h-3 w-3 mt-0.5 animate-spin text-purple-400 shrink-0" />}
                            {isFixed && <Check className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />}
                            {isFailed && <AlertTriangle className="h-3 w-3 mt-0.5 text-orange-400 shrink-0" />}
                            {isError && <XCircle className="h-3 w-3 mt-0.5 text-red-400 shrink-0" />}
                            <span className={`${
                              isFixed ? "text-blue-400/80" :
                              isFailed ? "text-orange-400/80" :
                              isError ? "text-red-400/80" :
                              "text-purple-400/80"
                            }`}>
                              Scène {si + 1}
                              {isFixed && ` — Corrigée: ${job.metadata?.issue || "fix appliqué"}`}
                              {isFailed && ` — ${job.metadata?.issue || "Non corrigée"}`}
                              {isError && ` — Erreur: ${job.error_message || "screenshot indisponible"}`}
                              {isProcessing && " — Analyse..."}
                            </span>
                          </div>
                        );
                      })}
                      <div ref={qaLogEndRef} />
                    </div>
                  );
                })()}

                {/* Token tracker */}
                {(qaTokens.input > 0 || qaTokens.output > 0) && (
                  <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Tokens: {qaTokens.input.toLocaleString()} in / {qaTokens.output.toLocaleString()} out</span>
                  </div>
                )}
              </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}
