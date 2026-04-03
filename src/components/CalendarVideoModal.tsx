import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { CalendarIcon, Upload, Trash2, Loader2, Play, Pause, Rocket, ExternalLink, FolderOpen, Link2, Mic, PenTool, Plus, Copy, Check, Settings, Zap } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import ChannelManager from "@/components/ChannelManager";

interface Channel {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  script_preset_id: string | null;
  tts_preset_id: string | null;
  project_preset_id: string | null;
  thumbnail_preset_id: string | null;
  thumbnail_preset_enabled: boolean | null;
}

interface ContentCalendarEntry {
  id: string;
  user_id: string;
  title: string;
  scheduled_date: string;
  status: string;
  script: string | null;
  audio_url: string | null;
  notes: string | null;
  project_id: string | null;
  youtube_url: string | null;
  channel_id: string | null;
  source_url: string | null;
  source_thumbnail_url: string | null;
  source_transcript: string | null;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: string;
  name: string;
  summary: string | null;
  created_at: string;
}

interface CalendarVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: ContentCalendarEntry | null;
  selectedDate: Date | null;
  userId: string;
  onSaved: () => void;
  initialSourceUrl?: string;
  initialSourceThumbnailUrl?: string;
  initialTitle?: string;
}

const statusOptions = [
  { value: "planned", label: "Planifié", color: "bg-muted" },
  { value: "scripted", label: "Script prêt", color: "bg-blue-500/20" },
  { value: "audio_ready", label: "Audio prêt", color: "bg-yellow-500/20" },
  { value: "generating", label: "En génération", color: "bg-purple-500/20" },
  { value: "auto_script", label: "Auto: Script...", color: "bg-primary/20" },
  { value: "auto_audio", label: "Auto: Audio...", color: "bg-primary/20" },
  { value: "auto_transcribe", label: "Auto: Transcription...", color: "bg-primary/20" },
  { value: "auto_scenes", label: "Auto: Scènes...", color: "bg-primary/20" },
  { value: "auto_prompts", label: "Auto: Prompts...", color: "bg-primary/20" },
  { value: "auto_images", label: "Auto: Images...", color: "bg-primary/20" },
  { value: "thumbnail", label: "Miniature", color: "bg-pink-500/20" },
  { value: "completed", label: "Terminé", color: "bg-green-500/20" },
];

