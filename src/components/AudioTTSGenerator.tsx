import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Play, Download, Volume2, Square, Clock, Trash2, AlertCircle } from "lucide-react";
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

interface HistoryJob {
  id: string;
  status: string;
  created_at: string;
  metadata: any;
  error_message: string | null;
  progress: number | null;
  total: number | null;
}

interface AudioTTSGeneratorProps {
  initialText?: string;
}

export function AudioTTSGenerator({ initialText }: AudioTTSGeneratorProps) {
  const [text, setText] = useState(initialText || "");
  const [voice, setVoice] = useState("Puck");
  const [styleInstruction, setStyleInstruction] = useState("Read naturally for a YouTube documentary video: ");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
            styleInstruction,
            provider: "gemini_tts",
            standalone: true,
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

  const handleDelete = async (id: string) => {
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
            <Label>Style instruction</Label>
            <Input
              value={styleInstruction}
              onChange={(e) => setStyleInstruction(e.target.value)}
              placeholder="Read naturally..."
              disabled={isGenerating}
            />
          </div>
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
                Generate Audio
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(job.id)}>
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(job.id)}>
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
