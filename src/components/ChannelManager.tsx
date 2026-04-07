import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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
  render_preset_id: string | null;
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
  const [renderPresets, setRenderPresets] = useState<{ id: string; name: string }[]>([]);
  const [selectedScriptPresetId, setSelectedScriptPresetId] = useState<string>("");
  const [selectedTtsPresetId, setSelectedTtsPresetId] = useState<string>("");
  const [selectedProjectPresetId, setSelectedProjectPresetId] = useState<string>("");
  const [selectedThumbnailPresetId, setSelectedThumbnailPresetId] = useState<string>("");
  const [selectedThumbnailV2PresetId, setSelectedThumbnailV2PresetId] = useState<string>("");
  const [selectedRenderPresetId, setSelectedRenderPresetId] = useState<string>("");
  const [thumbnailPresetEnabled, setThumbnailPresetEnabled] = useState<boolean>(true);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [isSavingPresets, setIsSavingPresets] = useState(false);

  // Animator preset state
  const [animatorEnabled, setAnimatorEnabled] = useState(false);
  const [animatorBranding, setAnimatorBranding] = useState({
    palette: { bg: '#111118', accent: '#ef4444', accentDim: 'rgba(239,68,68,0.25)', text: '#f0f0f0', textDim: 'rgba(240,240,240,0.35)' },
    typography: { fontFamily: 'system-ui, sans-serif', heroSize: 150, titleSize: 56, subtitleSize: 32, labelSize: 21 },
    animation: { fadeRatio: 0.12, staggerFrames: 8, premountFrames: 15 },
  });
  const [animatorExtraPrompt, setAnimatorExtraPrompt] = useState('');
  const [animatorModel, setAnimatorModel] = useState('claude-sonnet-4-6');
  const [animatorMinSegDuration, setAnimatorMinSegDuration] = useState(0);
  const [animatorPresetId, setAnimatorPresetId] = useState<string | null>(null);
  const [animatorBrandingMarkdown, setAnimatorBrandingMarkdown] = useState('');
  const [selectedSkillsList, setSelectedSkillsList] = useState<string[]>([
    'animations.md', 'timing.md', 'sequencing.md', 'charts.md', 'text-animations.md',
  ]);

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
      const [scriptData, ttsData, projectData, thumbnailData, thumbnailV2Data, renderData] = await Promise.all([
        supabase.from("script_presets").select("id, name").eq("user_id", uid).order("name"),
        supabase.from("tts_presets").select("id, name").eq("user_id", uid).order("name"),
        supabase.from("presets").select("id, name").eq("user_id", uid).order("name"),
        supabase.from("thumbnail_presets").select("id, name").eq("user_id", uid).is("channel_handle", null).order("name"),
        supabase.from("thumbnail_presets").select("id, name").eq("user_id", uid).not("channel_handle", "is", null).order("name"),
        supabase.from("render_presets" as any).select("id, name").eq("user_id", uid).order("name"),
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
      setRenderPresets((renderData.data as any[]) || []);
    } catch (error) {
      console.error("Error loading presets:", error);
      toast.error("Erreur lors du chargement des presets");
    } finally {
      setIsLoadingPresets(false);
    }
  };

  const handleConfigurePresets = async (channel: Channel) => {
    setConfiguringChannelId(channel.id);
    setConfiguringChannelName(channel.name);
    setSelectedScriptPresetId(channel.script_preset_id || "none");
    setSelectedTtsPresetId(channel.tts_preset_id || "none");
    setSelectedProjectPresetId(channel.project_preset_id || "none");
    setSelectedThumbnailPresetId(channel.thumbnail_preset_id || "none");
    setSelectedThumbnailV2PresetId(channel.thumbnail_v2_preset_id || "none");
    setSelectedRenderPresetId(channel.render_preset_id || "none");
    setThumbnailPresetEnabled(channel.thumbnail_preset_enabled ?? true);

    // Load animator preset if exists
    const chAny = channel as any;
    if (chAny.animator_preset_id) {
      const { data: preset } = await supabase
        .from("animator_presets" as any)
        .select("*")
        .eq("id", chAny.animator_preset_id)
        .single();
      if (preset) {
        setAnimatorPresetId(preset.id);
        setAnimatorEnabled((preset as any).enabled ?? false);
        setAnimatorBranding((preset as any).branding_config || animatorBranding);
        setAnimatorExtraPrompt((preset as any).extra_prompt || '');
        setAnimatorModel((preset as any).model || 'claude-sonnet-4-6');
        setAnimatorBrandingMarkdown((preset as any).branding_markdown || '');
        setSelectedSkillsList((preset as any).selected_skills || ['animations.md', 'timing.md', 'sequencing.md', 'charts.md', 'text-animations.md']);
        setAnimatorMinSegDuration((preset as any).min_segment_duration || 0);
        return;
      }
    }
    setAnimatorPresetId(null);
    setAnimatorEnabled(false);
    setAnimatorExtraPrompt('');
    setAnimatorModel('claude-sonnet-4-6');
    setAnimatorBrandingMarkdown('');
    setAnimatorMinSegDuration(0);
  };

  const [configuringChannelName, setConfiguringChannelName] = useState("");

  const handleSavePresets = async () => {
    if (!configuringChannelId) return;

    setIsSavingPresets(true);
    try {
      // Save or update animator preset
      let finalAnimatorPresetId = animatorPresetId;
      if (animatorEnabled || animatorPresetId) {
        const animatorData = {
          user_id: userId,
          channel_id: configuringChannelId,
          enabled: animatorEnabled,
          branding_config: animatorBranding,
          branding_markdown: animatorBrandingMarkdown,
          extra_prompt: animatorExtraPrompt,
          model: animatorModel,
          selected_skills: selectedSkillsList,
          min_segment_duration: animatorMinSegDuration,
          updated_at: new Date().toISOString(),
        };

        if (animatorPresetId) {
          await supabase.from("animator_presets" as any).update(animatorData as any).eq("id", animatorPresetId);
        } else {
          const { data: newPreset } = await supabase
            .from("animator_presets" as any)
            .insert({ ...animatorData, name: configuringChannelName || 'Animator' } as any)
            .select("id")
            .single();
          if (newPreset) finalAnimatorPresetId = (newPreset as any).id;
        }
      }

      const { error } = await supabase
        .from("channels")
        .update({
          name: configuringChannelName.trim() || configuringChannel?.name,
          script_preset_id: selectedScriptPresetId === "none" ? null : selectedScriptPresetId,
          tts_preset_id: selectedTtsPresetId === "none" ? null : selectedTtsPresetId,
          project_preset_id: selectedProjectPresetId === "none" ? null : selectedProjectPresetId,
          thumbnail_preset_id: selectedThumbnailPresetId === "none" ? null : selectedThumbnailPresetId,
          thumbnail_v2_preset_id: selectedThumbnailV2PresetId === "none" ? null : selectedThumbnailV2PresetId,
          render_preset_id: selectedRenderPresetId === "none" ? null : selectedRenderPresetId,
          thumbnail_preset_enabled: thumbnailPresetEnabled,
          animator_preset_id: finalAnimatorPresetId || null,
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
      channelName={configuringChannelName}
      onChannelNameChange={setConfiguringChannelName}
      scriptPresets={scriptPresets}
      ttsPresets={ttsPresets}
      projectPresets={projectPresets}
      thumbnailPresets={thumbnailPresets}
      thumbnailV2Presets={thumbnailV2Presets}
      renderPresets={renderPresets}
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
      selectedRenderPresetId={selectedRenderPresetId}
      setSelectedRenderPresetId={setSelectedRenderPresetId}
      thumbnailPresetEnabled={thumbnailPresetEnabled}
      setThumbnailPresetEnabled={setThumbnailPresetEnabled}
      isLoadingPresets={isLoadingPresets}
      isSavingPresets={isSavingPresets}
      onSave={handleSavePresets}
      animatorEnabled={animatorEnabled}
      setAnimatorEnabled={setAnimatorEnabled}
      animatorBranding={animatorBranding}
      setAnimatorBranding={setAnimatorBranding}
      animatorExtraPrompt={animatorExtraPrompt}
      setAnimatorExtraPrompt={setAnimatorExtraPrompt}
      animatorModel={animatorModel}
      setAnimatorModel={setAnimatorModel}
      animatorBrandingMarkdown={animatorBrandingMarkdown}
      setAnimatorBrandingMarkdown={setAnimatorBrandingMarkdown}
      selectedSkillsList={selectedSkillsList}
      setSelectedSkillsList={setSelectedSkillsList}
      animatorMinSegDuration={animatorMinSegDuration}
      setAnimatorMinSegDuration={setAnimatorMinSegDuration}
    />
    </>
  );
}

function PresetConfigDialog({
  isOpen,
  onClose,
  channelName,
  onChannelNameChange,
  scriptPresets,
  ttsPresets,
  projectPresets,
  thumbnailPresets,
  thumbnailV2Presets,
  renderPresets,
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
  selectedRenderPresetId,
  setSelectedRenderPresetId,
  thumbnailPresetEnabled,
  setThumbnailPresetEnabled,
  isLoadingPresets,
  isSavingPresets,
  onSave,
  animatorEnabled,
  setAnimatorEnabled,
  animatorBranding,
  setAnimatorBranding,
  animatorExtraPrompt,
  setAnimatorExtraPrompt,
  animatorModel,
  setAnimatorModel,
  animatorBrandingMarkdown,
  setAnimatorBrandingMarkdown,
  selectedSkillsList,
  setSelectedSkillsList,
  animatorMinSegDuration,
  setAnimatorMinSegDuration,
}: {
  isOpen: boolean;
  onClose: () => void;
  channelName: string;
  onChannelNameChange: (name: string) => void;
  scriptPresets: ScriptPreset[];
  ttsPresets: TtsPreset[];
  projectPresets: ProjectPreset[];
  thumbnailPresets: ThumbnailPreset[];
  thumbnailV2Presets: ThumbnailPreset[];
  renderPresets: { id: string; name: string }[];
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
  selectedRenderPresetId: string;
  setSelectedRenderPresetId: (id: string) => void;
  thumbnailPresetEnabled: boolean;
  setThumbnailPresetEnabled: (enabled: boolean) => void;
  isLoadingPresets: boolean;
  isSavingPresets: boolean;
  onSave: () => void;
  animatorEnabled: boolean;
  setAnimatorEnabled: (enabled: boolean) => void;
  animatorBranding: any;
  setAnimatorBranding: (branding: any) => void;
  animatorExtraPrompt: string;
  setAnimatorExtraPrompt: (prompt: string) => void;
  animatorModel: string;
  setAnimatorModel: (model: string) => void;
  animatorBrandingMarkdown: string;
  setAnimatorBrandingMarkdown: (md: string) => void;
  selectedSkillsList: string[];
  setSelectedSkillsList: (skills: string[] | ((prev: string[]) => string[])) => void;
  animatorMinSegDuration: number;
  setAnimatorMinSegDuration: (v: number) => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurer la chaîne</DialogTitle>
          <DialogDescription>
            Sélectionnez les presets par défaut pour cette chaîne. Ils seront automatiquement appliqués lors du lancement d'une génération depuis le calendrier.
          </DialogDescription>
          <Link
            to="/presets"
            className="text-sm text-primary hover:underline mt-1 inline-block"
            onClick={() => onClose()}
          >
            Gérer mes presets
          </Link>
        </DialogHeader>

        {isLoadingPresets ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Nom de la chaîne</Label>
              <Input
                id="channel-name"
                value={channelName}
                onChange={(e) => onChannelNameChange(e.target.value)}
                placeholder="Nom de la chaîne"
              />
            </div>

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

            {/* Render Preset */}
            <div className="space-y-2">
              <Label htmlFor="render-preset">Preset rendu vidéo</Label>
              <Select
                value={selectedRenderPresetId || "none"}
                onValueChange={setSelectedRenderPresetId}
              >
                <SelectTrigger id="render-preset">
                  <SelectValue placeholder="Sélectionner un preset rendu (optionnel)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {renderPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                FPS, effet vidéo, GPU et overlay particles pour le rendu
              </p>
            </div>

            {/* Remotion Animator */}
            <div className="space-y-3 border-t pt-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold">Remotion Animator</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Génère des compositions animées via Claude AI au lieu des images classiques
                  </p>
                </div>
                <Switch checked={animatorEnabled} onCheckedChange={setAnimatorEnabled} />
              </div>

              {animatorEnabled && (
                <div className="space-y-3 pl-2 border-l-2 border-primary/20">
                  <div className="space-y-1">
                    <Label className="text-sm">Modèle Animator</Label>
                    <Select value={animatorModel} onValueChange={setAnimatorModel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                        <SelectItem value="claude-sonnet-4-5-20250620">Claude Sonnet 4.5</SelectItem>
                        <SelectItem value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Durée min. segment (secondes)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={15}
                      step={0.5}
                      value={animatorMinSegDuration}
                      onChange={(e) => setAnimatorMinSegDuration(Number(e.target.value))}
                      className="h-8 text-xs w-32"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      0 = désactivé. Les segments plus courts seront fusionnés avec le suivant.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Fond (BG)</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={animatorBranding.palette.bg}
                          onChange={(e) => setAnimatorBranding(prev => ({
                            ...prev,
                            palette: { ...prev.palette, bg: e.target.value }
                          }))}
                          className="w-8 h-8 rounded cursor-pointer border"
                        />
                        <Input
                          value={animatorBranding.palette.bg}
                          onChange={(e) => setAnimatorBranding(prev => ({
                            ...prev,
                            palette: { ...prev.palette, bg: e.target.value }
                          }))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Accent</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={animatorBranding.palette.accent}
                          onChange={(e) => setAnimatorBranding(prev => ({
                            ...prev,
                            palette: { ...prev.palette, accent: e.target.value }
                          }))}
                          className="w-8 h-8 rounded cursor-pointer border"
                        />
                        <Input
                          value={animatorBranding.palette.accent}
                          onChange={(e) => setAnimatorBranding(prev => ({
                            ...prev,
                            palette: { ...prev.palette, accent: e.target.value }
                          }))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Texte principal</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={animatorBranding.palette.text}
                          onChange={(e) => setAnimatorBranding(prev => ({
                            ...prev,
                            palette: { ...prev.palette, text: e.target.value }
                          }))}
                          className="w-8 h-8 rounded cursor-pointer border"
                        />
                        <Input
                          value={animatorBranding.palette.text}
                          onChange={(e) => setAnimatorBranding(prev => ({
                            ...prev,
                            palette: { ...prev.palette, text: e.target.value }
                          }))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Police (Google Fonts)</Label>
                    <select
                      value={animatorBranding.typography.fontFamily}
                      onChange={(e) => setAnimatorBranding(prev => ({
                        ...prev,
                        typography: { ...prev.typography, fontFamily: e.target.value }
                      }))}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="system-ui, sans-serif">System UI (défaut)</option>
                      <optgroup label="Serif">
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Domine">Domine</option>
                        <option value="Merriweather">Merriweather</option>
                        <option value="Lora">Lora</option>
                        <option value="EB Garamond">EB Garamond</option>
                      </optgroup>
                      <optgroup label="Sans-serif">
                        <option value="Inter">Inter</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Poppins">Poppins</option>
                        <option value="Raleway">Raleway</option>
                        <option value="Outfit">Outfit</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                      </optgroup>
                      <optgroup label="Display">
                        <option value="Bebas Neue">Bebas Neue</option>
                        <option value="Oswald">Oswald</option>
                        <option value="Anton">Anton</option>
                        <option value="Righteous">Righteous</option>
                      </optgroup>
                      <optgroup label="Monospace">
                        <option value="JetBrains Mono">JetBrains Mono</option>
                        <option value="Fira Code">Fira Code</option>
                        <option value="Space Mono">Space Mono</option>
                      </optgroup>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Skills Claude</Label>
                    <p className="text-xs text-muted-foreground">
                      Cochez les compétences envoyées à Claude pour guider la génération des animations.
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { file: 'animations.md', label: 'Animations', desc: 'Springs, interpolations, fades' },
                        { file: 'timing.md', label: 'Timing', desc: 'Durées, rythme des segments' },
                        { file: 'sequencing.md', label: 'Sequencing', desc: 'Ordre et enchaînement' },
                        { file: 'charts.md', label: 'Charts', desc: 'Graphiques SVG, data-viz' },
                        { file: 'text-animations.md', label: 'Text Animations', desc: 'Effets texte, compteurs' },
                        { file: '3d.md', label: '3D', desc: 'Effets 3D, perspective' },
                        { file: 'audio.md', label: 'Audio', desc: 'Synchronisation audio' },
                        { file: 'fonts.md', label: 'Fonts', desc: 'Chargement de polices' },
                        { file: 'transitions.md', label: 'Transitions', desc: 'Wipes, slides, fades' },
                        { file: 'subtitles.md', label: 'Subtitles', desc: 'Sous-titres animés' },
                      ].map(skill => (
                        <label key={skill.file} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSkillsList.includes(skill.file)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSkillsList(prev => [...prev, skill.file]);
                              } else {
                                setSelectedSkillsList(prev => prev.filter(s => s !== skill.file));
                              }
                            }}
                            className="mt-0.5 rounded border-input"
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-medium">{skill.label}</span>
                            <p className="text-[10px] text-muted-foreground leading-tight">{skill.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Branding & Style (Markdown)</Label>
                      {!animatorBrandingMarkdown && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={async () => {
                            const { data, error } = await supabase.rpc('get_default_branding_markdown');
                            if (error) {
                              toast.error('Impossible de charger le template par défaut');
                              return;
                            }
                            if (data) setAnimatorBrandingMarkdown(data);
                          }}
                        >
                          Charger le template par défaut
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Document complet envoyé à Claude comme référence de style. Laissez vide pour utiliser le branding par défaut.
                    </p>
                    <textarea
                      value={animatorBrandingMarkdown}
                      onChange={(e) => setAnimatorBrandingMarkdown(e.target.value)}
                      placeholder="Laissez vide pour utiliser le branding par défaut, ou collez/éditez votre guide de style ici..."
                      className="w-full h-48 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono leading-relaxed"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm">Instructions supplémentaires (optionnel)</Label>
                    <textarea
                      value={animatorExtraPrompt}
                      onChange={(e) => setAnimatorExtraPrompt(e.target.value)}
                      placeholder="Ex: Style minimaliste, pas de charts, focus sur le texte..."
                      className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
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










