import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, Lightbulb, Clock, Trash2, AlertCircle, Sparkles, TrendingUp, RotateCcw, Globe } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Idea {
  title: string;
  reasoning: string;
  viralScore: number;
}

interface HistoryJob {
  id: string;
  status: string;
  created_at: string;
  metadata: any;
  error_message: string | null;
  progress: number | null;
  total: number | null;
}

const STEP_LABELS: Record<string, string> = {
  fetching_videos: "Fetching YouTube videos...",
  calling_ai: "Analyzing with Claude Sonnet...",
  saving_results: "Saving results...",
};

export function IdeaGenerator() {
  const [channelHandle, setChannelHandle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [step, setStep] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [channelTitle, setChannelTitle] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      .eq("job_type", "idea_generation" as any)
      .in("status", ["completed", "failed", "processing", "pending"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      const ideaJobs = (data as unknown as HistoryJob[]).filter(
        (j) => j.metadata?.pipeline === "idea_generation"
      );
      setHistory(ideaJobs);
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

      const meta = data.metadata as any;
      setProgress(data.progress || 0);
      setTotal(data.total || 0);
      setStep(meta?.step || null);

      if (data.status === "completed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setIdeas(meta?.ideas || []);
        setChannelTitle(meta?.channelTitle || null);
        setIsGenerating(false);
        toast.success(`${meta?.ideas?.length || 0} ideas generated!`);
        fetchHistory();
      } else if (data.status === "failed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        toast.error(`Error: ${data.error_message || "Idea generation failed"}`);
        setIsGenerating(false);
        fetchHistory();
      }
    }, 3000);
  }, []);

  const handleGenerate = async () => {
    if (!channelHandle.trim()) {
      toast.error("Enter a YouTube channel handle");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("You must be logged in");
      return;
    }

    setIsGenerating(true);
    setIdeas(null);
    setChannelTitle(null);
    setProgress(0);
    setTotal(0);
    setStep(null);

    try {
      const { data, error } = await supabase
        .from("generation_jobs")
        .insert({
          job_type: "idea_generation" as any,
          status: "pending" as any,
          user_id: session.user.id,
          project_id: null,
          progress: 0,
          total: 3,
          metadata: {
            pipeline: "idea_generation",
            channelHandle: channelHandle.trim(),
            ...(customInstructions.trim() && { customInstructions: customInstructions.trim() }),
            ...(useWebSearch && { useWebSearch: true }),
          },
        })
        .select()
        .single();

      if (error) throw error;

      setJobId(data.id);
      toast.success("Idea generation started!");
      pollJob(data.id);
      fetchHistory();
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
      setIsGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("generation_jobs").delete().eq("id", id);
    setHistory((prev) => prev.filter((j) => j.id !== id));
  };

  const loadFromHistory = (job: HistoryJob) => {
    setIdeas(job.metadata?.ideas || []);
    setChannelTitle(job.metadata?.channelTitle || null);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;
  const completedJobs = history.filter((j) => j.status === "completed" && j.metadata?.ideas);
  const activeJobs = history.filter((j) => j.status === "processing" || j.status === "pending");
  const failedJobs = history.filter((j) => j.status === "failed");

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          <h3 className="text-lg font-semibold">YouTube Idea Generator</h3>
        </div>

        <div className="space-y-2">
          <Label htmlFor="channel-handle">YouTube Channel Handle</Label>
          <div className="flex gap-2">
            <Input
              id="channel-handle"
              value={channelHandle}
              onChange={(e) => setChannelHandle(e.target.value)}
              placeholder="@MrBeast"
              disabled={isGenerating}
              onKeyDown={(e) => e.key === "Enter" && !isGenerating && handleGenerate()}
            />
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !channelHandle.trim()}
              className="shrink-0"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Scrapes the last 50 videos + stats, then asks Claude Sonnet for 10 viral ideas
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-instructions">Custom Instructions (optional)</Label>
          <Textarea
            id="custom-instructions"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="e.g. Focus on finance topics, make titles provocative, target French audience..."
            disabled={isGenerating}
            rows={3}
            className="resize-none text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="web-search"
            checked={useWebSearch}
            onCheckedChange={(checked) => setUseWebSearch(checked === true)}
            disabled={isGenerating}
          />
          <Label htmlFor="web-search" className="flex items-center gap-1.5 text-sm cursor-pointer">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            Web Search
          </Label>
          <span className="text-xs text-muted-foreground">— Claude recherche sur le web les tendances actuelles</span>
        </div>

        {isGenerating && (
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{step ? STEP_LABELS[step] || step : "Waiting for worker..."}</span>
              </div>
              <span className="text-muted-foreground">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}
      </Card>

      {ideas && ideas.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <h3 className="text-lg font-semibold">
              {channelTitle ? `Ideas inspired by ${channelTitle}` : "Generated Ideas"}
            </h3>
          </div>

          <div className="space-y-3">
            {ideas.map((idea, i) => (
              <div key={i} className="p-4 border rounded-lg space-y-2 hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-lg font-bold text-muted-foreground shrink-0 w-6 text-right">{i + 1}</span>
                    <h4 className="font-semibold text-sm leading-snug">{idea.title}</h4>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                    <TrendingUp className="h-3 w-3" />
                    {idea.viralScore}/10
                  </div>
                </div>
                <p className="text-xs text-muted-foreground ml-9">{idea.reasoning}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(completedJobs.length > 0 || activeJobs.length > 0 || failedJobs.length > 0) && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">History</h3>
            <span className="text-sm text-muted-foreground">({history.length})</span>
          </div>

          <div className="space-y-3">
            {activeJobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg bg-muted/20">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="font-medium">
                      {job.metadata?.channelHandle || "Processing..."}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(job.created_at)}</span>
                </div>
              </div>
            ))}

            {completedJobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <button
                    className="flex items-center gap-2 text-sm hover:underline text-left"
                    onClick={() => loadFromHistory(job)}
                  >
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium">
                      {job.metadata?.channelTitle || job.metadata?.channelHandle}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      — {job.metadata?.ideas?.length || 0} ideas
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-2">{formatDate(job.created_at)}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadFromHistory(job)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(job.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
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