export default function CalendarVideoModal({
  isOpen,
  onClose,
  entry,
  selectedDate,
  userId,
  onSaved,
  initialSourceUrl,
  initialSourceThumbnailUrl,
  initialTitle,
}: CalendarVideoModalProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [status, setStatus] = useState<string>("planned");
  const [script, setScript] = useState("");
  const [notes, setNotes] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceThumbnailUrl, setSourceThumbnailUrl] = useState<string | null>(null);
  const [sourceTranscript, setSourceTranscript] = useState<string | null>(null);
  const [isScrapingSource, setIsScrapingSource] = useState(false);
  const [isScrapingTranscript, setIsScrapingTranscript] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [showChannelManager, setShowChannelManager] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showLaunchDialog, setShowLaunchDialog] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<{ id: string; current_step: string; step_status: string; error: string | null; project_id: string | null } | null>(null);
  const [isRetryingPipeline, setIsRetryingPipeline] = useState(false);
  const [tempCreatedEntryId, setTempCreatedEntryId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Subscribe to realtime updates for transcript
  useEffect(() => {
    if (!entry?.id) return;

    const channel = supabase
      .channel(`calendar-transcript-${entry.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'content_calendar',
          filter: `id=eq.${entry.id}`
        },
        (payload) => {
          if (payload.new && (payload.new as any).source_transcript) {
            setSourceTranscript((payload.new as any).source_transcript);
            setIsScrapingTranscript(false);
            toast.success("Transcription mise à jour");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [entry?.id]);

  // Load user's projects
  useEffect(() => {
    const loadProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, summary, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        
        if (error) throw error;
        setProjects(data || []);
      } catch (error) {
        console.error("Error loading projects:", error);
      } finally {
        setIsLoadingProjects(false);
      }
    };
    
    if (isOpen && userId) {
      loadProjects();
    }
  }, [isOpen, userId]);

  // Load user's channels
  useEffect(() => {
    const loadChannels = async () => {
      setIsLoadingChannels(true);
      try {
        const { data, error } = await supabase
          .from("channels")
          .select("*")
          .eq("user_id", userId)
          .order("name", { ascending: true });
        
        if (error) throw error;
        setChannels(data || []);
      } catch (error) {
        console.error("Error loading channels:", error);
      } finally {
        setIsLoadingChannels(false);
      }
    };
    
    if (isOpen && userId) {
      loadChannels();
    }
  }, [isOpen, userId]);

  // Set immediate data from the lightweight entry prop, then fetch full data
  useEffect(() => {
    if (entry) {
      setTitle(entry.title);
      setScheduledDate(new Date(entry.scheduled_date));
      setStatus(entry.status);
      setScript(entry.script || "");
      setNotes(entry.notes || "");
      setAudioUrl(entry.audio_url);
      setYoutubeUrl(entry.youtube_url || "");
      setSourceUrl(entry.source_url || "");
      setSourceThumbnailUrl(entry.source_thumbnail_url || null);
      setSourceTranscript(entry.source_transcript || null);
      setProjectId(entry.project_id);
      setChannelId(entry.channel_id);
    } else if (selectedDate) {
      setTitle(initialTitle || "");
      setScheduledDate(selectedDate);
      setStatus("planned");
      setScript("");
      setNotes("");
      setAudioUrl(null);
      setYoutubeUrl("");
      setSourceUrl(initialSourceUrl || "");
      setSourceThumbnailUrl(initialSourceThumbnailUrl || null);
      setSourceTranscript(null);
      setProjectId(null);
      setChannelId(null);
    }
  }, [entry, selectedDate, initialSourceUrl, initialSourceThumbnailUrl, initialTitle]);

  // Fetch full entry data when modal opens (calendar only passes lightweight data)
  useEffect(() => {
    if (!isOpen || !entry?.id) return;

    const loadFullEntry = async () => {
      const { data, error } = await supabase
        .from("content_calendar")
        .select("script, notes, audio_url, source_url, source_thumbnail_url, source_transcript")
        .eq("id", entry.id)
        .single();

      if (error) {
        console.error("Error loading full entry:", error);
        return;
      }
      if (!data) return;

      setScript(data.script || "");
      setNotes(data.notes || "");
      setAudioUrl(data.audio_url);
      setSourceUrl(data.source_url || "");
      setSourceThumbnailUrl(data.source_thumbnail_url || null);
      setSourceTranscript(data.source_transcript || null);
    };

    loadFullEntry();
  }, [isOpen, entry?.id]);

  // Poll auto_pipelines status for this calendar entry
  useEffect(() => {
    if (!isOpen || !entry?.id) {
      setPipelineStatus(null);
      return;
    }

    let cancelled = false;
    const fetchPipelineStatus = async () => {
      // Prefer the most recent non-cancelled pipeline; fall back to latest overall
      let { data } = await supabase
        .from("auto_pipelines" as any)
        .select("id, current_step, step_status, error, project_id")
        .eq("calendar_entry_id", entry.id)
        .neq("current_step", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) {
        const fallback = await supabase
          .from("auto_pipelines" as any)
          .select("id, current_step, step_status, error, project_id")
          .eq("calendar_entry_id", entry.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        data = fallback.data;
      }

      if (!cancelled && data) {
        setPipelineStatus(data as any);
        if (data.project_id && !projectId) {
          setProjectId(data.project_id as string);
        }
      } else if (!cancelled) {
        setPipelineStatus(null);
      }
    };

    fetchPipelineStatus();
    const interval = setInterval(fetchPipelineStatus, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isOpen, entry?.id]);

  const handleProjectSelect = (selectedProjectId: string) => {
    if (selectedProjectId === "none") {
      setProjectId(null);
      return;
    }
    
    const project = projects.find(p => p.id === selectedProjectId);
    if (project) {
      setProjectId(project.id);
      setTitle(project.name);
      if (project.summary) {
        setScript(project.summary);
      }
    }
  };

  const goToProject = () => {
    if (projectId) {
      window.open(`/project?project=${projectId}`, '_blank');
    }
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.includes("audio")) {
      toast.error("Veuillez sélectionner un fichier audio");
      return;
    }

    setIsUploading(true);
    try {
      const fileName = `${userId}/${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage
        .from("audio-files")
        .upload(fileName, file);

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from("audio-files")
        .getPublicUrl(fileName);

      setAudioUrl(urlData.publicUrl);
      toast.success("Audio uploadé avec succès");
    } catch (error) {
      console.error("Error uploading audio:", error);
      toast.error("Erreur lors de l'upload de l'audio");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Le titre est requis");
      return;
    }
    if (!scheduledDate) {
      toast.error("La date est requise");
      return;
    }

    setIsLoading(true);
    try {
      const dataWithThumbnail = {
        user_id: userId,
        title: title.trim(),
        scheduled_date: format(scheduledDate, "yyyy-MM-dd"),
        status,
        script: script.trim() || null,
        notes: notes.trim() || null,
        audio_url: audioUrl,
        youtube_url: youtubeUrl.trim() || null,
        source_url: sourceUrl.trim() || null,
        source_thumbnail_url: sourceThumbnailUrl || null,
        source_transcript: sourceTranscript || null,
        project_id: projectId,
        channel_id: channelId,
      };

      // Try saving with thumbnail first
      let error: any = null;
      const existingEntryId = entry?.id || tempCreatedEntryId;
      
      if (existingEntryId) {
        // Update existing entry (either from prop or temp created)
        const result = await supabase
          .from("content_calendar")
          .update(dataWithThumbnail)
          .eq("id", existingEntryId);
        error = result.error;
      } else {
        const result = await supabase
          .from("content_calendar")
          .insert(dataWithThumbnail);
        error = result.error;
      }

      // If error is about source_thumbnail_url, retry without it
      if (error && (error.message?.includes("source_thumbnail_url") || error.message?.includes("schema cache"))) {
        console.warn("source_thumbnail_url column not available, saving without it");
        const dataWithoutThumbnail = { ...dataWithThumbnail };
        delete (dataWithoutThumbnail as any).source_thumbnail_url;
        
        if (existingEntryId) {
          const retryResult = await supabase
            .from("content_calendar")
            .update(dataWithoutThumbnail)
            .eq("id", existingEntryId);
          if (retryResult.error) throw retryResult.error;
        } else {
          const retryResult = await supabase
            .from("content_calendar")
            .insert(dataWithoutThumbnail);
          if (retryResult.error) throw retryResult.error;
        }
        
        toast.success(existingEntryId ? "Vidéo mise à jour (miniature non sauvegardée - cache en cours de mise à jour)" : "Vidéo planifiée (miniature non sauvegardée - cache en cours de mise à jour)", {
          duration: 4000
        });
      } else if (error) {
        throw error;
      } else {
        toast.success(existingEntryId ? "Vidéo mise à jour" : "Vidéo planifiée");
      }
      
      // Clear temp entry tracking since we've saved successfully
      setTempCreatedEntryId(null);

      // If this entry is linked to a project, also update the project name
      if (projectId && title.trim()) {
        const { error: projectUpdateError } = await supabase
          .from("projects")
          .update({ name: title.trim() })
          .eq("id", projectId);
        
        if (projectUpdateError) {
          console.warn("Could not update project name:", projectUpdateError);
          // Don't throw - calendar update succeeded, project update is optional
        } else {
          console.log("Project name synchronized with calendar entry");
        }
      }

      onSaved();
    } catch (error: any) {
      console.error("Error saving entry:", error);
      const errorMessage = error?.message || "Erreur lors de la sauvegarde";
      toast.error(`Erreur lors de la sauvegarde: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!entry) return;
    
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-calendar-entry", {
        body: { entryId: entry.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Vidéo supprimée");
      onSaved();
    } catch (error) {
      console.error("Error deleting entry:", error);
      toast.error("Erreur lors de la suppression");
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle close - delete temp entry if user didn't save
  const handleClose = async () => {
    if (tempCreatedEntryId) {
      // User is closing without saving - delete the temp entry
      try {
        await supabase
          .from("content_calendar")
          .delete()
          .eq("id", tempCreatedEntryId);
        console.log("Deleted temp calendar entry:", tempCreatedEntryId);
      } catch (error) {
        console.error("Error deleting temp entry:", error);
      }
      setTempCreatedEntryId(null);
    }
    onClose();
  };

  const toggleAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const scrapeYouTubeUrl = async (url: string): Promise<{ title?: string; thumbnailUrl?: string } | null> => {
    // Check if it's a YouTube URL
    const youtubePattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/|^)([a-zA-Z0-9_-]{11})/;
    if (!youtubePattern.test(url)) {
      return null;
    }

    setIsScrapingSource(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-youtube", {
        body: { url }
      });

      if (error) throw error;

      if (data.success) {
        // Auto-fill title if empty
        if (!title.trim()) {
          setTitle(data.title);
        }
        // Store thumbnail URL
        if (data.thumbnailUrl) {
          setSourceThumbnailUrl(data.thumbnailUrl);
        }
        toast.success(`Informations récupérées : ${data.title}`);
        
        // Return scraped data for immediate use
        return {
          title: data.title,
          thumbnailUrl: data.thumbnailUrl
        };
      }
      return null;
    } catch (error: any) {
      console.error("Error scraping YouTube:", error);
      toast.error(error.message || "Erreur lors de la récupération des informations");
      return null;
    } finally {
      setIsScrapingSource(false);
    }
  };


  const scrapeTranscript = async (url: string, calendarEntryId: string) => {
    setIsScrapingTranscript(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-youtube-transcript", {
        body: { url, calendarEntryId }
      });

      if (error) throw error;

      if (data.success) {
        setSourceTranscript(data.transcript);
        toast.success("Transcription récupérée avec succès");
      }
    } catch (error: any) {
      console.error("Error scraping transcript:", error);
      toast.error(error.message || "Erreur lors de la récupération de la transcription");
    } finally {
      setIsScrapingTranscript(false);
    }
  };

  const copyTranscriptToClipboard = async () => {
    if (!sourceTranscript) return;
    
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(sourceTranscript);
        setTranscriptCopied(true);
        toast.success("Transcription copiée !");
        setTimeout(() => setTranscriptCopied(false), 2000);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = sourceTranscript;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setTranscriptCopied(true);
          toast.success("Transcription copiée !");
          setTimeout(() => setTranscriptCopied(false), 2000);
        }
      }
    } catch (error) {
      console.error("Error copying transcript:", error);
      toast.error("Erreur lors de la copie");
    }
  };

  // Clean YouTube URL by extracting video ID and rebuilding a clean URL
  const cleanYouTubeUrl = (url: string): string => {
    if (!url.trim()) return url;
    
    // Extract video ID from various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})(?:&.*)?/,  // Standard watch URL with params
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:\?.*)?/,    // Embed URL
      /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})(?:\?.*)?/,        // Old format
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\?.*)?/,              // Shortened URL
      /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})(?:\?.*)?/    // Shorts URL
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        // Return clean URL with just the video ID
        return `https://www.youtube.com/watch?v=${match[1]}`;
      }
    }
    
    // If no pattern matches, return original URL
    return url;
  };

  const handleSourceUrlChange = async (url: string) => {
    // Clean the URL first to remove unnecessary parameters
    const cleanedUrl = cleanYouTubeUrl(url);
    setSourceUrl(cleanedUrl);
    
    // Clear thumbnail and transcript if URL is empty
    if (!cleanedUrl.trim()) {
      setSourceThumbnailUrl(null);
      setSourceTranscript(null);
      return;
    }
    
    // Verify URL is a valid YouTube URL before proceeding
    const youtubePattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/|^)([a-zA-Z0-9_-]{11})/;
    if (!youtubePattern.test(cleanedUrl)) {
      // Not a valid YouTube URL, don't scrape
      return;
    }
    
    // Scrape title and thumbnail first (use cleaned URL)
    const scrapeResult = await scrapeYouTubeUrl(cleanedUrl);
    
    // Immediately launch transcript scraping after title/thumbnail are scraped
    // Launch in background without awaiting - it will continue even if user leaves
    // If entry exists, use it; otherwise create it automatically
    if (entry?.id) {
      // Entry exists, launch transcript scraping immediately (fire and forget)
      scrapeTranscript(cleanedUrl, entry.id).catch(err => {
        console.error("Transcript scraping error (background):", err);
        // Don't show error to user if they've left the page
      });
    } else {
      // Entry doesn't exist yet, create it automatically with available data
      // Use scraped title if available, or current title, or placeholder
      createEntryAndScrapeTranscript(cleanedUrl, scrapeResult?.title).catch(err => {
        console.error("Error creating entry and scraping transcript (background):", err);
        // Don't show error to user if they've left the page
      });
    }
  };

  const createEntryAndScrapeTranscript = async (url: string, scrapedTitle?: string): Promise<void> => {
    try {
      // Use scraped title if available, then current title, otherwise use a placeholder
      const entryTitle = scrapedTitle || title.trim() || "Nouvelle vidéo";
      const entryDate = scheduledDate || new Date();
      
      const dataToSave = {
        user_id: userId,
        title: entryTitle,
        scheduled_date: format(entryDate, "yyyy-MM-dd"),
        status: status || "planned",
        script: script.trim() || null,
        notes: notes.trim() || null,
        audio_url: audioUrl,
        youtube_url: youtubeUrl.trim() || null,
        source_url: sourceUrl.trim() || null,
        source_thumbnail_url: sourceThumbnailUrl || null,
        project_id: projectId,
        channel_id: channelId,
      };

      const { data, error } = await supabase
        .from("content_calendar")
        .insert(dataToSave)
        .select()
        .single();

      if (error) {
        console.error("Error creating entry for transcript:", error);
        return;
      }
      
      if (data?.id) {
        // Track this as a temporary entry - will be deleted if user cancels
        setTempCreatedEntryId(data.id);
        
        // Launch transcript scraping in background (fire and forget)
        // It will continue even if user leaves the page
        scrapeTranscript(url, data.id).catch(err => {
          console.error("Transcript scraping error (background):", err);
          // Don't show error to user if they've left the page
        });
      }
    } catch (error) {
      console.error("Error creating entry for transcript:", error);
    }
  };

  const handleYoutubeUrlChange = (url: string) => {
    setYoutubeUrl(url);
    
    // When YouTube URL is filled, set status to "completed" (terminé)
    if (url.trim()) {
      setStatus('completed');
    }
    // No API call - just update the status
  };

  const handleLaunchProject = () => {
    setShowLaunchDialog(true);
  };

  const handleLaunchFromScratch = () => {
    // Store calendar entry info to link after project creation
    sessionStorage.setItem("calendar_title", title);
    sessionStorage.setItem("calendar_entry_id", entry?.id || "");
    if (script) {
      sessionStorage.setItem("calendar_script", script);
    }
    // Store channel info if selected
    if (channelId) {
      const selectedChannel = channels.find(c => c.id === channelId);
      if (selectedChannel) {
        sessionStorage.setItem("calendar_channel_name", selectedChannel.name);
        sessionStorage.setItem("calendar_channel_color", selectedChannel.color);
        
        // Store channel preset IDs for auto-loading
        if (selectedChannel.script_preset_id) {
          sessionStorage.setItem("calendar_script_preset_id", selectedChannel.script_preset_id);
        }
        if (selectedChannel.tts_preset_id) {
          sessionStorage.setItem("calendar_tts_preset_id", selectedChannel.tts_preset_id);
        }
        if (selectedChannel.project_preset_id) {
          sessionStorage.setItem("calendar_project_preset_id", selectedChannel.project_preset_id);
        }
        // Always store thumbnail preset ID (for UI loading), regardless of enabled state
        if (selectedChannel.thumbnail_preset_id) {
          sessionStorage.setItem("calendar_thumbnail_preset_id", selectedChannel.thumbnail_preset_id);
        }
        // Store enabled state separately (for auto-chaining behavior)
        if (selectedChannel.thumbnail_preset_enabled) {
          sessionStorage.setItem("calendar_thumbnail_chain_enabled", "true");
        } else {
          sessionStorage.removeItem("calendar_thumbnail_chain_enabled");
        }
      }
    } else {
      sessionStorage.removeItem("calendar_channel_name");
      sessionStorage.removeItem("calendar_channel_color");
      sessionStorage.removeItem("calendar_script_preset_id");
      sessionStorage.removeItem("calendar_tts_preset_id");
      sessionStorage.removeItem("calendar_project_preset_id");
      sessionStorage.removeItem("calendar_thumbnail_preset_id");
    }
    onClose();
    window.location.href = "/create-from-scratch?from_calendar=true";
  };

  const handleLaunchWithAudio = () => {
    if (audioUrl) {
      // Store data in sessionStorage to pass to projects page
      sessionStorage.setItem("calendar_script", script || "");
      sessionStorage.setItem("calendar_audio_url", audioUrl);
      sessionStorage.setItem("calendar_title", title);
      sessionStorage.setItem("calendar_entry_id", entry?.id || "");
      // Store channel info if selected
      if (channelId) {
        const selectedChannel = channels.find(c => c.id === channelId);
        if (selectedChannel) {
          sessionStorage.setItem("calendar_channel_name", selectedChannel.name);
          sessionStorage.setItem("calendar_channel_color", selectedChannel.color);
          
          // Store channel preset IDs for auto-loading
          if (selectedChannel.project_preset_id) {
            sessionStorage.setItem("calendar_project_preset_id", selectedChannel.project_preset_id);
          }
          // Always store thumbnail preset ID (for UI loading), regardless of enabled state
          if (selectedChannel.thumbnail_preset_id) {
            sessionStorage.setItem("calendar_thumbnail_preset_id", selectedChannel.thumbnail_preset_id);
          }
          // Store enabled state separately (for auto-chaining behavior)
          if (selectedChannel.thumbnail_preset_enabled) {
            sessionStorage.setItem("calendar_thumbnail_chain_enabled", "true");
          } else {
            sessionStorage.removeItem("calendar_thumbnail_chain_enabled");
          }
        }
      } else {
        sessionStorage.removeItem("calendar_channel_name");
        sessionStorage.removeItem("calendar_channel_color");
        sessionStorage.removeItem("calendar_project_preset_id");
        sessionStorage.removeItem("calendar_thumbnail_preset_id");
      }
      onClose();
      window.location.href = "/projects?from_calendar=true";
    } else {
      setShowLaunchDialog(false);
      // Switch to Audio tab to prompt user to add audio
      toast.info("Ajoutez d'abord un fichier audio dans l'onglet Audio");
    }
  };

  const handleAutoGenerate = async () => {
    if (!channelId) {
      toast.error("Sélectionnez une chaîne pour l'auto-génération");
      return;
    }
    const selectedChannel = channels.find(c => c.id === channelId);
    if (!selectedChannel) {
      toast.error("Chaîne introuvable");
      return;
    }
    if (!selectedChannel.script_preset_id || !selectedChannel.tts_preset_id) {
      toast.error("La chaîne doit avoir un preset de script et un preset TTS configurés");
      return;
    }

    setIsAutoGenerating(true);
    try {
      // Fetch presets in parallel
      const [scriptPresetRes, ttsPresetRes, projectPresetRes] = await Promise.all([
        supabase.from("script_presets").select("*").eq("id", selectedChannel.script_preset_id).single(),
        supabase.from("tts_presets").select("*").eq("id", selectedChannel.tts_preset_id).single(),
        selectedChannel.project_preset_id
          ? supabase.from("presets").select("*").eq("id", selectedChannel.project_preset_id).single()
          : Promise.resolve({ data: null }),
      ]);

      const scriptPreset = scriptPresetRes.data;
      const ttsPreset = ttsPresetRes.data;
      const projectPreset = projectPresetRes.data;

      if (!scriptPreset) throw new Error("Preset de script introuvable");
      if (!ttsPreset) throw new Error("Preset TTS introuvable");

      // Build TTS config from preset
      let ttsConfig: Record<string, any> = {
        provider: ttsPreset.provider,
        voice_id: ttsPreset.voice_id,
        model: ttsPreset.model,
        speed: ttsPreset.speed,
        pitch: ttsPreset.pitch,
        volume: ttsPreset.volume,
        languageBoost: ttsPreset.language_boost,
        englishNormalization: ttsPreset.english_normalization,
      };
      // Decode emotion JSON for RVC, audio tags, and provider-specific fields
      try {
        const extras = ttsPreset.emotion ? JSON.parse(ttsPreset.emotion) : {};
        if (extras.rvcEnabled) {
          ttsConfig.rvcEnabled = true;
          ttsConfig.rvcModelUrl = extras.rvcModelUrl;
          ttsConfig.rvcIndexUrl = extras.rvcIndexUrl;
          ttsConfig.rvcPitch = extras.rvcPitch;
          ttsConfig.rvcIndexRate = extras.rvcIndexRate;
        }
        if (extras.audioTagsEnabled) {
          ttsConfig.audioTagsEnabled = true;
          ttsConfig.audioTagsText = extras.audioTagsText;
        }
        if (typeof extras.style === "number") ttsConfig.style = extras.style;
        if (typeof extras.speakerBoost === "boolean") ttsConfig.useSpeakerBoost = extras.speakerBoost;
        if (extras.edgeTTSSpeed) ttsConfig.speed = extras.edgeTTSSpeed;
      } catch { /* not JSON */ }

      // Build project config from preset
      const projectConfig: Record<string, any> = {};
      if (projectPreset) {
        projectConfig.image_model = (projectPreset as any).image_model || "seedream-4.5";
        projectConfig.image_width = projectPreset.image_width || 1920;
        projectConfig.image_height = projectPreset.image_height || 1080;
        projectConfig.aspect_ratio = projectPreset.aspect_ratio || "16:9";
        projectConfig.duration_ranges = (projectPreset as any).duration_ranges || undefined;
        projectConfig.lora_url = (projectPreset as any).lora_url || undefined;
        projectConfig.lora_steps = (projectPreset as any).lora_steps || undefined;
        projectConfig.example_prompts = projectPreset.example_prompts || undefined;
        projectConfig.prompt_system_message = (projectPreset as any).prompt_system_message || undefined;
        projectConfig.style_reference_url = projectPreset.style_reference_url || undefined;
        projectConfig.visual_mode = (projectPreset as any).visual_mode || 'images';
        projectConfig.gameplay_urls = (projectPreset as any).gameplay_urls || undefined;
      }

      const entryId = entry?.id;
      if (!entryId) throw new Error("Carte calendrier non sauvegardée");

      // Block duplicate: check for existing active pipeline
      const { data: existingPipelines } = await supabase.from("auto_pipelines" as any)
        .select("id")
        .eq("calendar_entry_id", entryId)
        .in("step_status", ["pending", "running"])
        .neq("current_step", "completed");
      if (existingPipelines && existingPipelines.length > 0) {
        toast.error("Une auto-génération est déjà en cours pour cette carte.");
        return;
      }

      // Insert pipeline
      const { error: insertError } = await supabase.from("auto_pipelines" as any).insert({
        calendar_entry_id: entryId,
        channel_id: channelId,
        user_id: userId,
        current_step: "create_project",
        step_status: "pending",
        config: {
          script: {
            model: (scriptPreset as any).script_model || "glm5-openrouter",
            custom_prompt: scriptPreset.custom_prompt || "",
            use_batch: (scriptPreset as any).use_batch || false,
            use_web_search: (scriptPreset as any).use_web_search || false,
          },
          tts: ttsConfig,
          project: projectConfig,
        },
      });

      if (insertError) throw new Error(insertError.message);

      toast.success("Auto-génération lancée ! Le script, l'audio et les scènes seront créés automatiquement.");
      setShowLaunchDialog(false);
      onClose();
      onSaved();
    } catch (err: any) {
      console.error("Auto-generate error:", err);
      toast.error(`Erreur: ${err.message}`);
    } finally {
      setIsAutoGenerating(false);
    }
  };

  const handleRetryPipeline = async () => {
    if (!pipelineStatus?.id) return;
    setIsRetryingPipeline(true);
    try {
      const { data, error } = await supabase.functions.invoke("retry-pipeline", {
        body: { pipelineId: pipelineStatus.id },
      });
      if (error) throw new Error(error.message || "Retry failed");
      if (data?.error) throw new Error(data.error);

      setPipelineStatus({ ...pipelineStatus, step_status: "pending", error: null });
      toast.success(`Pipeline relancé (tentative ${data.manualRetry}/${data.maxRetries})`);
    } catch (err: any) {
      toast.error(`Erreur: ${err.message}`);
    } finally {
      setIsRetryingPipeline(false);
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] sm:w-full flex flex-col p-0">
        <div className="overflow-y-auto flex-1 px-6 pt-6 pb-4">
        <DialogHeader>
          <DialogTitle>
            {entry ? "Modifier la vidéo" : "Planifier une vidéo"}
          </DialogTitle>
          <DialogDescription>
            {entry 
              ? "Modifiez les informations de votre vidéo planifiée" 
              : "Ajoutez une nouvelle vidéo à votre calendrier de contenu"
            }
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="info" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Informations</TabsTrigger>
            <TabsTrigger value="script">Script</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="transcript">Source Transcript</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 mt-4">
            {/* Channel selector */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <span className="text-base">📺</span>
                Chaîne
              </Label>
              <div className="flex gap-2">
                <Select 
                  value={channelId || "none"} 
                  onValueChange={(value) => setChannelId(value === "none" ? null : value)}
                  disabled={isLoadingChannels}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={isLoadingChannels ? "Chargement..." : "Sélectionner une chaîne"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Aucune chaîne</span>
                    </SelectItem>
                    {channels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="h-3 w-3 rounded-full flex-shrink-0" 
                            style={{ backgroundColor: channel.color }}
                          />
                          <span>{channel.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowChannelManager(true)}
                  title="Gérer les chaînes et configurer les presets"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Project selector */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Lier à un projet existant
              </Label>
              <Select 
                value={projectId || "none"} 
                onValueChange={handleProjectSelect}
                disabled={isLoadingProjects}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingProjects ? "Chargement..." : "Sélectionner un projet"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Aucun projet</span>
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projectId && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={goToProject}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Ouvrir le projet
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Titre de la vidéo</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: 5 astuces pour mieux dormir"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date prévue</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !scheduledDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {scheduledDate 
                        ? format(scheduledDate, "PPP", { locale: fr }) 
                        : "Sélectionner"
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={scheduledDate}
                      onSelect={setScheduledDate}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Statut</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full", option.color)} />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Idées, références, liens..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="youtube-url">URL YouTube de votre vidéo</Label>
              <div className="flex gap-2">
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(e) => handleYoutubeUrlChange(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1"
                />
                {youtubeUrl && (
                  <Button
                    variant="outline"
                    size="icon"
                    asChild
                  >
                    <a href={youtubeUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="source-url">Source URL (pour récupérer le titre)</Label>
              <div className="flex gap-2">
                <Input
                  id="source-url"
                  value={sourceUrl}
                  onChange={(e) => handleSourceUrlChange(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... (récupère automatiquement le titre)"
                  className="flex-1"
                  disabled={isScrapingSource}
                />
                {isScrapingSource && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {sourceUrl && !isScrapingSource && (
                  <Button
                    variant="outline"
                    size="icon"
                    asChild
                  >
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Collez une URL YouTube pour récupérer automatiquement le titre et la miniature
              </p>
              {sourceThumbnailUrl && (
                <div className="mt-2">
                  <img
                    src={sourceThumbnailUrl}
                    alt="Miniature de la source"
                    className="w-full max-w-md h-auto rounded-lg border"
                  />
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="script" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="script">Script de la vidéo</Label>
              <Textarea
                id="script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Collez ou écrivez le script de votre vidéo ici..."
                rows={15}
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ce script sera utilisé pour générer les scènes de votre vidéo.
            </p>
          </TabsContent>

          <TabsContent value="audio" className="space-y-4 mt-4">
            <div className="space-y-4">
              <Label>Fichier audio</Label>
              
              {audioUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={toggleAudio}
                    >
                      {isPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <span className="text-sm flex-1 truncate">{audioUrl.split("/").pop()}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAudioUrl(null)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onEnded={() => setIsPlaying(false)}
                  />
                </div>
              ) : (
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">
                    Uploadez un fichier audio (MP3, WAV)
                  </p>
                  <label>
                    <Button variant="secondary" disabled={isUploading} asChild>
                      <span>
                        {isUploading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Upload...
                          </>
                        ) : (
                          "Sélectionner un fichier"
                        )}
                      </span>
                    </Button>
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={handleAudioUpload}
                      disabled={isUploading}
                    />
                  </label>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              L'audio sera transcrit automatiquement lors de la génération des scènes.
            </p>
          </TabsContent>

          <TabsContent value="transcript" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Source Video Transcript</Label>
              {isScrapingTranscript ? (
                <div className="flex items-center gap-2 p-4 border rounded-lg bg-muted/50">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Récupération de la transcription en cours...
                  </span>
                </div>
              ) : sourceTranscript ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Transcription disponible ({sourceTranscript.length} caractères)
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyTranscriptToClipboard}
                      className="shrink-0"
                    >
                      {transcriptCopied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="p-4 border rounded-lg bg-muted/50 max-h-96 overflow-y-auto">
                    <p className="text-sm whitespace-pre-wrap">{sourceTranscript}</p>
                  </div>
                </div>
              ) : sourceUrl && !isScrapingTranscript ? (
                <div className="p-4 border rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    La transcription sera récupérée automatiquement après la sauvegarde de l'entrée avec une Source URL.
                  </p>
                </div>
              ) : (
                <div className="p-4 border rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    Aucune transcription disponible. Ajoutez une Source URL dans l'onglet Informations pour récupérer la transcription.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        </div>

        {/* Transcript scraping notification - at bottom */}
        {isScrapingTranscript && (
          <div className="mx-6 mb-2 p-3 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-orange-600 dark:text-orange-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                Récupération de la transcription en cours...
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400">
                Vous pouvez quitter, elle sera disponible automatiquement.
              </p>
            </div>
          </div>
        )}

        {/* Transcript ready notification - at bottom */}
        {sourceTranscript && !isScrapingTranscript && (
          <div className="mx-6 mb-2 p-3 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg flex items-center gap-3">
            <Check className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                Transcription disponible !
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400">
                Utilisez {`{{sourceTranscript}}`} dans le prompt de génération.
              </p>
            </div>
          </div>
        )}

        {/* Auto-pipeline status banner */}
        {pipelineStatus && pipelineStatus.current_step !== 'completed' && pipelineStatus.step_status !== 'failed' && (
          <div className="mx-4 mb-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
              <span className="text-sm font-medium">Auto-génération en cours</span>
            </div>
            <div className="flex gap-1">
              {['create_project', 'generate_script', 'wait_script', 'generate_audio', 'wait_audio', 'transcribe', 'wait_transcription', 'create_scenes', 'generate_prompts', 'wait_prompts', 'generate_images', 'wait_images'].map((step, i) => {
                const steps = ['create_project', 'generate_script', 'wait_script', 'generate_audio', 'wait_audio', 'transcribe', 'wait_transcription', 'create_scenes', 'generate_prompts', 'wait_prompts', 'generate_images', 'wait_images'];
                const currentIdx = steps.indexOf(pipelineStatus.current_step);
                const isDone = i < currentIdx;
                const isCurrent = i === currentIdx;
                const labels = ['Projet', 'Script', 'Script...', 'Audio', 'Audio...', 'Transcription', 'Transcription...', 'Scènes', 'Prompts', 'Prompts...', 'Images', 'Images...'];
                return (
                  <div key={step} className="flex-1" title={labels[i]}>
                    <div className={cn(
                      "h-1.5 rounded-full transition-all",
                      isDone ? "bg-primary" : isCurrent ? "bg-primary/50 animate-pulse" : "bg-muted"
                    )} />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {pipelineStatus.current_step === 'create_project' && 'Création du projet...'}
              {(pipelineStatus.current_step === 'generate_script' || pipelineStatus.current_step === 'wait_script') && 'Génération du script...'}
              {(pipelineStatus.current_step === 'generate_audio' || pipelineStatus.current_step === 'wait_audio') && 'Génération audio...'}
              {(pipelineStatus.current_step === 'transcribe' || pipelineStatus.current_step === 'wait_transcription') && 'Transcription en cours...'}
              {pipelineStatus.current_step === 'create_scenes' && 'Création des scènes...'}
              {(pipelineStatus.current_step === 'generate_prompts' || pipelineStatus.current_step === 'wait_prompts') && 'Génération des prompts...'}
              {(pipelineStatus.current_step === 'generate_images' || pipelineStatus.current_step === 'wait_images') && 'Génération des images...'}
            </p>
          </div>
        )}
        {pipelineStatus?.current_step === 'completed' && (
          <div className="mx-4 mb-2 p-3 rounded-lg border border-green-500/20 bg-green-500/5">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">Auto-génération terminée</span>
            </div>
          </div>
        )}
        {pipelineStatus?.step_status === 'failed' && (
          <div className="mx-4 mb-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Trash2 className="h-4 w-4 text-red-600 flex-shrink-0" />
                <span className="text-sm font-medium text-red-700 dark:text-red-400">Auto-génération échouée</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-red-500/30 hover:bg-red-500/10 flex-shrink-0"
                onClick={handleRetryPipeline}
                disabled={isRetryingPipeline}
              >
                {isRetryingPipeline ? <Loader2 className="h-3 w-3 animate-spin" /> : "Réessayer"}
              </Button>
            </div>
            {pipelineStatus.error && <p className="text-xs text-red-600 mt-1 truncate">{pipelineStatus.error}</p>}
          </div>
        )}

        <div className="flex items-center justify-between p-4 border-t bg-background flex-shrink-0">
          <div>
            {entry && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Supprimer
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {entry && !projectId && (
              <Button
                variant="outline"
                onClick={handleLaunchProject}
                className="gap-2"
              >
                <Rocket className="h-4 w-4" />
                Lancer la génération
              </Button>
            )}
            <Button variant="outline" onClick={handleClose}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : entry ? (
                "Mettre à jour"
              ) : (
                "Planifier"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Launch Options Dialog */}
    <AlertDialog open={showLaunchDialog} onOpenChange={setShowLaunchDialog}>
      <AlertDialogContent className="max-w-md w-[95vw] overflow-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle>Comment voulez-vous créer le projet ?</AlertDialogTitle>
          <AlertDialogDescription>
            Choisissez le mode de création pour votre vidéo "{title}"
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 py-4">
          {channelId && channels.find(c => c.id === channelId)?.script_preset_id && channels.find(c => c.id === channelId)?.tts_preset_id && (
            <Button
              variant="outline"
              className="h-auto py-3 justify-start gap-3 border-primary/30 bg-primary/5 hover:bg-primary/10 w-full whitespace-normal"
              onClick={handleAutoGenerate}
              disabled={isAutoGenerating}
            >
              {isAutoGenerating ? (
                <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
              ) : (
                <Zap className="h-5 w-5 text-primary flex-shrink-0" />
              )}
              <div className="text-left min-w-0">
                <div className="font-semibold text-sm">Auto-génération complète</div>
                <div className="text-xs text-muted-foreground">
                  Script + Audio + Scènes avec les presets de la chaîne
                </div>
              </div>
            </Button>
          )}
          <Button
            variant="outline"
            className="h-auto py-3 justify-start gap-3 w-full whitespace-normal"
            onClick={handleLaunchFromScratch}
          >
            <PenTool className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="text-left min-w-0">
              <div className="font-semibold text-sm">Créer de zéro</div>
              <div className="text-xs text-muted-foreground">
                Écrire le script manuellement ou avec l'IA
              </div>
            </div>
          </Button>
          <Button
            variant="outline"
            className={cn(
              "h-auto py-3 justify-start gap-3 w-full whitespace-normal",
              !audioUrl && "opacity-50"
            )}
            onClick={handleLaunchWithAudio}
          >
            <Mic className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="text-left min-w-0">
              <div className="font-semibold text-sm">À partir d'un audio</div>
              <div className="text-xs text-muted-foreground">
                {audioUrl 
                  ? "Transcrire l'audio et générer les scènes"
                  : "Ajoutez d'abord un audio dans l'onglet Audio"
                }
              </div>
            </div>
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Channel Manager Dialog */}
    <ChannelManager
      isOpen={showChannelManager}
      onClose={() => setShowChannelManager(false)}
      userId={userId}
      onChannelsUpdated={async () => {
        // Reload channels
        const { data } = await supabase
          .from("channels")
          .select("*")
          .eq("user_id", userId)
          .order("name", { ascending: true });
        setChannels(data || []);
      }}
    />
    </>
  );
}
