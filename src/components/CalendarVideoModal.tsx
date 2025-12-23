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
import { CalendarIcon, Upload, Trash2, Loader2, Play, Pause, Rocket, ExternalLink, FolderOpen, Link2, Mic, PenTool, Plus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import ChannelManager from "@/components/ChannelManager";

interface Channel {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

interface ContentCalendarEntry {
  id: string;
  user_id: string;
  title: string;
  scheduled_date: string;
  status: 'planned' | 'scripted' | 'audio_ready' | 'generating' | 'completed';
  script: string | null;
  audio_url: string | null;
  notes: string | null;
  project_id: string | null;
  youtube_url: string | null;
  channel_id: string | null;
  source_url: string | null;
  source_thumbnail_url: string | null;
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
}

const statusOptions = [
  { value: "planned", label: "Planifié", color: "bg-muted" },
  { value: "scripted", label: "Script prêt", color: "bg-blue-500/20" },
  { value: "audio_ready", label: "Audio prêt", color: "bg-yellow-500/20" },
  { value: "generating", label: "En génération", color: "bg-purple-500/20" },
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
  const [isScrapingSource, setIsScrapingSource] = useState(false);
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      setProjectId(entry.project_id);
      setChannelId(entry.channel_id);
    } else if (selectedDate) {
      setTitle("");
      setScheduledDate(selectedDate);
      setStatus("planned");
      setScript("");
      setNotes("");
      setAudioUrl(null);
      setYoutubeUrl("");
      setSourceUrl(initialSourceUrl || "");
      setSourceThumbnailUrl(initialSourceThumbnailUrl || null);
      setProjectId(null);
      setChannelId(null);
    }
  }, [entry, selectedDate, initialSourceUrl, initialSourceThumbnailUrl]);

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
        project_id: projectId,
        channel_id: channelId,
      };

      // Try saving with thumbnail first
      let error: any = null;
      if (entry) {
        const result = await supabase
          .from("content_calendar")
          .update(dataWithThumbnail)
          .eq("id", entry.id);
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
        
        if (entry) {
          const retryResult = await supabase
            .from("content_calendar")
            .update(dataWithoutThumbnail)
            .eq("id", entry.id);
          if (retryResult.error) throw retryResult.error;
        } else {
          const retryResult = await supabase
            .from("content_calendar")
            .insert(dataWithoutThumbnail);
          if (retryResult.error) throw retryResult.error;
        }
        
        toast.success(entry ? "Vidéo mise à jour (miniature non sauvegardée - cache en cours de mise à jour)" : "Vidéo planifiée (miniature non sauvegardée - cache en cours de mise à jour)", {
          duration: 4000
        });
      } else if (error) {
        throw error;
      } else {
        toast.success(entry ? "Vidéo mise à jour" : "Vidéo planifiée");
      }

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
      const { error } = await supabase
        .from("content_calendar")
        .delete()
        .eq("id", entry.id);
      if (error) throw error;
      toast.success("Vidéo supprimée");
      onSaved();
    } catch (error) {
      console.error("Error deleting entry:", error);
      toast.error("Erreur lors de la suppression");
    } finally {
      setIsDeleting(false);
    }
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

  const handleSourceUrlChange = async (url: string) => {
    setSourceUrl(url);
    
    // Clear thumbnail if URL is empty
    if (!url.trim()) {
      setSourceThumbnailUrl(null);
      return;
    }
    
    // Check if it's a YouTube URL
    const youtubePattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/|^)([a-zA-Z0-9_-]{11})/;
    if (youtubePattern.test(url)) {
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
        }
      } catch (error: any) {
        console.error("Error scraping YouTube:", error);
        toast.error(error.message || "Erreur lors de la récupération des informations");
      } finally {
        setIsScrapingSource(false);
      }
    }
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
      onClose();
      window.location.href = "/projects?from_calendar=true";
    } else {
      setShowLaunchDialog(false);
      // Switch to Audio tab to prompt user to add audio
      toast.info("Ajoutez d'abord un fichier audio dans l'onglet Audio");
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="info">Informations</TabsTrigger>
            <TabsTrigger value="script">Script</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
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
                  title="Gérer les chaînes"
                >
                  <Plus className="h-4 w-4" />
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
              <Label htmlFor="youtube-url">URL YouTube</Label>
              <div className="flex gap-2">
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
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
        </Tabs>

        </div>
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
            <Button variant="outline" onClick={onClose}>
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Comment voulez-vous créer le projet ?</AlertDialogTitle>
          <AlertDialogDescription>
            Choisissez le mode de création pour votre vidéo "{title}"
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button
            variant="outline"
            className="h-auto py-4 justify-start gap-4"
            onClick={handleLaunchFromScratch}
          >
            <PenTool className="h-6 w-6 text-primary" />
            <div className="text-left">
              <div className="font-semibold">Créer de zéro</div>
              <div className="text-sm text-muted-foreground">
                Écrire le script manuellement ou avec l'IA
              </div>
            </div>
          </Button>
          <Button
            variant="outline"
            className={cn(
              "h-auto py-4 justify-start gap-4",
              !audioUrl && "opacity-50"
            )}
            onClick={handleLaunchWithAudio}
          >
            <Mic className="h-6 w-6 text-primary" />
            <div className="text-left">
              <div className="font-semibold">À partir d'un audio</div>
              <div className="text-sm text-muted-foreground">
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
