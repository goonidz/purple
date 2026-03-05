import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Pencil,
  Copy,
  Trash2,
  FileText,
  Mic,
  Image,
  Layers,
  FolderOpen,
  MoreHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import { PresetManager } from "@/components/PresetManager";
import { ExportPathPresetManager } from "@/components/ExportPathPresetManager";
import { DurationRange, convertLegacyToRanges, DEFAULT_DURATION_RANGES } from "@/lib/durationRanges";

const DEFAULT_SCRIPT_PROMPT = `Tu es un expert en écriture de scripts pour vidéos YouTube.
Génère un script structuré, engageant et adapté au format court.`;

// Script presets
interface ScriptPreset {
  id: string;
  name: string;
  custom_prompt: string | null;
  script_model: string | null;
  use_batch: boolean | null;
}

// TTS presets (minimal for list + edit)
interface TtsPresetRow {
  id: string;
  name: string;
  provider: string;
  voice_id: string;
  model: string | null;
  speed: number;
  pitch?: number;
  volume?: number;
  language_boost?: string;
  emotion?: string;
}

// Project preset (from PresetManager)
interface ProjectPresetRow {
  id: string;
  name: string;
  scene_duration_0to1?: number;
  scene_duration_1to3?: number;
  scene_duration_3plus?: number;
  range_end_1?: number;
  range_end_2?: number;
  duration_ranges?: DurationRange[];
  example_prompts?: string[];
  image_width?: number;
  image_height?: number;
  aspect_ratio?: string;
  style_reference_url?: string | null;
  image_model?: string;
  prompt_system_message?: string | null;
  lora_url?: string | null;
  lora_steps?: number;
  qa_prompt?: string | null;
}

// Thumbnail preset
interface ThumbnailPresetRow {
  id: string;
  name: string;
  channel_handle: string | null;
  example_urls?: string[] | null;
  character_ref_url: string | null;
  custom_prompt: string | null;
  system_prompt: string | null;
  image_model: string | null;
}

// LoRA preset
interface LoraPresetRow {
  id: string;
  name: string;
  lora_url: string;
  lora_steps: number;
}

