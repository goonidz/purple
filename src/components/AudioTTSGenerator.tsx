import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Play, Download, Volume2, Square } from "lucide-react";
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialText && !text) setText(initialText);
  }, [initialText]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
      } else if (data.status === "failed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        toast.error(`Error: ${data.error_message || "Audio generation failed"}`);
        setIsGenerating(false);
      } else if (data.status === "cancelled") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setIsGenerating(false);
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
  };

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const estimatedChunks = Math.max(1, Math.ceil(wordCount / 250));
  const estimatedMinutes = Math.ceil((estimatedChunks * 6.5) / 60);
  const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
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
  );
}
