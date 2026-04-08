import { useState, useCallback, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw, ExternalLink, Send, Sparkles, Camera, X, AlertTriangle, ChevronLeft, ChevronRight, Wrench, Bot, Square, Check, XCircle, Eye } from "lucide-react";
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

interface QAScreenshot {
  sceneIndex: number;
  timestamp: number;
  success: boolean;
  url: string | null;
  error?: string;
}

interface AgentLogEntry {
  sceneIndex: number;
  status: "analyzing" | "pass" | "fail" | "fixing" | "fixed" | "gave_up";
  message: string;
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

  // QA Agent
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [agentProgress, setAgentProgress] = useState({ checked: 0, passed: 0, fixed: 0, failed: 0, total: 0 });
  const [agentTokens, setAgentTokens] = useState({ input: 0, output: 0, cost: 0 });
  const agentAbortRef = useRef(false);
  const agentLogEndRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll agent log
  useEffect(() => {
    agentLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLog]);

  const GEMINI_QA_PRICES = { input: 0.10, output: 0.40 }; // gemini-2.0-flash per M tokens

  const runQAAgent = useCallback(async () => {
    if (agentRunning || !projectId) return;

    agentAbortRef.current = false;
    setAgentRunning(true);
    setAgentLog([]);
    setAgentProgress({ checked: 0, passed: 0, fixed: 0, failed: 0, total: 0 });
    setAgentTokens({ input: 0, output: 0, cost: 0 });

    // Step 1: ensure we have screenshots
    let screenshots = qaScreenshots;
    if (screenshots.length === 0) {
      setShowQAGrid(true);
      setIsLoadingQA(true);
      try {
        const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/qa-screenshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "QA screenshots failed");
        screenshots = data.screenshots || [];
        setQaScreenshots(screenshots);
      } catch (err: any) {
        toast.error(`Erreur QA: ${err.message}`);
        setAgentRunning(false);
        setIsLoadingQA(false);
        return;
      } finally {
        setIsLoadingQA(false);
      }
    }

    const successShots = screenshots.filter(s => s.success && s.url);
    setAgentProgress(p => ({ ...p, total: successShots.length }));

    const MAX_RETRIES = 2;

    for (let i = 0; i < successShots.length; i++) {
      if (agentAbortRef.current) {
        setAgentLog(prev => [...prev, { sceneIndex: -1, status: "gave_up", message: "Agent arrêté par l'utilisateur" }]);
        break;
      }

      const shot = successShots[i];
      const si = shot.sceneIndex;

      // Analyze
      setAgentLog(prev => [...prev, { sceneIndex: si, status: "analyzing", message: `Analyse scène ${si + 1}...` }]);

      let analyzeResult: { pass: boolean; issue: string | null; tokens?: { input: number; output: number } };
      try {
        const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/qa-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, sceneIndex: si, screenshotUrl: shot.url }),
        });
        analyzeResult = await resp.json();
        if (!resp.ok) throw new Error((analyzeResult as any).error || "Analyze failed");
      } catch (err: any) {
        setAgentLog(prev => {
          const next = [...prev];
          next[next.length - 1] = { sceneIndex: si, status: "gave_up", message: `Erreur analyse: ${err.message}` };
          return next;
        });
        setAgentProgress(p => ({ ...p, checked: p.checked + 1, failed: p.failed + 1 }));
        continue;
      }

      // Accumulate QA tokens
      if (analyzeResult.tokens) {
        setAgentTokens(prev => {
          const inp = prev.input + analyzeResult.tokens!.input;
          const out = prev.output + analyzeResult.tokens!.output;
          return { input: inp, output: out, cost: (inp * GEMINI_QA_PRICES.input + out * GEMINI_QA_PRICES.output) / 1_000_000 };
        });
      }

      if (analyzeResult.pass) {
        setAgentLog(prev => {
          const next = [...prev];
          next[next.length - 1] = { sceneIndex: si, status: "pass", message: `Scène ${si + 1} OK` };
          return next;
        });
        setAgentProgress(p => ({ ...p, checked: p.checked + 1, passed: p.passed + 1 }));
        continue;
      }

      // Issue detected
      const issue = analyzeResult.issue || "Visual issue detected";
      setAgentLog(prev => {
        const next = [...prev];
        next[next.length - 1] = { sceneIndex: si, status: "fail", message: `Scène ${si + 1}: ${issue}` };
        return next;
      });

      // Retry loop
      let fixed = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (agentAbortRef.current) break;

        setAgentLog(prev => [...prev, { sceneIndex: si, status: "fixing", message: `Fix scène ${si + 1} (tentative ${attempt}/${MAX_RETRIES})...` }]);

        // Get current screenshot URL (might have been updated)
        const currentShot = qaScreenshots.find(s => s.sceneIndex === si) || shot;
        const editResult = await sendEdit({
          overrideSceneIndex: si,
          overrideInstruction: `Fix this visual issue: ${issue}. Ensure text is readable, properly positioned, and doesn't overlap. Fix any layout or animation problems, usually by repositioning or resizing elements.`,
          screenshotUrl: currentShot.url || shot.url!,
          agentMode: true,
        });

        if (editResult.tokens) {
          setAgentTokens(prev => ({
            input: prev.input + (editResult.tokens!.input || 0),
            output: prev.output + (editResult.tokens!.output || 0),
            cost: prev.cost + ((editResult.tokens!.input || 0) * GEMINI_QA_PRICES.input + (editResult.tokens!.output || 0) * GEMINI_QA_PRICES.output) / 1_000_000,
          }));
        }

        if (!editResult.success) {
          setAgentLog(prev => {
            const next = [...prev];
            next[next.length - 1] = { sceneIndex: si, status: "gave_up", message: `Fix scène ${si + 1} échoué` };
            return next;
          });
          break;
        }

        // Wait a moment for screenshot refresh to complete, then get updated URL
        await new Promise(r => setTimeout(r, 2000));
        const updatedShot = qaScreenshots.find(s => s.sceneIndex === si);

        // Re-take screenshot
        let newScreenshotUrl = updatedShot?.url || shot.url;
        try {
          const ssResp = await fetch(`${REMOTION_SERVICE_URL}/animator/qa-screenshots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, sceneIndex: si }),
          });
          const ssData = await ssResp.json();
          if (ssData.screenshot?.url) {
            newScreenshotUrl = ssData.screenshot.url;
            setQaScreenshots(prev => prev.map(s => s.sceneIndex === si ? ssData.screenshot : s));
          }
        } catch (e) { /* keep old URL */ }

        // Re-analyze
        try {
          const resp2 = await fetch(`${REMOTION_SERVICE_URL}/animator/qa-analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, sceneIndex: si, screenshotUrl: newScreenshotUrl }),
          });
          const recheck = await resp2.json();
          if (recheck.tokens) {
            setAgentTokens(prev => {
              const inp = prev.input + recheck.tokens.input;
              const out = prev.output + recheck.tokens.output;
              return { input: inp, output: out, cost: (inp * GEMINI_QA_PRICES.input + out * GEMINI_QA_PRICES.output) / 1_000_000 };
            });
          }
          if (recheck.pass) {
            setAgentLog(prev => {
              const next = [...prev];
              next[next.length - 1] = { sceneIndex: si, status: "fixed", message: `Scène ${si + 1} corrigée !` };
              return next;
            });
            fixed = true;
            break;
          }
        } catch (e) { /* continue retrying */ }
      }

      if (!fixed && !agentAbortRef.current) {
        setAgentLog(prev => [...prev, { sceneIndex: si, status: "gave_up", message: `Scène ${si + 1}: abandon après ${MAX_RETRIES} tentatives` }]);
      }

      setAgentProgress(p => ({
        ...p,
        checked: p.checked + 1,
        ...(fixed ? { fixed: p.fixed + 1 } : { failed: p.failed + 1 }),
      }));
    }

    // Rebuild preview once at the end if any fixes were made
    setAgentLog(prev => [...prev, { sceneIndex: -1, status: "pass", message: "QA Agent terminé." }]);

    if (agentProgress.fixed > 0 || agentProgress.failed > 0) {
      setIsRebuilding(true);
      try {
        const resp = await fetch(`${REMOTION_SERVICE_URL}/animator/preview-bundle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        const data = await resp.json();
        if (resp.ok) {
          setPreviewUrl(data.previewUrl);
          if (data.segments) setSegments(data.segments);
        }
      } finally {
        setIsRebuilding(false);
      }
    }

    setAgentRunning(false);
  }, [agentRunning, projectId, qaScreenshots, sendEdit, loadQAScreenshots]);

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

          {/* QA Agent */}
          {(showQAGrid || agentRunning || agentLog.length > 0) && (
            <Card className="border border-border overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium">QA Agent</span>
                  {agentRunning && (
                    <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]">
                      En cours
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!agentRunning ? (
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700"
                      onClick={runQAAgent}
                      disabled={isLoadingQA}
                    >
                      <Eye className="h-3 w-3" />
                      Lancer
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => { agentAbortRef.current = true; }}
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {agentProgress.total > 0 && (
                <div className="px-3 pt-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>{agentProgress.checked}/{agentProgress.total} vérifiées</span>
                    <span>
                      <span className="text-green-400">{agentProgress.passed} OK</span>
                      {agentProgress.fixed > 0 && <span className="text-blue-400 ml-2">{agentProgress.fixed} corrigées</span>}
                      {agentProgress.failed > 0 && <span className="text-red-400 ml-2">{agentProgress.failed} échouées</span>}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${agentProgress.total > 0 ? (agentProgress.checked / agentProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Live log */}
              {agentLog.length > 0 && (
                <div className="p-2 max-h-60 overflow-y-auto space-y-0.5">
                  {agentLog.map((entry, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] py-0.5 px-1.5 rounded hover:bg-muted/30">
                      {entry.status === "analyzing" && <Loader2 className="h-3 w-3 mt-0.5 animate-spin text-purple-400 shrink-0" />}
                      {entry.status === "pass" && <Check className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />}
                      {entry.status === "fail" && <AlertTriangle className="h-3 w-3 mt-0.5 text-orange-400 shrink-0" />}
                      {entry.status === "fixing" && <Loader2 className="h-3 w-3 mt-0.5 animate-spin text-blue-400 shrink-0" />}
                      {entry.status === "fixed" && <Check className="h-3 w-3 mt-0.5 text-blue-400 shrink-0" />}
                      {entry.status === "gave_up" && <XCircle className="h-3 w-3 mt-0.5 text-red-400 shrink-0" />}
                      <span className={`${
                        entry.status === "pass" ? "text-green-400/80" :
                        entry.status === "fail" ? "text-orange-400/80" :
                        entry.status === "fixed" ? "text-blue-400/80" :
                        entry.status === "gave_up" ? "text-red-400/80" :
                        "text-muted-foreground"
                      }`}>
                        {entry.message}
                      </span>
                    </div>
                  ))}
                  <div ref={agentLogEndRef} />
                </div>
              )}

              {/* Token tracker */}
              {(agentTokens.input > 0 || agentTokens.output > 0) && (
                <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Tokens: {agentTokens.input.toLocaleString()} in / {agentTokens.output.toLocaleString()} out</span>
                  <span className="font-medium text-purple-400">${agentTokens.cost.toFixed(4)}</span>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
