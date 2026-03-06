import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Play, Download, Volume2, Square, Clock, Trash2, AlertCircle, Upload, Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TtsMode = "custom_voice" | "voice_clone" | "voice_design";

const SPEAKERS = [
  { id: "Serena", label: "Serena (female, warm)" },
  { id: "Ethan", label: "Ethan (male, neutral)" },
  { id: "Aria", label: "Aria (female, expressive)" },
  { id: "Benjamin", label: "Benjamin (male, deep)" },
  { id: "Clara", label: "Clara (female, bright)" },
  { id: "Daniel", label: "Daniel (male, calm)" },
];

const LANGUAGES = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Español" },
  { id: "de", label: "Deutsch" },
  { id: "it", label: "Italiano" },
  { id: "pt", label: "Português" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "zh", label: "中文" },
  { id: "ru", label: "Русский" },
];

interface HistoryJob {
  id: string;
  status: string;
  created_at: string;
  metadata: any;
  error_message: string | null;
  progress: number | null;
  total: number | null;
}

interface Qwen3TTSGeneratorProps {
  initialText?: string;
}

export function Qwen3TTSGenerator({ initialText }: Qwen3TTSGeneratorProps) {
  const [text, setText] = useState(initialText || "");
  const [mode, setMode] = useState<TtsMode>("custom_voice");
  const [speaker, setSpeaker] = useState("Serena");
  const [language, setLanguage] = useState("auto");
  const [styleInstruction, setStyleInstruction] = useState("");
  const [voiceDescription, setVoiceDescription] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceAudioUrl, setReferenceAudioUrl] = useState<string | null>(null);
  const [referenceFileName, setReferenceFileName] = useState<string | null>(null);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // RVC settings
  const [rvcEnabled, setRvcEnabled] = useState(false);
  const [rvcModelUrl, setRvcModelUrl] = useState("");
  const [rvcIndexUrl, setRvcIndexUrl] = useState("");
  const [rvcPitch, setRvcPitch] = useState(0);
  const [rvcIndexRate, setRvcIndexRate] = useState(0.75);

  useEffect(() => {
    if (initialText && !text) setText(initialText);
  }, [initialText]);

  useEffect(() => {
    fetchHistory();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const fetchHistory = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from("generation_jobs")
      .select("id, status, created_at, metadata, error_message, progress, total")
      .eq("user_id", session.user.id)
      .eq("job_type", "audio_generation" as any)
      .in("status", ["completed", "failed", "processing", "pending"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      const qwenJobs = (data as unknown as HistoryJob[]).filter(
        (j) => j.metadata?.provider === "qwen3_tts"
      );
      setHistory(qwenJobs);
    }
  };

  const pollJob = useCallback((jId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      const { data, error } = await supabase
        .from("generation_jobs")
        .select("*")
        .eq("id", jId)
        .single();

      if (error || !data) return;

      setJobStatus(data.status);

      if (data.status === "completed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        const audioUrl = (data.metadata as any)?.audioUrl;
        if (audioUrl) {
          setGeneratedAudioUrl(audioUrl);
          toast.success("Audio generated successfully!");
        }
        setIsGenerating(false);
        fetchHistory();
      } else if (data.status === "failed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        toast.error(`Error: ${data.error_message || "Audio generation failed"}`);
        setIsGenerating(false);
        fetchHistory();
      } else if (data.status === "cancelled") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setIsGenerating(false);
        fetchHistory();
      }
    }, 3000);
  }, []);

  const handleUploadReferenceAudio = async (file: File) => {
    setIsUploadingRef(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop();
      const fileName = `${user.id}/qwen3-ref/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("audio-files")
        .upload(fileName, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("audio-files").getPublicUrl(fileName);
      setReferenceAudioUrl(publicUrl);
      setReferenceFileName(file.name);
      toast.success("Reference audio uploaded");
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setIsUploadingRef(false);
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Entrez du texte à convertir en audio");
      return;
    }
    if (mode === "voice_clone" && !referenceAudioUrl) {
      toast.error("Uploadez un audio de référence pour le clonage vocal");
      return;
    }
    if (mode === "voice_design" && !voiceDescription.trim()) {
      toast.error("Entrez une description de la voix souhaitée");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Vous devez être connecté");
      return;
    }

    setIsGenerating(true);
    setGeneratedAudioUrl(null);
    setJobStatus("pending");

    try {
      const metadata: Record<string, any> = {
        text: text.trim(),
        provider: "qwen3_tts",
        mode,
        language,
        standalone: true,
      };

      if (styleInstruction.trim()) metadata.styleInstruction = styleInstruction.trim();

      if (mode === "custom_voice") {
        metadata.speaker = speaker;
      } else if (mode === "voice_clone") {
        metadata.referenceAudioUrl = referenceAudioUrl;
        if (referenceText.trim()) metadata.referenceText = referenceText.trim();
      } else if (mode === "voice_design") {
        metadata.voiceDescription = voiceDescription.trim();
      }

      if (rvcEnabled && rvcModelUrl) {
        metadata.rvcEnabled = true;
        metadata.rvcModelUrl = rvcModelUrl;
        metadata.rvcIndexUrl = rvcIndexUrl;
        metadata.rvcPitch = rvcPitch;
        metadata.rvcIndexRate = rvcIndexRate;
      }

      const { data, error } = await supabase
        .from("generation_jobs")
        .insert({
          job_type: "audio_generation" as any,
          status: "pending" as any,
          user_id: session.user.id,
          project_id: null,
          progress: 0,
          total: 1,
          metadata,
        })
        .select()
        .single();

      if (error) throw error;

      setJobId(data.id);
      toast.success("Génération Qwen3-TTS lancée.");
      pollJob(data.id);
      fetchHistory();
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
      setIsGenerating(false);
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    await supabase
      .from("generation_jobs")
      .update({ status: "cancelled" as any })
      .eq("id", jobId);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setIsGenerating(false);
    setJobStatus(null);
    toast.info("Génération annulée");
    fetchHistory();
  };

  const handleDeleteJob = async (id: string) => {
    await supabase.from("generation_jobs").delete().eq("id", id);
    setHistory((prev) => prev.filter((j) => j.id !== id));
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const modeLabel = (m: TtsMode) => {
    switch (m) {
      case "custom_voice": return "Voix prédéfinie";
      case "voice_clone": return "Clonage vocal";
      case "voice_design": return "Design vocal";
    }
  };

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const completedJobs = history.filter((j) => j.status === "completed" && j.metadata?.audioUrl);
  const activeJobs = history.filter((j) => j.status === "processing" || j.status === "pending");
  const failedJobs = history.filter((j) => j.status === "failed");

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Qwen3 TTS Audio Generator</h3>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Replicate</span>
        </div>

        {/* Text input */}
        <div className="space-y-2">
          <Label htmlFor="qwen3-text">Texte à convertir</Label>
          <Textarea
            id="qwen3-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Collez ou tapez votre script ici..."
            className="min-h-[200px] text-sm"
            disabled={isGenerating}
          />
          <p className="text-xs text-muted-foreground">
            {wordCount} mots &middot; Qwen3-TTS supporte jusqu'a 10 min d'audio continu
          </p>
        </div>

        {/* Mode + Language */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as TtsMode)} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom_voice">Voix prédéfinie</SelectItem>
                <SelectItem value="voice_clone">Clonage vocal</SelectItem>
                <SelectItem value="voice_design">Design vocal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Langue</Label>
            <Select value={language} onValueChange={setLanguage} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Mode-specific controls */}
        {mode === "custom_voice" && (
          <div className="space-y-2">
            <Label>Speaker</Label>
            <Select value={speaker} onValueChange={setSpeaker} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEAKERS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === "voice_clone" && (
          <div className="space-y-4 p-4 bg-muted/50 rounded-lg border border-primary/20">
            <div className="space-y-2">
              <Label>Audio de référence (3s minimum)</Label>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={isGenerating || isUploadingRef}
                  onClick={() => document.getElementById("ref-audio-input")?.click()}
                >
                  {isUploadingRef ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {referenceFileName || "Choisir un fichier audio"}
                </Button>
                <input
                  id="ref-audio-input"
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadReferenceAudio(file);
                  }}
                />
                {referenceAudioUrl && (
                  <audio controls className="h-8 flex-1">
                    <source src={referenceAudioUrl} />
                  </audio>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Uploadez un court extrait audio de la voix que vous souhaitez cloner.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Transcription de l'audio de référence (recommandé)</Label>
              <Textarea
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder="Tapez le texte exact prononcé dans l'audio de référence..."
                className="min-h-[80px] text-sm"
                disabled={isGenerating}
              />
            </div>
          </div>
        )}

        {mode === "voice_design" && (
          <div className="space-y-2">
            <Label>Description de la voix souhaitée</Label>
            <Textarea
              value={voiceDescription}
              onChange={(e) => setVoiceDescription(e.target.value)}
              placeholder="Ex: A warm, energetic male narrator with a slight French accent, medium-fast pace, confident tone..."
              className="min-h-[100px] text-sm"
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground">
              Décrivez en langage naturel la voix que vous voulez créer.
            </p>
          </div>
        )}

        {/* Style instruction */}
        <div className="space-y-2">
          <Label>Style instruction (optionnel)</Label>
          <Input
            value={styleInstruction}
            onChange={(e) => setStyleInstruction(e.target.value)}
            placeholder="Ex: speak slowly and calmly, excited tone..."
            disabled={isGenerating}
          />
        </div>

        {/* RVC Voice Conversion */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Conversion de voix (RVC)</Label>
              <p className="text-xs text-muted-foreground">
                Convertir l'audio généré avec un modèle de voix RVC via GPU (RunPod).
              </p>
            </div>
            <input
              type="checkbox"
              checked={rvcEnabled}
              onChange={(e) => setRvcEnabled(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
              disabled={isGenerating}
            />
          </div>

          {rvcEnabled && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border border-primary/20">
              <div className="space-y-2">
                <Label>URL du modèle RVC (.pth)</Label>
                <Input
                  value={rvcModelUrl}
                  onChange={(e) => setRvcModelUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../model.pth"
                  disabled={isGenerating}
                />
              </div>
              <div className="space-y-2">
                <Label>URL de l'index RVC (.index) — optionnel</Label>
                <Input
                  value={rvcIndexUrl}
                  onChange={(e) => setRvcIndexUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../model.index"
                  disabled={isGenerating}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Pitch (demi-tons)</Label>
                  <input
                    type="number"
                    min="-24"
                    max="24"
                    step="1"
                    value={rvcPitch}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v)) setRvcPitch(Math.min(24, Math.max(-24, v)));
                    }}
                    className="w-16 text-right text-sm bg-muted border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={isGenerating}
                  />
                </div>
                <input
                  type="range" min="-24" max="24" step="1" value={rvcPitch}
                  onChange={(e) => setRvcPitch(parseInt(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-24 (grave)</span><span>0</span><span>+24 (aigu)</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Index Rate</Label>
                  <input
                    type="number"
                    min="0" max="1" step="0.05"
                    value={rvcIndexRate}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setRvcIndexRate(Math.min(1, Math.max(0, v)));
                    }}
                    className="w-16 text-right text-sm bg-muted border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={isGenerating}
                  />
                </div>
                <input
                  type="range" min="0" max="1" step="0.05" value={rvcIndexRate}
                  onChange={(e) => setRvcIndexRate(parseFloat(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0</span><span>0.75</span><span>1.0</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Generation status */}
        {isGenerating && (
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {jobStatus === "pending"
                  ? "En attente du worker..."
                  : "Génération en cours..."}
              </span>
            </div>
            <Progress value={jobStatus === "processing" ? 50 : 10} className="h-2" />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !text.trim()}
            className="flex-1"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Generate Audio{rvcEnabled ? " + RVC" : ""}
              </>
            )}
          </Button>
          {isGenerating && (
            <Button variant="outline" onClick={handleCancel}>
              <Square className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>

        {/* Result player */}
        {generatedAudioUrl && (
          <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Audio généré</span>
              <Button asChild variant="outline" size="sm">
                <a href={generatedAudioUrl} download target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </a>
              </Button>
            </div>
            <audio controls className="w-full">
              <source src={generatedAudioUrl} />
            </audio>
          </div>
        )}
      </Card>

      {/* History */}
      {(completedJobs.length > 0 || activeJobs.length > 0 || failedJobs.length > 0) && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Historique Qwen3</h3>
            <span className="text-sm text-muted-foreground">({history.length})</span>
          </div>

          <div className="space-y-3">
            {activeJobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="font-medium">
                      {job.status === "pending" ? "En attente..." : "En cours..."}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(job.created_at)}</span>
                </div>
                {job.metadata?.mode && (
                  <p className="text-xs text-muted-foreground">Mode: {modeLabel(job.metadata.mode)}</p>
                )}
              </div>
            ))}

            {completedJobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Volume2 className="h-4 w-4 text-green-500" />
                    <span className="font-medium">
                      {modeLabel(job.metadata?.mode || "custom_voice")}
                      {job.metadata?.speaker ? ` — ${job.metadata.speaker}` : ""}
                      {job.metadata?.totalDuration ? ` — ${formatDuration(job.metadata.totalDuration)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-2">{formatDate(job.created_at)}</span>
                    <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                      <a href={job.metadata.audioUrl} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteJob(job.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <audio controls className="w-full h-8">
                  <source src={job.metadata.audioUrl} />
                </audio>
                {job.metadata?.text && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{job.metadata.text.substring(0, 200)}...</p>
                )}
              </div>
            ))}

            {failedJobs.map((job) => (
              <div key={job.id} className="p-3 border border-destructive/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">{job.error_message || "Échec"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-2">{formatDate(job.created_at)}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteJob(job.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
