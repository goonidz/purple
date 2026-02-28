import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, Check, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

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
  thumbnail_v2_preset_id: string | null;
}

interface ScriptPreset {
  id: string;
  name: string;
}

interface TtsPreset {
  id: string;
  name: string;
}

interface ProjectPreset {
  id: string;
  name: string;
}

interface ThumbnailPreset {
  id: string;
  name: string;
}

interface ChannelManagerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onChannelsUpdated: () => void;
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f43f5e", // rose
];

export default function ChannelManager({
  isOpen,
  onClose,
  userId,
  onChannelsUpdated,
}: ChannelManagerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelColor, setNewChannelColor] = useState("#3b82f6");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("");
  
  // Preset configuration
  const [configuringChannelId, setConfiguringChannelId] = useState<string | null>(null);
  const [scriptPresets, setScriptPresets] = useState<ScriptPreset[]>([]);
  const [ttsPresets, setTtsPresets] = useState<TtsPreset[]>([]);
  const [projectPresets, setProjectPresets] = useState<ProjectPreset[]>([]);
  const [thumbnailPresets, setThumbnailPresets] = useState<ThumbnailPreset[]>([]);
  const [thumbnailV2Presets, setThumbnailV2Presets] = useState<ThumbnailPreset[]>([]);
  const [selectedScriptPresetId, setSelectedScriptPresetId] = useState<string>("");
  const [selectedTtsPresetId, setSelectedTtsPresetId] = useState<string>("");
  const [selectedProjectPresetId, setSelectedProjectPresetId] = useState<string>("");
  const [selectedThumbnailPresetId, setSelectedThumbnailPresetId] = useState<string>("");
  const [selectedThumbnailV2PresetId, setSelectedThumbnailV2PresetId] = useState<string>("");
  const [thumbnailPresetEnabled, setThumbnailPresetEnabled] = useState<boolean>(true);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [isSavingPresets, setIsSavingPresets] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadChannels();
      loadPresets();
    }
  }, [isOpen]);

  const loadChannels = async () => {
    setIsLoading(true);
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
      toast.error("Erreur lors du chargement des chaînes");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) {
      toast.error("Le nom de la chaîne est requis");
      return;
    }

    setIsCreating(true);
    try {
      const { error } = await supabase.from("channels").insert({
        user_id: userId,
        name: newChannelName.trim(),
        color: newChannelColor,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("Une chaîne avec ce nom existe déjà");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Chaîne créée");
      setNewChannelName("");
      setNewChannelColor("#3b82f6");
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error creating channel:", error);
      toast.error("Erreur lors de la création de la chaîne");
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateChannel = async (id: string) => {
    if (!editingName.trim()) {
      toast.error("Le nom de la chaîne est requis");
      return;
    }

    try {
      const { error } = await supabase
        .from("channels")
        .update({
          name: editingName.trim(),
          color: editingColor,
        })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          toast.error("Une chaîne avec ce nom existe déjà");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Chaîne mise à jour");
      setEditingId(null);
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error updating channel:", error);
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm("Supprimer cette chaîne ? Les vidéos associées ne seront plus liées à aucune chaîne.")) {
      return;
    }

    try {
      const { error } = await supabase.from("channels").delete().eq("id", id);

      if (error) throw error;

      toast.success("Chaîne supprimée");
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error deleting channel:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const startEditing = (channel: Channel) => {
    setEditingId(channel.id);
    setEditingName(channel.name);
    setEditingColor(channel.color);
  };

  const loadPresets = async () => {
    setIsLoadingPresets(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsLoadingPresets(false); return; }
      const uid = user.id;
      const [scriptData, ttsData, projectData, thumbnailData, thumbnailV2Data] = await Promise.all([
        supabase.from("script_presets").select("id, name").eq("user_id", uid).order("name"),
        supabase.from("tts_presets").select("id, name").eq("user_id", uid).order("name"),
        supabase.from("presets").select("id, name").eq("user_id", uid).order("name"),
        supabase.from("thumbnail_presets").select("id, name").eq("user_id", uid).is("channel_handle", null).order("name"),
        supabase.from("thumbnail_presets").select("id, name").eq("user_id", uid).not("channel_handle", "is", null).order("name"),
      ]);

      if (scriptData.error) throw scriptData.error;
      if (ttsData.error) throw ttsData.error;
      if (projectData.error) throw projectData.error;
      if (thumbnailData.error) throw thumbnailData.error;
      if (thumbnailV2Data.error) throw thumbnailV2Data.error;

      setScriptPresets(scriptData.data || []);
      setTtsPresets(ttsData.data || []);
      setProjectPresets(projectData.data || []);
      setThumbnailPresets(thumbnailData.data || []);
      setThumbnailV2Presets(thumbnailV2Data.data || []);
    } catch (error) {
      console.error("Error loading presets:", error);
      toast.error("Erreur lors du chargement des presets");
    } finally {
      setIsLoadingPresets(false);
    }
  };

  const handleConfigurePresets = (channel: Channel) => {
    setConfiguringChannelId(channel.id);
    setSelectedScriptPresetId(channel.script_preset_id || "none");
    setSelectedTtsPresetId(channel.tts_preset_id || "none");
    setSelectedProjectPresetId(channel.project_preset_id || "none");
    setSelectedThumbnailPresetId(channel.thumbnail_preset_id || "none");
    setSelectedThumbnailV2PresetId(channel.thumbnail_v2_preset_id || "none");
    setThumbnailPresetEnabled(channel.thumbnail_preset_enabled ?? true);
  };

  const handleSavePresets = async () => {
    if (!configuringChannelId) return;

    setIsSavingPresets(true);
    try {
      const { error } = await supabase
        .from("channels")
        .update({
          script_preset_id: selectedScriptPresetId === "none" ? null : selectedScriptPresetId,
          tts_preset_id: selectedTtsPresetId === "none" ? null : selectedTtsPresetId,
          project_preset_id: selectedProjectPresetId === "none" ? null : selectedProjectPresetId,
          thumbnail_preset_id: selectedThumbnailPresetId === "none" ? null : selectedThumbnailPresetId,
          thumbnail_v2_preset_id: selectedThumbnailV2PresetId === "none" ? null : selectedThumbnailV2PresetId,
          thumbnail_preset_enabled: thumbnailPresetEnabled,
        } as any)
        .eq("id", configuringChannelId);

      if (error) throw error;

      toast.success("Presets configurés !");
      setConfiguringChannelId(null);
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error saving presets:", error);
      toast.error("Erreur lors de la sauvegarde des presets");
    } finally {
      setIsSavingPresets(false);
    }
  };

  const configuringChannel = channels.find(c => c.id === configuringChannelId);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gérer les chaînes</DialogTitle>
          <DialogDescription>
            Créez et organisez vos chaînes pour différencier vos vidéos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Create new channel */}
          <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
            <Label className="font-medium">Nouvelle chaîne</Label>
            <div className="flex gap-2">
              <Input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="Nom de la chaîne"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreateChannel()}
              />
              <Button
                onClick={handleCreateChannel}
                disabled={isCreating || !newChannelName.trim()}
                size="icon"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    "h-6 w-6 rounded-full transition-all hover:scale-110",
                    newChannelColor === color && "ring-2 ring-offset-2 ring-primary"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewChannelColor(color)}
                />
              ))}
            </div>
          </div>

          {/* Existing channels */}
          <div className="space-y-2">
            <Label className="font-medium">Vos chaînes</Label>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : channels.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aucune chaîne créée
              </p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center gap-2 p-3 border rounded-lg bg-card"
                  >
                    {editingId === channel.id ? (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {PRESET_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={cn(
                                "h-5 w-5 rounded-full transition-all hover:scale-110",
                                editingColor === color && "ring-2 ring-offset-1 ring-primary"
                              )}
                              style={{ backgroundColor: color }}
                              onClick={() => setEditingColor(color)}
                            />
                          ))}
                        </div>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="flex-1 h-8"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdateChannel(channel.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleUpdateChannel(channel.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div
                          className="h-4 w-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: channel.color }}
                        />
                        <span
                          className="flex-1 cursor-pointer hover:text-primary transition-colors"
                          onClick={() => startEditing(channel)}
                        >
                          {channel.name}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleConfigurePresets(channel)}
                          title="Configurer les presets"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteChannel(channel.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <PresetConfigDialog
      isOpen={!!configuringChannelId}
      onClose={() => setConfiguringChannelId(null)}
      channelName={configuringChannel?.name || ""}
      scriptPresets={scriptPresets}
      ttsPresets={ttsPresets}
      projectPresets={projectPresets}
      thumbnailPresets={thumbnailPresets}
      thumbnailV2Presets={thumbnailV2Presets}
      selectedScriptPresetId={selectedScriptPresetId}
      setSelectedScriptPresetId={setSelectedScriptPresetId}
      selectedTtsPresetId={selectedTtsPresetId}
      setSelectedTtsPresetId={setSelectedTtsPresetId}
      selectedProjectPresetId={selectedProjectPresetId}
      setSelectedProjectPresetId={setSelectedProjectPresetId}
      selectedThumbnailPresetId={selectedThumbnailPresetId}
      setSelectedThumbnailPresetId={setSelectedThumbnailPresetId}
      selectedThumbnailV2PresetId={selectedThumbnailV2PresetId}
      setSelectedThumbnailV2PresetId={setSelectedThumbnailV2PresetId}
      thumbnailPresetEnabled={thumbnailPresetEnabled}
      setThumbnailPresetEnabled={setThumbnailPresetEnabled}
      isLoadingPresets={isLoadingPresets}
      isSavingPresets={isSavingPresets}
      onSave={handleSavePresets}
    />
    </>
  );
}

