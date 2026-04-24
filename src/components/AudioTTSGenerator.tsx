import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Play, Download, Volume2, Square, Clock, Trash2, AlertCircle, FolderOpen, Save, ChevronDown, Pencil, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const VOICES = [
  { id: "Puck", label: "Puck (masculin)" },
  { id: "Charon", label: "Charon (masculin grave)" },
  { id: "Kore", label: "Kore (féminin)" },
  { id: "Fenrir", label: "Fenrir (masculin profond)" },
  { id: "Aoede", label: "Aoede (féminin doux)" },
  { id: "Leda", label: "Leda (féminin naturel)" },
  { id: "Orus", label: "Orus (masculin)" },
  { id: "Zephyr", label: "Zephyr (neutre)" },
];

const TTS_MODELS = [
  { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS (stable)" },
  { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS (rapide)" },
  { id: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS (preview)" },
];
const DEFAULT_TTS_MODEL = "gemini-2.5-pro-preview-tts";

interface HistoryJob {
  id: string;
  status: string;
  created_at: string;
  metadata: any;
  error_message: string | null;
  progress: number | null;
  total: number | null;
}

interface TtsPreset {
  id: string;
  name: string;
  provider: string;
  voice_id: string;
  model: string | null;
  speed: number;
  pitch: number;
  volume: number;
  language_boost: string;
  english_normalization: boolean;
  emotion: string;
}

interface AudioTTSGeneratorProps {
  initialText?: string;
}

export function AudioTTSGenerator({ initialText }: AudioTTSGeneratorProps) {
  const [text, setText] = useState(initialText || "");
  const [voice, setVoice] = useState("Puck");
  const [ttsModel, setTtsModel] = useState<string>(DEFAULT_TTS_MODEL);
  const [styleInstruction, setStyleInstruction] = useState("energetic YouTube narrator. Natural and conversational, confident and slightly playful. Medium-fast pace. Strong emphasis on key words. Vary pitch and intonation to avoid monotone. Short pauses after punchlines and before important numbers. Sound curious, occasionally skeptical. Smile in the voice. Avoid robotic cadence.");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // RVC settings
  const [rvcEnabled, setRvcEnabled] = useState(false);
  const [rvcModelUrl, setRvcModelUrl] = useState("");
  const [rvcIndexUrl, setRvcIndexUrl] = useState("");
  const [rvcPitch, setRvcPitch] = useState(0);
  const [rvcIndexRate, setRvcIndexRate] = useState(0.75);

  // Preset management
  const [presets, setPresets] = useState<TtsPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [presetPopoverOpen, setPresetPopoverOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [editPresetName, setEditPresetName] = useState("");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);

  useEffect(() => {
    if (initialText && !text) setText(initialText);
  }, [initialText]);

  useEffect(() => {
    fetchHistory();
    loadPresets();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const loadPresets = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("tts_presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      if (error) throw error;
      setPresets((data || []) as TtsPreset[]);
    } catch (err) {
      console.error("Error loading presets:", err);
    }
  };

  const applyPreset = (preset: TtsPreset) => {
    // For Gemini TTS presets, load voice from voice_id
    if (preset.provider === "gemini_tts") {
      if (preset.voice_id) setVoice(preset.voice_id);
      if (preset.model && TTS_MODELS.some(m => m.id === preset.model)) {
        setTtsModel(preset.model);
      }
    }

    // Load RVC + style from emotion JSON
    try {
      const emotionData = preset.emotion ? JSON.parse(preset.emotion) : {};
      if (typeof emotionData.styleInstruction === "string") setStyleInstruction(emotionData.styleInstruction);
      setRvcEnabled(!!emotionData.rvcEnabled);
      if (emotionData.rvcModelUrl) setRvcModelUrl(emotionData.rvcModelUrl);
      if (emotionData.rvcIndexUrl !== undefined) setRvcIndexUrl(emotionData.rvcIndexUrl);
      if (typeof emotionData.rvcPitch === "number") setRvcPitch(emotionData.rvcPitch);
      if (typeof emotionData.rvcIndexRate === "number") setRvcIndexRate(emotionData.rvcIndexRate);
    } catch { /* ignore */ }

    setSelectedPresetId(preset.id);
    toast.success(`Preset "${preset.name}" chargé`);
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setIsSavingPreset(true);
    try {
      const emotionData = {
        styleInstruction,
        rvcEnabled,
        rvcModelUrl,
        rvcIndexUrl,
        rvcPitch,
        rvcIndexRate,
      };

      const { error } = await supabase
        .from("tts_presets")
        .insert([{
          user_id: session.user.id,
          name: newPresetName.trim(),
          provider: "gemini_tts",
          voice_id: voice,
          model: ttsModel,
          emotion: JSON.stringify(emotionData),
        }]);

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setSaveDialogOpen(false);
      setNewPresetName("");
      loadPresets();
    } catch (error: any) {
      console.error("Error saving preset:", error);
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleUpdatePreset = async () => {
    if (!editingPresetId || !editPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    setIsSavingPreset(true);
    try {
      const emotionData = {
        styleInstruction,
        rvcEnabled,
        rvcModelUrl,
        rvcIndexUrl,
        rvcPitch,
        rvcIndexRate,
      };

      const { error } = await supabase
        .from("tts_presets")
        .update({
          name: editPresetName.trim(),
          provider: "gemini_tts",
          voice_id: voice,
          model: ttsModel,
          emotion: JSON.stringify(emotionData),
        })
        .eq("id", editingPresetId);

      if (error) throw error;

      toast.success("Preset mis à jour !");
      setEditDialogOpen(false);
      setEditingPresetId(null);
      loadPresets();
    } catch (error: any) {
      console.error("Error updating preset:", error);
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return;

    try {
      const { error } = await supabase
        .from("tts_presets")
        .delete()
        .eq("id", presetId);

      if (error) throw error;

      toast.success("Preset supprimé");
      if (selectedPresetId === presetId) setSelectedPresetId("");
      loadPresets();
    } catch (error: any) {
      console.error("Error deleting preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleOpenEdit = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setEditingPresetId(presetId);
    setEditPresetName(preset.name);
    applyPreset(preset);
    setEditDialogOpen(true);
  };

  const handleDuplicate = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const { error } = await supabase
        .from("tts_presets")
        .insert([{
          user_id: session.user.id,
          name: `${preset.name} (copie)`,
          provider: preset.provider,
          voice_id: preset.voice_id,
          model: preset.model,
          speed: preset.speed,
          pitch: preset.pitch,
          volume: preset.volume,
          language_boost: preset.language_boost,
          english_normalization: preset.english_normalization,
          emotion: preset.emotion,
        }]);

      if (error) throw error;
      toast.success("Preset dupliqué !");
      loadPresets();
    } catch (error: any) {
      console.error("Error duplicating preset:", error);
      toast.error("Erreur lors de la duplication");
    }
  };

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
      const geminiJobs = (data as unknown as HistoryJob[]).filter(
        (j) => j.metadata?.provider === "gemini_tts"
      );
      setHistory(geminiJobs);
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

      setProgress(data.progress || 0);
      setTotal(data.total || 0);
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

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Please enter text to convert to audio");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("You must be logged in");
      return;
    }

    setIsGenerating(true);
    setGeneratedAudioUrl(null);
    setProgress(0);
    setTotal(0);
    setJobStatus("pending");

    try {
      const { data, error } = await supabase
        .from("generation_jobs")
        .insert({
          job_type: "audio_generation" as any,
          status: "pending" as any,
          user_id: session.user.id,
          project_id: null,
          progress: 0,
          total: 1,
          metadata: {
            text: text.trim(),
            voice,
            model: ttsModel,
            styleInstruction,
            provider: "gemini_tts",
            standalone: true,
            ...(rvcEnabled && rvcModelUrl ? {
              rvcEnabled: true,
              rvcModelUrl,
              rvcIndexUrl,
              rvcPitch,
              rvcIndexRate,
            } : {}),
          },
        })
        .select()
        .single();

      if (error) throw error;

      setJobId(data.id);
      toast.success("TTS generation started. The VPS worker will process it.");
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
    toast.info("Generation cancelled");
    fetchHistory();
  };

  const handleDeleteJob = async (id: string) => {
    await supabase.from("generation_jobs").delete().eq("id", id);
    setHistory((prev) => prev.filter((j) => j.id !== id));
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const providerLabel = (provider: string) => {
    switch (provider) {
      case "gemini_tts": return "Gemini TTS";
      case "minimax": return "MiniMax";
      case "inworld": return "Inworld";
      case "genaipro": return "ElevenLabs";
      case "ai33": return "AI33";
      case "edgetts": return "EdgeTTS";
      case "qwen3_tts": return "Qwen3 TTS";
      default: return provider;
    }
  };

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimatedChunks = Math.max(1, Math.ceil(wordCount / 250));
  const estimatedMinutes = Math.ceil((estimatedChunks * 6.5) / 60);
  const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;

  const completedJobs = history.filter((j) => j.status === "completed" && j.metadata?.audioUrl);
  const activeJobs = history.filter((j) => j.status === "processing" || j.status === "pending");
  const failedJobs = history.filter((j) => j.status === "failed");

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Gemini TTS Audio Generator</h3>
        </div>

        {/* Preset selector */}
        <div className="space-y-2">
          <Label>Preset</Label>
          <div className="flex gap-2">
            <Popover open={presetPopoverOpen} onOpenChange={setPresetPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-between">
                  <span className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    {selectedPresetId
                      ? presets.find(p => p.id === selectedPresetId)?.name || "Sélectionner..."
                      : "Sélectionner un preset..."}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 bg-popover z-50" align="start">
                <div className="p-2 border-b">
                  <p className="text-sm font-medium">Presets TTS sauvegardés</p>
                </div>
                {presets.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Aucun preset sauvegardé
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer"
                      >
                        <div
                          className="flex-1 pr-2"
                          onClick={() => {
                            applyPreset(preset);
                            setPresetPopoverOpen(false);
                          }}
                        >
                          <p className="font-medium text-sm">{preset.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {providerLabel(preset.provider)} - {preset.voice_id}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(preset.id);
                              setPresetPopoverOpen(false);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicate(preset.id);
                              setPresetPopoverOpen(false);
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePreset(preset.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(true)}
            >
              <Save className="h-4 w-4 mr-2" />
              Sauvegarder
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tts-text">Text to convert</Label>
          <Textarea
            id="tts-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste or type your script here..."
            className="min-h-[200px] text-sm"
            disabled={isGenerating}
          />
          <p className="text-xs text-muted-foreground">
            {wordCount} words &middot; ~{estimatedChunks} chunk{estimatedChunks > 1 ? "s" : ""} &middot; ~{estimatedMinutes} min estimated
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Voice</Label>
            <Select value={voice} onValueChange={setVoice} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Modèle</Label>
            <Select value={ttsModel} onValueChange={setTtsModel} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Style instruction</Label>
          <Input
            value={styleInstruction}
            onChange={(e) => setStyleInstruction(e.target.value)}
            placeholder="Read naturally..."
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
                <Label>URL du modèle RVC (.pth) — HuggingFace</Label>
                <Input
                  value={rvcModelUrl}
                  onChange={(e) => setRvcModelUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../model.pth"
                  disabled={isGenerating}
                />
                <p className="text-xs text-muted-foreground">
                  Fichier <code>.pth</code> de votre voix entraînée sur HuggingFace. Ex : <code>https://huggingface.co/user/repo/resolve/main/model.pth</code>
                </p>
              </div>

              <div className="space-y-2">
                <Label>URL de l'index RVC (.index) — optionnel</Label>
                <Input
                  value={rvcIndexUrl}
                  onChange={(e) => setRvcIndexUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../model.index"
                  disabled={isGenerating}
                />
                <p className="text-xs text-muted-foreground">
                  Fichier <code>.index</code> FAISS associé au modèle. Améliore la qualité de conversion.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Décalage de pitch (demi-tons)</Label>
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
                  type="range"
                  min="-24"
                  max="24"
                  step="1"
                  value={rvcPitch}
                  onChange={(e) => setRvcPitch(parseInt(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-24 (grave)</span>
                  <span>0</span>
                  <span>+24 (aigu)</span>
                </div>
                <p className="text-xs text-amber-600">
                  Pour une conversion voix femme → homme : -12. Homme → femme : +12.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Index Rate</Label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
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
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={rvcIndexRate}
                  onChange={(e) => setRvcIndexRate(parseFloat(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0 (désactivé)</span>
                  <span>0.75 (recommandé)</span>
                  <span>1.0</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {isGenerating && (
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {jobStatus === "pending"
                    ? "Waiting for worker..."
                    : `Chunk ${progress}/${total} processing...`}
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

        {generatedAudioUrl && (
          <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Generated audio</span>
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

      {(completedJobs.length > 0 || activeJobs.length > 0 || failedJobs.length > 0) && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">History</h3>
            <span className="text-sm text-muted-foreground">({history.length})</span>
          </div>

          <div className="space-y-3">
            {activeJobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg bg-muted/20 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="font-medium">
                      {job.status === "pending" ? "Waiting..." : `Processing ${job.progress || 0}/${job.total || "?"}`}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(job.created_at)}</span>
                </div>
                {job.metadata?.voice && (
                  <p className="text-xs text-muted-foreground">Voice: {job.metadata.voice}</p>
                )}
              </div>
            ))}

            {completedJobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Volume2 className="h-4 w-4 text-green-500" />
                    <span className="font-medium">
                      {job.metadata?.voice || "Puck"}
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
                    <span className="text-destructive">{job.error_message || "Failed"}</span>
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

      {/* Save Preset Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sauvegarder le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPresetName">Nom du preset</Label>
              <Input
                id="newPresetName"
                placeholder="Ma configuration TTS..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
            </div>
            <div className="p-4 bg-muted rounded-lg text-sm">
              <p className="font-medium mb-2">Configuration actuelle :</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>Fournisseur : Gemini TTS{rvcEnabled ? " + RVC" : ""}</li>
                <li>Voix : {voice}</li>
                <li>Style : {styleInstruction.substring(0, 60)}...</li>
                {rvcEnabled && <li>RVC : pitch {rvcPitch}, index rate {rvcIndexRate}</li>}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSavePreset} disabled={isSavingPreset || !newPresetName.trim()}>
              {isSavingPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Sauvegarder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Preset Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editPresetName">Nom du preset</Label>
              <Input
                id="editPresetName"
                placeholder="Ma configuration TTS..."
                value={editPresetName}
                onChange={(e) => setEditPresetName(e.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Les paramètres actuels (voix, style, RVC) seront sauvegardés dans ce preset.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleUpdatePreset} disabled={isSavingPreset || !editPresetName.trim()}>
              {isSavingPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Mettre à jour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