export default function Presets() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("script");

  // Script
  const [scriptPresets, setScriptPresets] = useState<ScriptPreset[]>([]);
  const [scriptLoading, setScriptLoading] = useState(true);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [scriptEditId, setScriptEditId] = useState<string | null>(null);
  const [scriptName, setScriptName] = useState("");
  const [scriptPrompt, setScriptPrompt] = useState(DEFAULT_SCRIPT_PROMPT);
  const [scriptModel, setScriptModel] = useState("claude");
  const [scriptUseBatch, setScriptUseBatch] = useState(false);
  const [scriptSaving, setScriptSaving] = useState(false);

  // TTS
  const [ttsPresets, setTtsPresets] = useState<TtsPresetRow[]>([]);
  const [ttsLoading, setTtsLoading] = useState(true);
  const [ttsDialogOpen, setTtsDialogOpen] = useState(false);
  const [ttsEditId, setTtsEditId] = useState<string | null>(null);
  const [ttsName, setTtsName] = useState("");
  const [ttsProvider, setTtsProvider] = useState("genaipro");
  const [ttsVoiceId, setTtsVoiceId] = useState("");
  const [ttsModel, setTtsModel] = useState("");
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [ttsEmotion, setTtsEmotion] = useState("{}");
  const [ttsSaving, setTtsSaving] = useState(false);

  // Project
  const [projectPresets, setProjectPresets] = useState<ProjectPresetRow[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectEditId, setProjectEditId] = useState<string | null>(null);
  const [projectPresetManagerKey, setProjectPresetManagerKey] = useState(0);

  // Thumbnail
  const [thumbPresets, setThumbPresets] = useState<ThumbnailPresetRow[]>([]);
  const [thumbLoading, setThumbLoading] = useState(true);
  const [thumbDialogOpen, setThumbDialogOpen] = useState(false);
  const [thumbEditId, setThumbEditId] = useState<string | null>(null);
  const [thumbName, setThumbName] = useState("");
  const [thumbChannelHandle, setThumbChannelHandle] = useState("");
  const [thumbCharacterRef, setThumbCharacterRef] = useState("");
  const [thumbCustomPrompt, setThumbCustomPrompt] = useState("");
  const [thumbSystemPrompt, setThumbSystemPrompt] = useState("");
  const [thumbImageModel, setThumbImageModel] = useState("seedream-4.5");
  const [thumbSaving, setThumbSaving] = useState(false);

  // LoRA
  const [loraPresets, setLoraPresets] = useState<LoraPresetRow[]>([]);
  const [loraLoading, setLoraLoading] = useState(true);
  const [loraDialogOpen, setLoraDialogOpen] = useState(false);
  const [loraEditId, setLoraEditId] = useState<string | null>(null);
  const [loraName, setLoraName] = useState("");
  const [loraUrl, setLoraUrl] = useState("");
  const [loraSteps, setLoraSteps] = useState(10);
  const [loraSaving, setLoraSaving] = useState(false);

  useEffect(() => {
    document.title = "Mes presets";
  }, []);

  const loadScriptPresets = async () => {
    setScriptLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("script_presets")
        .select("id, name, custom_prompt, script_model, use_batch")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      if (error) throw error;
      setScriptPresets((data as ScriptPreset[]) || []);
    } catch (e) {
      console.error(e);
      toast.error("Erreur chargement presets script");
    } finally {
      setScriptLoading(false);
    }
  };

  const loadTtsPresets = async () => {
    setTtsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("tts_presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      if (error) throw error;
      setTtsPresets((data as TtsPresetRow[]) || []);
    } catch (e) {
      console.error(e);
      toast.error("Erreur chargement presets TTS");
    } finally {
      setTtsLoading(false);
    }
  };

  const loadProjectPresets = async () => {
    setProjectLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      if (error) throw error;
      setProjectPresets((data as ProjectPresetRow[]) || []);
    } catch (e) {
      console.error(e);
      toast.error("Erreur chargement presets projet");
    } finally {
      setProjectLoading(false);
    }
  };

  const loadThumbPresets = async () => {
    setThumbLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("thumbnail_presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      if (error) throw error;
      setThumbPresets((data as ThumbnailPresetRow[]) || []);
    } catch (e) {
      console.error(e);
      toast.error("Erreur chargement presets miniatures");
    } finally {
      setThumbLoading(false);
    }
  };

  const loadLoraPresets = async () => {
    setLoraLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("lora_presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      if (error) throw error;
      setLoraPresets((data as LoraPresetRow[]) || []);
    } catch (e) {
      console.error(e);
      toast.error("Erreur chargement presets LoRA");
    } finally {
      setLoraLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "script") loadScriptPresets();
    else if (activeTab === "tts") loadTtsPresets();
    else if (activeTab === "project") loadProjectPresets();
    else if (activeTab === "thumbnail") loadThumbPresets();
    else if (activeTab === "lora") loadLoraPresets();
  }, [activeTab]);

  // Script CRUD
  const openScriptCreate = () => {
    setScriptEditId(null);
    setScriptName("");
    setScriptPrompt(DEFAULT_SCRIPT_PROMPT);
    setScriptModel("claude");
    setScriptUseBatch(false);
    setScriptDialogOpen(true);
  };

  const openScriptEdit = (p: ScriptPreset) => {
    setScriptEditId(p.id);
    setScriptName(p.name);
    setScriptPrompt(p.custom_prompt || DEFAULT_SCRIPT_PROMPT);
    setScriptModel(p.script_model || "claude");
    setScriptUseBatch(p.use_batch ?? false);
    setScriptDialogOpen(true);
  };

  const saveScriptPreset = async () => {
    if (!scriptName.trim()) {
      toast.error("Nom requis");
      return;
    }
    setScriptSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      if (scriptEditId) {
        const { error } = await supabase
          .from("script_presets")
          .update({
            name: scriptName.trim(),
            custom_prompt: scriptPrompt,
            script_model: scriptModel,
            use_batch: scriptUseBatch,
          })
          .eq("id", scriptEditId);
        if (error) throw error;
        toast.success("Preset script mis à jour");
      } else {
        const { error } = await supabase.from("script_presets").insert({
          user_id: user.id,
          name: scriptName.trim(),
          custom_prompt: scriptPrompt,
          script_model: scriptModel,
          use_batch: scriptUseBatch,
        });
        if (error) throw error;
        toast.success("Preset script créé");
      }
      setScriptDialogOpen(false);
      loadScriptPresets();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erreur sauvegarde");
    } finally {
      setScriptSaving(false);
    }
  };

  const duplicateScriptPreset = async (p: ScriptPreset) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("script_presets").insert({
        user_id: user.id,
        name: `${p.name} (copie)`,
        custom_prompt: p.custom_prompt,
        script_model: p.script_model,
        use_batch: p.use_batch,
      });
      if (error) throw error;
      toast.success("Preset dupliqué");
      loadScriptPresets();
    } catch (e) {
      toast.error("Erreur duplication");
    }
  };

  const deleteScriptPreset = async (p: ScriptPreset) => {
    if (!confirm(`Supprimer le preset "${p.name}" ?`)) return;
    try {
      const { error } = await supabase.from("script_presets").delete().eq("id", p.id);
      if (error) throw error;
      toast.success("Preset supprimé");
      loadScriptPresets();
    } catch (e) {
      toast.error("Erreur suppression");
    }
  };

  // TTS CRUD (simplified: name, provider, voice_id, model, speed, emotion JSON)
  const openTtsCreate = () => {
    setTtsEditId(null);
    setTtsName("");
    setTtsProvider("genaipro");
    setTtsVoiceId("");
    setTtsModel("");
    setTtsSpeed(1);
    setTtsEmotion("{}");
    setTtsDialogOpen(true);
  };

  const openTtsEdit = (p: TtsPresetRow) => {
    setTtsEditId(p.id);
    setTtsName(p.name);
    setTtsProvider(p.provider);
    setTtsVoiceId(p.voice_id || "");
    setTtsModel(p.model || "");
    setTtsSpeed(typeof p.speed === "number" ? p.speed : 1);
    setTtsEmotion(p.emotion || "{}");
    setTtsDialogOpen(true);
  };

  const saveTtsPreset = async () => {
    if (!ttsName.trim()) {
      toast.error("Nom requis");
      return;
    }
    setTtsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      const row: Record<string, unknown> = {
        name: ttsName.trim(),
        provider: ttsProvider,
        voice_id: ttsVoiceId.trim() || null,
        model: ttsModel.trim() || null,
        speed: ttsSpeed,
        emotion: ttsEmotion.trim() || "{}",
      };
      if (ttsEditId) {
        const { error } = await supabase.from("tts_presets").update(row).eq("id", ttsEditId);
        if (error) throw error;
        toast.success("Preset TTS mis à jour");
      } else {
        const { error } = await supabase.from("tts_presets").insert({ user_id: user.id, ...row });
        if (error) throw error;
        toast.success("Preset TTS créé");
      }
      setTtsDialogOpen(false);
      loadTtsPresets();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erreur sauvegarde");
    } finally {
      setTtsSaving(false);
    }
  };

  const duplicateTtsPreset = async (p: TtsPresetRow) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("tts_presets").insert({
        user_id: user.id,
        name: `${p.name} (copie)`,
        provider: p.provider,
        voice_id: p.voice_id,
        model: p.model,
        speed: p.speed,
        pitch: p.pitch,
        volume: p.volume,
        language_boost: p.language_boost,
        emotion: p.emotion,
      });
      if (error) throw error;
      toast.success("Preset TTS dupliqué");
      loadTtsPresets();
    } catch (e) {
      toast.error("Erreur duplication");
    }
  };

  const deleteTtsPreset = async (p: TtsPresetRow) => {
    if (!confirm(`Supprimer le preset TTS "${p.name}" ?`)) return;
    try {
      const { error } = await supabase.from("tts_presets").delete().eq("id", p.id);
      if (error) throw error;
      toast.success("Preset TTS supprimé");
      loadTtsPresets();
    } catch (e) {
      toast.error("Erreur suppression");
    }
  };

  // Project: open edit dialog with PresetManager (edit by id)
  const openProjectEdit = (id: string) => {
    setProjectEditId(id);
    setProjectPresetManagerKey((k) => k + 1);
  };

  const closeProjectEdit = () => {
    setProjectEditId(null);
    loadProjectPresets();
  };

  const deleteProjectPreset = async (p: ProjectPresetRow) => {
    if (!confirm(`Supprimer le preset "${p.name}" ?`)) return;
    try {
      const { error } = await supabase.from("presets").delete().eq("id", p.id);
      if (error) throw error;
      toast.success("Preset projet supprimé");
      loadProjectPresets();
    } catch (e) {
      toast.error("Erreur suppression");
    }
  };

  const duplicateProjectPreset = async (p: ProjectPresetRow) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const ranges = p.duration_ranges || convertLegacyToRanges(
        p.scene_duration_0to1 ?? 4,
        p.scene_duration_1to3 ?? 6,
        p.scene_duration_3plus ?? 8,
        p.range_end_1 ?? 60,
        p.range_end_2 ?? 180
      );
      const { error } = await supabase.from("presets").insert({
        user_id: user.id,
        name: `${p.name} (copie)`,
        scene_duration_0to1: p.scene_duration_0to1 ?? 4,
        scene_duration_1to3: p.scene_duration_1to3 ?? 6,
        scene_duration_3plus: p.scene_duration_3plus ?? 8,
        range_end_1: p.range_end_1 ?? 60,
        range_end_2: p.range_end_2 ?? 180,
        duration_ranges: ranges,
        example_prompts: p.example_prompts ?? [],
        image_width: p.image_width ?? 1920,
        image_height: p.image_height ?? 1080,
        aspect_ratio: p.aspect_ratio ?? "16:9",
        style_reference_url: p.style_reference_url,
        image_model: p.image_model ?? "seedream-4.5",
        prompt_system_message: p.prompt_system_message,
        lora_url: p.lora_url,
        lora_steps: p.lora_steps ?? 10,
        qa_prompt: p.qa_prompt,
      });
      if (error) throw error;
      toast.success("Preset projet dupliqué");
      loadProjectPresets();
    } catch (e) {
      toast.error("Erreur duplication");
    }
  };

  // Thumbnail CRUD
  const openThumbCreate = () => {
    setThumbEditId(null);
    setThumbName("");
    setThumbChannelHandle("");
    setThumbCharacterRef("");
    setThumbCustomPrompt("");
    setThumbSystemPrompt("");
    setThumbImageModel("seedream-4.5");
    setThumbDialogOpen(true);
  };

  const openThumbEdit = (p: ThumbnailPresetRow) => {
    setThumbEditId(p.id);
    setThumbName(p.name);
    setThumbChannelHandle(p.channel_handle || "");
    setThumbCharacterRef(p.character_ref_url || "");
    setThumbCustomPrompt(p.custom_prompt || "");
    setThumbSystemPrompt(p.system_prompt || "");
    setThumbImageModel(p.image_model || "seedream-4.5");
    setThumbDialogOpen(true);
  };

  const saveThumbPreset = async () => {
    if (!thumbName.trim()) {
      toast.error("Nom requis");
      return;
    }
    setThumbSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      const row = {
        name: thumbName.trim(),
        channel_handle: thumbChannelHandle.trim() || null,
        character_ref_url: thumbCharacterRef.trim() || null,
        custom_prompt: thumbCustomPrompt.trim() || null,
        system_prompt: thumbSystemPrompt.trim() || null,
        image_model: thumbImageModel,
      };
      if (thumbEditId) {
        const { error } = await supabase.from("thumbnail_presets").update(row).eq("id", thumbEditId);
        if (error) throw error;
        toast.success("Preset miniatures mis à jour");
      } else {
        const { error } = await supabase.from("thumbnail_presets").insert({ user_id: user.id, ...row });
        if (error) throw error;
        toast.success("Preset miniatures créé");
      }
      setThumbDialogOpen(false);
      loadThumbPresets();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erreur sauvegarde");
    } finally {
      setThumbSaving(false);
    }
  };

  const duplicateThumbPreset = async (p: ThumbnailPresetRow) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("thumbnail_presets").insert({
        user_id: user.id,
        name: `${p.name} (copie)`,
        channel_handle: p.channel_handle,
        character_ref_url: p.character_ref_url,
        custom_prompt: p.custom_prompt,
        system_prompt: p.system_prompt,
        image_model: p.image_model,
        example_urls: p.example_urls,
      });
      if (error) throw error;
      toast.success("Preset miniatures dupliqué");
      loadThumbPresets();
    } catch (e) {
      toast.error("Erreur duplication");
    }
  };

  const deleteThumbPreset = async (p: ThumbnailPresetRow) => {
    if (!confirm(`Supprimer le preset "${p.name}" ?`)) return;
    try {
      const { error } = await supabase.from("thumbnail_presets").delete().eq("id", p.id);
      if (error) throw error;
      toast.success("Preset supprimé");
      loadThumbPresets();
    } catch (e) {
      toast.error("Erreur suppression");
    }
  };

  // LoRA CRUD
  const openLoraCreate = () => {
    setLoraEditId(null);
    setLoraName("");
    setLoraUrl("");
    setLoraSteps(10);
    setLoraDialogOpen(true);
  };

  const openLoraEdit = (p: LoraPresetRow) => {
    setLoraEditId(p.id);
    setLoraName(p.name);
    setLoraUrl(p.lora_url);
    setLoraSteps(p.lora_steps ?? 10);
    setLoraDialogOpen(true);
  };

  const saveLoraPreset = async () => {
    if (!loraName.trim() || !loraUrl.trim()) {
      toast.error("Nom et URL requis");
      return;
    }
    setLoraSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      if (loraEditId) {
        const { error } = await supabase.from("lora_presets").update({
          name: loraName.trim(),
          lora_url: loraUrl.trim(),
          lora_steps: loraSteps,
        }).eq("id", loraEditId);
        if (error) throw error;
        toast.success("Preset LoRA mis à jour");
      } else {
        const { error } = await supabase.from("lora_presets").insert({
          user_id: user.id,
          name: loraName.trim(),
          lora_url: loraUrl.trim(),
          lora_steps: loraSteps,
        });
        if (error) throw error;
        toast.success("Preset LoRA créé");
      }
      setLoraDialogOpen(false);
      loadLoraPresets();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erreur sauvegarde");
    } finally {
      setLoraSaving(false);
    }
  };

  const duplicateLoraPreset = async (p: LoraPresetRow) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("lora_presets").insert({
        user_id: user.id,
        name: `${p.name} (copie)`,
        lora_url: p.lora_url,
        lora_steps: p.lora_steps,
      });
      if (error) throw error;
      toast.success("Preset LoRA dupliqué");
      loadLoraPresets();
    } catch (e) {
      toast.error("Erreur duplication");
    }
  };

  const deleteLoraPreset = async (p: LoraPresetRow) => {
    if (!confirm(`Supprimer le preset LoRA "${p.name}" ?`)) return;
    try {
      const { error } = await supabase.from("lora_presets").delete().eq("id", p.id);
      if (error) throw error;
      toast.success("Preset LoRA supprimé");
      loadLoraPresets();
    } catch (e) {
      toast.error("Erreur suppression");
    }
  };

  const defaultProjectConfig = {
    durationRanges: DEFAULT_DURATION_RANGES,
    examplePrompts: ["", "", ""],
    imageWidth: 1920,
    imageHeight: 1080,
    aspectRatio: "16:9",
    styleReferenceUrls: [] as string[],
    imageModel: "seedream-4.5",
    promptSystemMessage: "",
    loraUrl: "",
    loraSteps: 10,
    qaPrompt: "",
  };

  const renderList = <T,>(
    items: T[],
    loading: boolean,
    getName: (item: T) => string,
    getSub?: (item: T) => string,
    onEdit?: (item: T) => void,
    onDuplicate?: (item: T) => void,
    onDelete?: (item: T) => void
  ) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Aucun preset. Créez-en un avec le bouton ci-dessus.
        </p>
      );
    }
    return (
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={(item as any).id}>
            <Card className="p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{getName(item)}</p>
                {getSub && <p className="text-xs text-muted-foreground truncate">{getSub(item)}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {onEdit && (
                  <Button variant="ghost" size="icon" onClick={() => onEdit(item)} title="Modifier">
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {onDuplicate && (
                      <DropdownMenuItem onClick={() => onDuplicate(item)}>
                        <Copy className="h-4 w-4 mr-2" /> Dupliquer
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Supprimer
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="VideoFlow" />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 mb-6">
          <SlidersHorizontal className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Mes presets</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Gérez tous vos presets (script, TTS, projet, miniatures, LoRA, chemins d'export) en un seul endroit.
        </p>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 gap-1 mb-6">
            <TabsTrigger value="script" className="gap-1.5">
              <FileText className="h-4 w-4" /> Script
            </TabsTrigger>
            <TabsTrigger value="tts" className="gap-1.5">
              <Mic className="h-4 w-4" /> TTS
            </TabsTrigger>
            <TabsTrigger value="project" className="gap-1.5">
              <Image className="h-4 w-4" /> Projet
            </TabsTrigger>
            <TabsTrigger value="thumbnail" className="gap-1.5">
              <Image className="h-4 w-4" /> Miniatures
            </TabsTrigger>
            <TabsTrigger value="lora" className="gap-1.5">
              <Layers className="h-4 w-4" /> LoRA
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1.5">
              <FolderOpen className="h-4 w-4" /> Chemins
            </TabsTrigger>
          </TabsList>

          <TabsContent value="script" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openScriptCreate}>
                <Plus className="h-4 w-4 mr-2" /> Créer un preset
              </Button>
            </div>
            {renderList(
              scriptPresets,
              scriptLoading,
              (p) => p.name,
              (p) => (p.script_model ? `Modèle: ${p.script_model}` : undefined),
              openScriptEdit,
              duplicateScriptPreset,
              deleteScriptPreset
            )}
          </TabsContent>

          <TabsContent value="tts" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openTtsCreate}>
                <Plus className="h-4 w-4 mr-2" /> Créer un preset
              </Button>
            </div>
            {renderList(
              ttsPresets,
              ttsLoading,
              (p) => p.name,
              (p) => `${p.provider} · ${p.voice_id || "—"}`,
              openTtsEdit,
              duplicateTtsPreset,
              deleteTtsPreset
            )}
          </TabsContent>

          <TabsContent value="project" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => navigate("/project")} variant="outline">
                Créer depuis la page Projet
              </Button>
            </div>
            {renderList(
              projectPresets,
              projectLoading,
              (p) => p.name,
              (p) => (p.image_model ? `Modèle: ${p.image_model}` : undefined),
              (p) => openProjectEdit(p.id),
              duplicateProjectPreset,
              deleteProjectPreset
            )}
          </TabsContent>

          <TabsContent value="thumbnail" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openThumbCreate}>
                <Plus className="h-4 w-4 mr-2" /> Créer un preset
              </Button>
            </div>
            {renderList(
              thumbPresets,
              thumbLoading,
              (p) => p.name,
              (p) => (p.channel_handle ? `@${p.channel_handle}` : "v1"),
              openThumbEdit,
              duplicateThumbPreset,
              deleteThumbPreset
            )}
          </TabsContent>

          <TabsContent value="lora" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openLoraCreate}>
                <Plus className="h-4 w-4 mr-2" /> Créer un preset
              </Button>
            </div>
            {renderList(
              loraPresets,
              loraLoading,
              (p) => p.name,
              (p) => p.lora_url?.slice(0, 40) + (p.lora_url?.length > 40 ? "…" : ""),
              openLoraEdit,
              duplicateLoraPreset,
              deleteLoraPreset
            )}
          </TabsContent>

          <TabsContent value="export" className="space-y-4">
            <ExportPathPresetManager currentPath="" onPathChange={() => {}} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Script dialog */}
      <Dialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{scriptEditId ? "Modifier le preset script" : "Nouveau preset script"}</DialogTitle>
            <DialogDescription>Nom, prompt et modèle pour la génération de script.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Nom</Label>
              <Input value={scriptName} onChange={(e) => setScriptName(e.target.value)} placeholder="Mon preset script" />
            </div>
            <div>
              <Label>Prompt personnalisé</Label>
              <Textarea value={scriptPrompt} onChange={(e) => setScriptPrompt(e.target.value)} rows={5} className="resize-none" />
            </div>
            <div>
              <Label>Modèle</Label>
              <Select value={scriptModel} onValueChange={setScriptModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="glm5-openrouter">GLM-5 (OpenRouter)</SelectItem>
                  <SelectItem value="qwen3.5">Qwen 3.5 (OpenRouter)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="script-batch" checked={scriptUseBatch} onChange={(e) => setScriptUseBatch(e.target.checked)} />
              <Label htmlFor="script-batch">Utiliser le mode batch</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setScriptDialogOpen(false)}>Annuler</Button>
              <Button onClick={saveScriptPreset} disabled={scriptSaving}>
                {scriptSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* TTS dialog */}
      <Dialog open={ttsDialogOpen} onOpenChange={setTtsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{ttsEditId ? "Modifier le preset TTS" : "Nouveau preset TTS"}</DialogTitle>
            <DialogDescription>Provider, voix et paramètres. Pour une édition avancée, utilisez la page De zéro.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Nom</Label>
              <Input value={ttsName} onChange={(e) => setTtsName(e.target.value)} placeholder="Ma voix" />
            </div>
            <div>
              <Label>Provider</Label>
              <Select value={ttsProvider} onValueChange={setTtsProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimax">MiniMax</SelectItem>
                  <SelectItem value="inworld">Inworld</SelectItem>
                  <SelectItem value="genaipro">GenAI Pro</SelectItem>
                  <SelectItem value="ai33">AI33</SelectItem>
                  <SelectItem value="edgetts">Edge TTS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Voice ID</Label>
              <Input value={ttsVoiceId} onChange={(e) => setTtsVoiceId(e.target.value)} placeholder="ID de la voix" />
            </div>
            <div>
              <Label>Modèle (optionnel)</Label>
              <Input value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} placeholder="Modèle" />
            </div>
            <div>
              <Label>Vitesse</Label>
              <Input type="number" step={0.1} min={0.5} max={2} value={ttsSpeed} onChange={(e) => setTtsSpeed(parseFloat(e.target.value) || 1)} />
            </div>
            <div>
              <Label>Emotion / extras (JSON)</Label>
              <Textarea value={ttsEmotion} onChange={(e) => setTtsEmotion(e.target.value)} rows={3} className="font-mono text-xs resize-none" placeholder='{"style":0,"speakerBoost":false}' />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTtsDialogOpen(false)}>Annuler</Button>
              <Button onClick={saveTtsPreset} disabled={ttsSaving}>
                {ttsSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Thumbnail dialog */}
      <Dialog open={thumbDialogOpen} onOpenChange={setThumbDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{thumbEditId ? "Modifier le preset miniatures" : "Nouveau preset miniatures"}</DialogTitle>
            <DialogDescription>Nom, chaîne (v2), références et prompts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Nom</Label>
              <Input value={thumbName} onChange={(e) => setThumbName(e.target.value)} placeholder="Mes miniatures" />
            </div>
            <div>
              <Label>@ Chaîne YouTube (v2, optionnel)</Label>
              <Input value={thumbChannelHandle} onChange={(e) => setThumbChannelHandle(e.target.value)} placeholder="@machaine" />
            </div>
            <div>
              <Label>URL référence personnage</Label>
              <Input value={thumbCharacterRef} onChange={(e) => setThumbCharacterRef(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label>Prompt personnalisé</Label>
              <Textarea value={thumbCustomPrompt} onChange={(e) => setThumbCustomPrompt(e.target.value)} rows={2} className="resize-none" />
            </div>
            <div>
              <Label>System prompt (v2)</Label>
              <Textarea value={thumbSystemPrompt} onChange={(e) => setThumbSystemPrompt(e.target.value)} rows={2} className="resize-none" />
            </div>
            <div>
              <Label>Modèle d'image</Label>
              <Select value={thumbImageModel} onValueChange={setThumbImageModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seedream-4.5">SeedReam 4.5</SelectItem>
                  <SelectItem value="z-image-turbo">Z-Image Turbo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setThumbDialogOpen(false)}>Annuler</Button>
              <Button onClick={saveThumbPreset} disabled={thumbSaving}>
                {thumbSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* LoRA dialog */}
      <Dialog open={loraDialogOpen} onOpenChange={setLoraDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{loraEditId ? "Modifier le preset LoRA" : "Nouveau preset LoRA"}</DialogTitle>
            <DialogDescription>Nom et URL du modèle LoRA.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Nom</Label>
              <Input value={loraName} onChange={(e) => setLoraName(e.target.value)} placeholder="Mon LoRA" />
            </div>
            <div>
              <Label>URL LoRA</Label>
              <Input value={loraUrl} onChange={(e) => setLoraUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label>Steps</Label>
              <Input type="number" min={1} max={30} value={loraSteps} onChange={(e) => setLoraSteps(parseInt(e.target.value, 10) || 10)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLoraDialogOpen(false)}>Annuler</Button>
              <Button onClick={saveLoraPreset} disabled={loraSaving}>
                {loraSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Project preset edit: PresetManager opens its own edit dialog when presetIdToEdit is set */}
      {projectEditId && (
        <PresetManager
          key={projectPresetManagerKey}
          currentConfig={defaultProjectConfig}
          onLoadPreset={() => {}}
          presetIdToEdit={projectEditId}
          onEditDialogClose={closeProjectEdit}
        />
      )}
    </div>
  );
}