function PresetConfigDialog({
  isOpen,
  onClose,
  channelName,
  scriptPresets,
  ttsPresets,
  projectPresets,
  thumbnailPresets,
  thumbnailV2Presets,
  selectedScriptPresetId,
  setSelectedScriptPresetId,
  selectedTtsPresetId,
  setSelectedTtsPresetId,
  selectedProjectPresetId,
  setSelectedProjectPresetId,
  selectedThumbnailPresetId,
  setSelectedThumbnailPresetId,
  selectedThumbnailV2PresetId,
  setSelectedThumbnailV2PresetId,
  thumbnailPresetEnabled,
  setThumbnailPresetEnabled,
  isLoadingPresets,
  isSavingPresets,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  channelName: string;
  scriptPresets: ScriptPreset[];
  ttsPresets: TtsPreset[];
  projectPresets: ProjectPreset[];
  thumbnailPresets: ThumbnailPreset[];
  thumbnailV2Presets: ThumbnailPreset[];
  selectedScriptPresetId: string;
  setSelectedScriptPresetId: (id: string) => void;
  selectedTtsPresetId: string;
  setSelectedTtsPresetId: (id: string) => void;
  selectedProjectPresetId: string;
  setSelectedProjectPresetId: (id: string) => void;
  selectedThumbnailPresetId: string;
  setSelectedThumbnailPresetId: (id: string) => void;
  selectedThumbnailV2PresetId: string;
  setSelectedThumbnailV2PresetId: (id: string) => void;
  thumbnailPresetEnabled: boolean;
  setThumbnailPresetEnabled: (enabled: boolean) => void;
  isLoadingPresets: boolean;
  isSavingPresets: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurer les presets - {channelName}</DialogTitle>
          <DialogDescription>
            Sélectionnez les presets par défaut pour cette chaîne. Ils seront automatiquement appliqués lors du lancement d'une génération depuis le calendrier.
          </DialogDescription>
        </DialogHeader>

        {isLoadingPresets ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Script Preset */}
            <div className="space-y-2">
              <Label htmlFor="script-preset">Preset de script</Label>
              <Select value={selectedScriptPresetId || "none"} onValueChange={setSelectedScriptPresetId}>
                <SelectTrigger id="script-preset">
                  <SelectValue placeholder="Sélectionner un preset de script (optionnel)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {scriptPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Définit le style et la structure du script généré
              </p>
            </div>

            {/* TTS Preset */}
            <div className="space-y-2">
              <Label htmlFor="tts-preset">Preset TTS (voix)</Label>
              <Select value={selectedTtsPresetId || "none"} onValueChange={setSelectedTtsPresetId}>
                <SelectTrigger id="tts-preset">
                  <SelectValue placeholder="Sélectionner un preset TTS (optionnel)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {ttsPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Définit la voix et les paramètres audio (Inworld/Minimax)
              </p>
            </div>

            {/* Project Preset */}
            <div className="space-y-2">
              <Label htmlFor="project-preset">Preset projet</Label>
              <Select value={selectedProjectPresetId || "none"} onValueChange={setSelectedProjectPresetId}>
                <SelectTrigger id="project-preset">
                  <SelectValue placeholder="Sélectionner un preset projet (optionnel)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {projectPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Définit les durées de scènes, prompts exemples, modèle d'image et LoRA
              </p>
            </div>

            {/* Thumbnail Preset */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="thumbnail-preset">Preset miniatures</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="thumbnail-enabled" className="text-sm font-normal cursor-pointer">
                    Activer
                  </Label>
                  <Switch
                    id="thumbnail-enabled"
                    checked={thumbnailPresetEnabled}
                    onCheckedChange={setThumbnailPresetEnabled}
                  />
                </div>
              </div>
              <Select
                value={selectedThumbnailPresetId || "none"}
                onValueChange={setSelectedThumbnailPresetId}
                disabled={!thumbnailPresetEnabled}
              >
                <SelectTrigger id="thumbnail-preset">
                  <SelectValue placeholder="Sélectionner un preset miniatures (optionnel)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {thumbnailPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Définit les images d'exemple et le style pour la génération de miniatures
              </p>
            </div>

            {/* Thumbnail V2 Preset */}
            <div className="space-y-2">
              <Label htmlFor="thumbnail-v2-preset">Preset miniatures V2</Label>
              <Select
                value={selectedThumbnailV2PresetId || "none"}
                onValueChange={setSelectedThumbnailV2PresetId}
              >
                <SelectTrigger id="thumbnail-v2-preset">
                  <SelectValue placeholder="Sélectionner un preset miniatures V2 (optionnel)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {thumbnailV2Presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Chaîne YouTube source, visage et modèle pour la génération V2
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose} disabled={isSavingPresets}>
            Annuler
          </Button>
          <Button onClick={onSave} disabled={isSavingPresets || isLoadingPresets}>
            {isSavingPresets ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Enregistrement...
              </>
            ) : (
              "Enregistrer"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}










