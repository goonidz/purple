import { useState, useEffect, useRef } from "react";
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
import { CalendarIcon, Upload, Trash2, Loader2, Play, Pause, Rocket, ExternalLink } from "lucide-react";

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
  created_at: string;
  updated_at: string;
}

interface CalendarVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: ContentCalendarEntry | null;
  selectedDate: Date | null;
  userId: string;
  onSaved: () => void;
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
}: CalendarVideoModalProps) {
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [status, setStatus] = useState<string>("planned");
  const [script, setScript] = useState("");
  const [notes, setNotes] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (entry) {
      setTitle(entry.title);
      setScheduledDate(new Date(entry.scheduled_date));
      setStatus(entry.status);
      setScript(entry.script || "");
      setNotes(entry.notes || "");
      setAudioUrl(entry.audio_url);
    } else if (selectedDate) {
      setTitle("");
      setScheduledDate(selectedDate);
      setStatus("planned");
      setScript("");
      setNotes("");
      setAudioUrl(null);
    }
  }, [entry, selectedDate]);

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
      const data = {
        user_id: userId,
        title: title.trim(),
        scheduled_date: format(scheduledDate, "yyyy-MM-dd"),
        status,
        script: script.trim() || null,
        notes: notes.trim() || null,
        audio_url: audioUrl,
      };

      if (entry) {
        const { error } = await supabase
          .from("content_calendar")
          .update(data)
          .eq("id", entry.id);
        if (error) throw error;
        toast.success("Vidéo mise à jour");
      } else {
        const { error } = await supabase
          .from("content_calendar")
          .insert(data);
        if (error) throw error;
        toast.success("Vidéo planifiée");
      }

      onSaved();
    } catch (error) {
      console.error("Error saving entry:", error);
      toast.error("Erreur lors de la sauvegarde");
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

  const handleLaunchProject = () => {
    // Navigate to workspace with the script data
    if (script) {
      // Store script in sessionStorage to pass to workspace
      sessionStorage.setItem("calendar_script", script);
      sessionStorage.setItem("calendar_audio_url", audioUrl || "");
      sessionStorage.setItem("calendar_title", title);
      sessionStorage.setItem("calendar_entry_id", entry?.id || "");
      window.location.href = "/workspace";
    } else {
      toast.error("Ajoutez un script avant de lancer la génération");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

        <div className="flex items-center justify-between mt-6 pt-4 border-t">
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
            {entry && (script || audioUrl) && (
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
  );
}
