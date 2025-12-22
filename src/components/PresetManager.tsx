import { useState, useEffect } from "react";
import { parseStyleReferenceUrls } from "@/lib/styleReferenceHelpers";
import { DurationRange, DEFAULT_DURATION_RANGES, convertLegacyToRanges } from "@/lib/durationRanges";
import { DurationRangesEditor } from "@/components/DurationRangesEditor";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Save, Trash2, Plus, Copy, Settings, FolderOpen, ChevronDown, Pencil, Upload, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

interface Preset {
  id: string;
  name: string;
  scene_duration_0to1: number;
  scene_duration_1to3: number;
  scene_duration_3plus: number;
  range_end_1: number;
  range_end_2: number;
  duration_ranges?: DurationRange[]; // New dynamic ranges format
  example_prompts: string[];
  image_width: number;
  image_height: number;
  aspect_ratio: string;
  style_reference_url: string | null;
  image_model: string;
  prompt_system_message: string | null;
  lora_url: string | null;
  lora_steps: number;
}

const DEFAULT_PROMPT_SYSTEM_MESSAGE = `You are an expert at generating prompts for AI image creation (like Midjourney, Stable Diffusion, DALL-E).

STRICT RULES FOR GENERATING CONSISTENT PROMPTS:
1. Follow EXACTLY the structure and style of the examples below
2. Use the same tone, vocabulary, and format
3. Respect the same approximate length (50-100 words)
4. Include the same types of elements: main subject, visual style, composition, lighting, mood
5. NEVER deviate from the format established by the examples
6. Generate prompts in ENGLISH only
7. NEVER use the word "dead" in the prompt (rephrase with other words instead)

CONTENT SAFETY - STRICTLY FORBIDDEN:
- No nudity, partial nudity, or suggestive/intimate content
- No violence, gore, blood, weapons pointed at people, or graphic injuries
- No sexual or romantic physical contact
- No drug use or drug paraphernalia
- No hate symbols, extremist imagery, or discriminatory content
- No realistic depictions of real public figures or celebrities
- Instead of violent scenes, describe tension through expressions, postures, and atmosphere
- Instead of intimate scenes, describe emotional connection through eye contact and gestures

Your role is to create ONE detailed visual prompt for a specific scene from a video/audio.

For this scene, you must:
1. Identify key visual elements from the text
2. Create a descriptive and detailed prompt
3. Include style, mood, composition, lighting
4. Optimize for high-quality image generation
5. Think about visual coherence with the global story context

Return ONLY the prompt text, no JSON, no title, just the optimized prompt in ENGLISH.`;

interface PresetManagerProps {
  currentConfig: {
    durationRanges: DurationRange[];
    examplePrompts: string[];
    imageWidth: number;
    imageHeight: number;
    aspectRatio: string;
    styleReferenceUrls: string[];
    imageModel: string;
    promptSystemMessage: string;
    loraUrl?: string;
    loraSteps?: number;
  };
  onLoadPreset: (preset: Preset) => void;
}

export const PresetManager = ({ currentConfig, onLoadPreset }: PresetManagerProps) => {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [duplicatePresetName, setDuplicatePresetName] = useState("");
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [editFormData, setEditFormData] = useState<{
    name: string;
    durationRanges: DurationRange[];
    examplePrompts: string[];
    imageWidth: number;
    imageHeight: number;
    aspectRatio: string;
    styleReferenceUrls: string[];
    imageModel: string;
    promptSystemMessage: string;
    loraUrl?: string;
    loraSteps?: number;
  } | null>(null);

  // LoRA presets
  const [loraPresets, setLoraPresets] = useState<LoraPreset[]>([]);
  const [selectedLoraPresetId, setSelectedLoraPresetId] = useState<string>("");
  const [loraPresetPopoverOpen, setLoraPresetPopoverOpen] = useState(false);
  const [saveLoraPresetDialogOpen, setSaveLoraPresetDialogOpen] = useState(false);
  const [newLoraPresetName, setNewLoraPresetName] = useState("");
  const [isSavingLoraPreset, setIsSavingLoraPreset] = useState(false);
  const [editLoraPresetDialogOpen, setEditLoraPresetDialogOpen] = useState(false);
  const [editingLoraPresetId, setEditingLoraPresetId] = useState<string | null>(null);
  const [editLoraPresetName, setEditLoraPresetName] = useState("");
  const [editLoraPresetUrl, setEditLoraPresetUrl] = useState("");
  const [editLoraPresetSteps, setEditLoraPresetSteps] = useState(10);
  const [isUpdatingLoraPreset, setIsUpdatingLoraPreset] = useState(false);
  const [duplicateLoraPresetDialogOpen, setDuplicateLoraPresetDialogOpen] = useState(false);
  const [duplicateLoraPresetName, setDuplicateLoraPresetName] = useState("");
  const [isDuplicatingLoraPreset, setIsDuplicatingLoraPreset] = useState(false);
  const [isUploadingStyleImage, setIsUploadingStyleImage] = useState(false);

  useEffect(() => {
    loadPresets();
    loadLoraPresets();
  }, []);

  const loadLoraPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("lora_presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      setLoraPresets(data || []);
    } catch (error) {
      console.error("Error loading LoRA presets:", error);
    }
  };

  const loadPresets = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      
      const mappedPresets: Preset[] = (data || []).map(preset => {
        const presetData = preset as any;
        // Load duration_ranges if available, otherwise convert from legacy
        let durationRanges: DurationRange[] | undefined;
        if (presetData.duration_ranges && Array.isArray(presetData.duration_ranges)) {
          durationRanges = presetData.duration_ranges;
        }
        
        return {
          id: preset.id,
          name: preset.name,
          scene_duration_0to1: preset.scene_duration_0to1 || 4,
          scene_duration_1to3: preset.scene_duration_1to3 || 6,
          scene_duration_3plus: preset.scene_duration_3plus || 8,
          range_end_1: presetData.range_end_1 || 60,
          range_end_2: presetData.range_end_2 || 180,
          duration_ranges: durationRanges,
          example_prompts: Array.isArray(preset.example_prompts) 
            ? preset.example_prompts.filter((p): p is string => typeof p === 'string')
            : [],
          image_width: preset.image_width,
          image_height: preset.image_height,
          aspect_ratio: preset.aspect_ratio,
          style_reference_url: preset.style_reference_url,
          image_model: presetData.image_model || 'seedream-4.5',
          prompt_system_message: presetData.prompt_system_message || null,
          lora_url: presetData.lora_url || null,
          lora_steps: presetData.lora_steps || 10,
        };
      });
      
      setPresets(mappedPresets);
    } catch (error: any) {
      console.error("Error loading presets:", error);
      toast.error("Erreur lors du chargement des presets");
    } finally {
      setIsLoading(false);
    }
  };

  const savePreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Convert durationRanges to legacy format for backward compatibility
      const ranges = currentConfig.durationRanges || [];
      const legacyRanges = {
        scene_duration_0to1: ranges[0]?.sceneDuration || 4,
        scene_duration_1to3: ranges[1]?.sceneDuration || 6,
        scene_duration_3plus: ranges.length > 0 ? (ranges[ranges.length - 1]?.sceneDuration || 8) : 8,
        range_end_1: ranges[0]?.endSeconds || 60,
        range_end_2: ranges[1]?.endSeconds || 180,
      };

      const { error } = await supabase.from("presets").insert([
        {
          user_id: user.id,
          name: newPresetName.trim(),
          ...legacyRanges,
          duration_ranges: ranges as any, // Store full ranges as JSON
          example_prompts: currentConfig.examplePrompts || [],
          image_width: currentConfig.imageWidth || 1920,
          image_height: currentConfig.imageHeight || 1080,
          aspect_ratio: currentConfig.aspectRatio || '16:9',
          image_model: currentConfig.imageModel || 'z-image-turbo',
          lora_url: currentConfig.loraUrl || null,
          lora_steps: currentConfig.loraSteps || 10,
          style_reference_url: JSON.stringify(currentConfig.styleReferenceUrls || []),
          prompt_system_message: currentConfig.promptSystemMessage || DEFAULT_PROMPT_SYSTEM_MESSAGE,
        },
      ]);

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setNewPresetName("");
      setIsDialogOpen(false);
      await loadPresets();
    } catch (error: any) {
      console.error("Error saving preset:", error);
      toast.error("Erreur lors de la sauvegarde du preset");
    } finally {
      setIsSaving(false);
    }
  };

  const deletePreset = async (id: string, name: string) => {
    if (!confirm(`Voulez-vous vraiment supprimer le preset "${name}" ?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("presets")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Preset supprimé");
      await loadPresets();
      if (selectedPresetId === id) {
        setSelectedPresetId("");
      }
    } catch (error: any) {
      console.error("Error deleting preset:", error);
      toast.error("Erreur lors de la suppression du preset");
    }
  };

  const handleLoadLoraPreset = (presetId: string) => {
    const preset = loraPresets.find(p => p.id === presetId);
    if (preset && editFormData) {
      setEditFormData({ ...editFormData, loraUrl: preset.lora_url, loraSteps: preset.lora_steps });
      setSelectedLoraPresetId(presetId);
      setLoraPresetPopoverOpen(false);
      toast.success(`Preset LoRA "${preset.name}" chargé !`);
    }
  };

  const handleOpenEditLoraPreset = (presetId: string) => {
    const preset = loraPresets.find(p => p.id === presetId);
    if (preset) {
      setEditingLoraPresetId(presetId);
      setEditLoraPresetName(preset.name);
      setEditLoraPresetUrl(preset.lora_url);
      setEditLoraPresetSteps(preset.lora_steps);
      setEditLoraPresetDialogOpen(true);
      setLoraPresetPopoverOpen(false);
    }
  };

  const handleUpdateLoraPreset = async () => {
    if (!editingLoraPresetId || !editLoraPresetName.trim() || !editLoraPresetUrl.trim()) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    setIsUpdatingLoraPreset(true);
    try {
      const { error } = await supabase
        .from("lora_presets")
        .update({
          name: editLoraPresetName.trim(),
          lora_url: editLoraPresetUrl.trim(),
          lora_steps: editLoraPresetSteps,
        })
        .eq("id", editingLoraPresetId);

      if (error) throw error;

      toast.success("Preset LoRA mis à jour !");
      setEditLoraPresetDialogOpen(false);
      setEditingLoraPresetId(null);
      await loadLoraPresets();
    } catch (error: any) {
      console.error("Error updating LoRA preset:", error);
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setIsUpdatingLoraPreset(false);
    }
  };

  const handleOpenDuplicateLoraPreset = (presetId: string) => {
    const preset = loraPresets.find(p => p.id === presetId);
    if (preset) {
      setEditingLoraPresetId(presetId);
      setDuplicateLoraPresetName(`${preset.name} (copie)`);
      setDuplicateLoraPresetDialogOpen(true);
      setLoraPresetPopoverOpen(false);
    }
  };

  const handleDuplicateLoraPreset = async () => {
    if (!editingLoraPresetId || !duplicateLoraPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    const preset = loraPresets.find(p => p.id === editingLoraPresetId);
    if (!preset) return;

    setIsDuplicatingLoraPreset(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const { error } = await supabase
        .from("lora_presets")
        .insert({
          user_id: user.id,
          name: duplicateLoraPresetName.trim(),
          lora_url: preset.lora_url,
          lora_steps: preset.lora_steps,
        });

      if (error) throw error;

      toast.success("Preset LoRA dupliqué !");
      setDuplicateLoraPresetDialogOpen(false);
      setEditingLoraPresetId(null);
      setDuplicateLoraPresetName("");
      await loadLoraPresets();
    } catch (error: any) {
      console.error("Error duplicating LoRA preset:", error);
      toast.error("Erreur lors de la duplication");
    } finally {
      setIsDuplicatingLoraPreset(false);
    }
  };

  const handleDeleteLoraPreset = async (presetId: string) => {
    const preset = loraPresets.find(p => p.id === presetId);
    if (!preset) return;

    if (!confirm(`Voulez-vous vraiment supprimer le preset LoRA "${preset.name}" ?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("lora_presets")
        .delete()
        .eq("id", presetId);

      if (error) throw error;

      toast.success("Preset LoRA supprimé !");
      if (selectedLoraPresetId === presetId) {
        setSelectedLoraPresetId("");
        if (editFormData) {
          setEditFormData({ ...editFormData, loraUrl: "", loraSteps: 10 });
        }
      }
      await loadLoraPresets();
    } catch (error: any) {
      console.error("Error deleting LoRA preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleSaveLoraPreset = async () => {
    if (!newLoraPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }
    if (!editFormData?.loraUrl?.trim()) {
      toast.error("Veuillez entrer une URL LoRA");
      return;
    }

    setIsSavingLoraPreset(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const { error } = await supabase
        .from("lora_presets")
        .insert({
          user_id: user.id,
          name: newLoraPresetName.trim(),
          lora_url: editFormData.loraUrl.trim(),
          lora_steps: editFormData.loraSteps || 10,
        });

      if (error) throw error;

      toast.success("Preset LoRA sauvegardé !");
      setNewLoraPresetName("");
      setSaveLoraPresetDialogOpen(false);
      await loadLoraPresets();
    } catch (error: any) {
      console.error("Error saving LoRA preset:", error);
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSavingLoraPreset(false);
    }
  };

  const handleLoadPreset = () => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (preset) {
      onLoadPreset(preset);
      toast.success(`Preset "${preset.name}" chargé !`);
    }
  };

  const handleUploadStyleImageForEdit = async (file: File) => {
    if (!editFormData) return;
    
    setIsUploadingStyleImage(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const fileName = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("style-references")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("style-references")
        .getPublicUrl(fileName);

      setEditFormData({ ...editFormData, styleReferenceUrls: [publicUrl] });
      toast.success("Image de référence uploadée !");
    } catch (error: any) {
      console.error("Error uploading style image:", error);
      toast.error("Erreur lors de l'upload de l'image");
    } finally {
      setIsUploadingStyleImage(false);
    }
  };

  const handleRemoveStyleImageForEdit = () => {
    if (!editFormData) return;
    setEditFormData({ ...editFormData, styleReferenceUrls: [] });
    toast.success("Image supprimée");
  };

  const handleUpdatePreset = async () => {
    if (!selectedPresetId || !editFormData) {
      toast.error("Aucun preset sélectionné");
      return;
    }

    setIsUpdating(true);
    try {
      // Convert durationRanges to legacy format for backward compatibility
      const ranges = editFormData.durationRanges;
      const legacyRanges = {
        scene_duration_0to1: ranges[0]?.sceneDuration || 4,
        scene_duration_1to3: ranges[1]?.sceneDuration || 6,
        scene_duration_3plus: ranges[ranges.length - 1]?.sceneDuration || 8,
        range_end_1: ranges[0]?.endSeconds || 60,
        range_end_2: ranges[1]?.endSeconds || 180,
      };

      const { error } = await supabase
        .from("presets")
        .update({
          name: editFormData.name,
          ...legacyRanges,
          duration_ranges: ranges as any, // Store full ranges as JSON
          example_prompts: editFormData.examplePrompts,
          image_width: editFormData.imageWidth,
          image_height: editFormData.imageHeight,
          aspect_ratio: editFormData.aspectRatio,
          image_model: editFormData.imageModel,
          lora_url: editFormData.loraUrl || null,
          lora_steps: editFormData.loraSteps || 10,
          style_reference_url: JSON.stringify(editFormData.styleReferenceUrls),
          prompt_system_message: editFormData.promptSystemMessage || null,
        })
        .eq("id", selectedPresetId);

      if (error) throw error;

      toast.success(`Preset "${editFormData.name}" mis à jour !`);
      setIsEditDialogOpen(false);
      await loadPresets();
    } catch (error: any) {
      console.error("Error updating preset:", error);
      toast.error("Erreur lors de la mise à jour du preset");
    } finally {
      setIsUpdating(false);
    }
  };

  const openEditDialogForPreset = (preset: Preset) => {
    // Use duration_ranges if available, otherwise convert from legacy
    const ranges = preset.duration_ranges || convertLegacyToRanges(
      preset.scene_duration_0to1,
      preset.scene_duration_1to3,
      preset.scene_duration_3plus,
      preset.range_end_1,
      preset.range_end_2
    );

    setEditFormData({
      name: preset.name,
      durationRanges: ranges,
      examplePrompts: preset.example_prompts,
      imageWidth: preset.image_width,
      imageHeight: preset.image_height,
      aspectRatio: preset.aspect_ratio,
      styleReferenceUrls: parseStyleReferenceUrls(preset.style_reference_url),
      imageModel: preset.image_model,
      promptSystemMessage: preset.prompt_system_message || DEFAULT_PROMPT_SYSTEM_MESSAGE,
      loraUrl: preset.lora_url || "",
      loraSteps: preset.lora_steps || 10,
    });
    setIsEditDialogOpen(true);
  };

  const openDuplicateDialogForPreset = (preset: Preset) => {
    setDuplicatePresetName(`${preset.name} (copie)`);
    setIsDuplicateDialogOpen(true);
  };

  const handleDuplicatePreset = async () => {
    if (!selectedPresetId || !duplicatePresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le nouveau preset");
      return;
    }

    const sourcePreset = presets.find(p => p.id === selectedPresetId);
    if (!sourcePreset) return;

    setIsDuplicating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase.from("presets").insert([
        {
          user_id: user.id,
          name: duplicatePresetName.trim(),
          scene_duration_0to1: sourcePreset.scene_duration_0to1,
          scene_duration_1to3: sourcePreset.scene_duration_1to3,
          scene_duration_3plus: sourcePreset.scene_duration_3plus,
          range_end_1: sourcePreset.range_end_1,
          range_end_2: sourcePreset.range_end_2,
          example_prompts: sourcePreset.example_prompts,
          image_width: sourcePreset.image_width,
          image_height: sourcePreset.image_height,
          aspect_ratio: sourcePreset.aspect_ratio,
          image_model: sourcePreset.image_model,
          lora_url: sourcePreset.lora_url,
          lora_steps: sourcePreset.lora_steps,
          style_reference_url: sourcePreset.style_reference_url,
          prompt_system_message: sourcePreset.prompt_system_message,
        },
      ]);

      if (error) throw error;

      toast.success(`Preset "${duplicatePresetName}" créé !`);
      setDuplicatePresetName("");
      setIsDuplicateDialogOpen(false);
      await loadPresets();
    } catch (error: any) {
      console.error("Error duplicating preset:", error);
      toast.error("Erreur lors de la duplication du preset");
    } finally {
      setIsDuplicating(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Presets de configuration</h3>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Sauvegarder la configuration actuelle</DialogTitle>
                <DialogDescription>
                  Créez un preset avec les paramètres actuels pour les réutiliser plus tard
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="preset-name">Nom du preset</Label>
                  <Input
                    id="preset-name"
                    placeholder="Ex: Configuration standard"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button onClick={savePreset} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sauvegarde...
                      </>
                    ) : (
                      "Sauvegarder"
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : presets.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Aucun preset sauvegardé
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select value={selectedPresetId} onValueChange={setSelectedPresetId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Sélectionner un preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem 
                      key={preset.id} 
                      value={preset.id}
                      className="pr-2 [&:hover_.preset-actions]:opacity-100 [&[data-highlighted]_.preset-actions]:opacity-100"
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="truncate flex-1 min-w-0">{preset.name}</span>
                        <div className="preset-actions flex gap-1 opacity-0 transition-opacity shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPresetId(preset.id);
                              openEditDialogForPreset(preset);
                            }}
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPresetId(preset.id);
                              openDuplicateDialogForPreset(preset);
                            }}
                            title="Dupliquer"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePreset(preset.id, preset.name);
                            }}
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleLoadPreset}
                disabled={!selectedPresetId}
              >
                Charger
              </Button>
              {selectedPresetId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-3"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        const preset = presets.find(p => p.id === selectedPresetId);
                        if (preset) {
                          openEditDialogForPreset(preset);
                        }
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        const preset = presets.find(p => p.id === selectedPresetId);
                        if (preset) {
                          openDuplicateDialogForPreset(preset);
                        }
                      }}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Dupliquer
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        const preset = presets.find(p => p.id === selectedPresetId);
                        if (preset) {
                          deletePreset(preset.id, preset.name);
                        }
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        )}

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] w-[95vw] sm:w-full flex flex-col p-6">
            <div className="overflow-y-auto flex-1 min-h-0">
            <DialogHeader className="border-b pb-4">
              <DialogTitle className="text-xl">Modifier le preset</DialogTitle>
              <DialogDescription>
                Modifiez les paramètres du preset "{editFormData?.name}"
              </DialogDescription>
            </DialogHeader>
            {editFormData && (
              <div className="space-y-8 py-4">
                {/* Nom du preset */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Informations générales</h3>
                  </div>
                  <div>
                    <Label htmlFor="edit-preset-name" className="text-sm font-medium">
                      Nom du preset
                    </Label>
                    <Input
                      id="edit-preset-name"
                      value={editFormData.name}
                      onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                {/* Durées de scène */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Durées de scène</h3>
                  </div>
                  <div className="p-4 border rounded-lg bg-muted/30">
                    <DurationRangesEditor
                      ranges={editFormData.durationRanges}
                      onChange={(ranges) => setEditFormData({ ...editFormData, durationRanges: ranges })}
                      maxEndValue={600}
                    />
                  </div>
                </div>

                {/* Exemples de prompts */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Exemples de prompts</h3>
                  </div>
                  <div className="space-y-4">
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="space-y-1.5">
                        <Label htmlFor={`edit-prompt-${index}`} className="text-sm">
                          Exemple {index + 1}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {index === 0 ? "(recommandé)" : "(optionnel)"}
                          </span>
                        </Label>
                        <Textarea
                          id={`edit-prompt-${index}`}
                          placeholder={`Ex: "A cinematic scene showing..."`}
                          value={editFormData.examplePrompts[index] || ""}
                          onChange={(e) => {
                            const newPrompts = [...editFormData.examplePrompts];
                            newPrompts[index] = e.target.value;
                            setEditFormData({ ...editFormData, examplePrompts: newPrompts });
                          }}
                          rows={3}
                          className="resize-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dimensions d'image */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Dimensions d'image</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-aspect-ratio" className="text-sm">
                        Ratio
                      </Label>
                      <Select 
                        value={editFormData.aspectRatio} 
                        onValueChange={(value) => {
                          setEditFormData({ ...editFormData, aspectRatio: value });
                          if (value === "16:9") {
                            setEditFormData({ ...editFormData, aspectRatio: value, imageWidth: 1920, imageHeight: 1080 });
                          } else if (value === "9:16") {
                            setEditFormData({ ...editFormData, aspectRatio: value, imageWidth: 1080, imageHeight: 1920 });
                          }
                        }}
                      >
                        <SelectTrigger id="edit-aspect-ratio">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16:9">16:9 (Paysage)</SelectItem>
                          <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                          <SelectItem value="custom">Personnalisé</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-width" className="text-sm">
                        Largeur
                      </Label>
                      <div className="relative">
                        <Input
                          id="edit-width"
                          type="number"
                          min="512"
                          max="2048"
                          value={editFormData.imageWidth}
                          onChange={(e) => setEditFormData({ ...editFormData, imageWidth: parseInt(e.target.value) })}
                          className="pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          px
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-height" className="text-sm">
                        Hauteur
                      </Label>
                      <div className="relative">
                        <Input
                          id="edit-height"
                          type="number"
                          min="512"
                          max="2048"
                          value={editFormData.imageHeight}
                          onChange={(e) => setEditFormData({ ...editFormData, imageHeight: parseInt(e.target.value) })}
                          className="pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          px
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Modèle de génération */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Modèle de génération</h3>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-image-model" className="text-sm">
                      Modèle
                    </Label>
                    <Select 
                      value={editFormData.imageModel} 
                      onValueChange={(value) => {
                        // Adjust dimensions based on model
                        if (value === 'z-image-turbo' || value === 'z-image-turbo-lora') {
                          // Use z-image-turbo standard resolutions
                          switch (editFormData.aspectRatio) {
                            case "16:9":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 960, imageHeight: 544 });
                              break;
                            case "9:16":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 720, imageHeight: 1280 });
                              break;
                            case "1:1":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 1024, imageHeight: 1024 });
                              break;
                            case "4:3":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 1280, imageHeight: 960 });
                              break;
                            default:
                              setEditFormData({ ...editFormData, imageModel: value });
                          }
                        } else {
                          // Use HD resolutions for SeedDream
                          switch (editFormData.aspectRatio) {
                            case "16:9":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 1920, imageHeight: 1080 });
                              break;
                            case "9:16":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 1080, imageHeight: 1920 });
                              break;
                            case "1:1":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 1024, imageHeight: 1024 });
                              break;
                            case "4:3":
                              setEditFormData({ ...editFormData, imageModel: value, imageWidth: 1440, imageHeight: 1080 });
                              break;
                            default:
                              setEditFormData({ ...editFormData, imageModel: value });
                          }
                        }
                      }}
                    >
                      <SelectTrigger id="edit-image-model">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seedream-4.0">SeedDream 4.0</SelectItem>
                        <SelectItem value="seedream-4.5">SeedDream 4.5</SelectItem>
                        <SelectItem value="z-image-turbo">Z-Image Turbo (rapide)</SelectItem>
                        <SelectItem value="z-image-turbo-lora">Z-Image Turbo LoRA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* LoRA configuration - only show for z-image-turbo-lora */}
                  {editFormData.imageModel === "z-image-turbo-lora" && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/30 mt-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">Configuration LoRA</h4>
                      </div>
                      
                      {/* Load LoRA preset */}
                      <div className="space-y-2">
                        <Label className="text-xs">Presets LoRA</Label>
                        <div className="flex gap-2">
                          <Popover open={loraPresetPopoverOpen} onOpenChange={setLoraPresetPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="flex-1 justify-between">
                                <span className="flex items-center gap-2">
                                  <FolderOpen className="h-4 w-4" />
                                  {selectedLoraPresetId 
                                    ? loraPresets.find(p => p.id === selectedLoraPresetId)?.name || "Sélectionner..."
                                    : "Sélectionner un preset..."}
                                </span>
                                <ChevronDown className="h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-lg overflow-hidden" align="start">
                              {loraPresets.length === 0 ? (
                                <div className="p-4 text-center text-muted-foreground text-sm">
                                  Aucun preset LoRA sauvegardé
                                </div>
                              ) : (
                                <div className="max-h-[300px] overflow-auto">
                                  {loraPresets.map((preset) => (
                                    <div 
                                      key={preset.id}
                                      className={`flex items-center justify-between px-3 py-2 hover:bg-accent cursor-pointer group ${
                                        selectedLoraPresetId === preset.id ? "bg-accent" : ""
                                      }`}
                                    >
                                      <span 
                                        className="flex-1 truncate"
                                        onClick={() => handleLoadLoraPreset(preset.id)}
                                      >
                                        {preset.name}
                                      </span>
                                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button 
                                          variant="ghost" 
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenEditLoraPreset(preset.id);
                                          }}
                                          title="Modifier"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button 
                                          variant="ghost" 
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenDuplicateLoraPreset(preset.id);
                                          }}
                                          title="Dupliquer"
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button 
                                          variant="ghost" 
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteLoraPreset(preset.id);
                                          }}
                                          title="Supprimer"
                                        >
                                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
                            onClick={() => {
                              if (editFormData.loraUrl?.trim() && editFormData.loraSteps) {
                                setNewLoraPresetName("");
                                setSaveLoraPresetDialogOpen(true);
                              } else {
                                toast.error("Veuillez d'abord configurer l'URL et les steps");
                              }
                            }}
                            disabled={!editFormData.loraUrl?.trim()}
                          >
                            <Save className="h-4 w-4 mr-2" />
                            Sauvegarder
                          </Button>
                        </div>
                        {selectedLoraPresetId && (
                          <div className="mt-2 p-2 bg-primary/10 border border-primary/30 rounded-md">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-muted-foreground">Preset actif :</span>
                              <span className="font-medium text-primary">
                                {loraPresets.find(p => p.id === selectedLoraPresetId)?.name}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="edit-lora-url" className="text-sm">
                          URL du LoRA (HuggingFace .safetensors)
                        </Label>
                        <Input
                          id="edit-lora-url"
                          value={editFormData.loraUrl || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, loraUrl: e.target.value })}
                          placeholder="https://huggingface.co/.../resolve/main/model.safetensors"
                          className="break-all"
                        />
                        <p className="text-xs text-muted-foreground">
                          URL publique vers votre fichier .safetensors sur HuggingFace
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-lora-steps" className="text-sm">
                          Nombre de steps
                        </Label>
                        <Input
                          id="edit-lora-steps"
                          type="number"
                          min={4}
                          max={50}
                          value={editFormData.loraSteps || 10}
                          onChange={(e) => setEditFormData({ ...editFormData, loraSteps: parseInt(e.target.value) || 10 })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Plus de steps = meilleure qualité mais plus lent (recommandé: 10)
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Image de référence */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Image de référence de style</h3>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-style-ref" className="text-sm">
                        URL de l'image
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="edit-style-ref"
                          placeholder="https://..."
                          value={editFormData.styleReferenceUrls[0] || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, styleReferenceUrls: e.target.value ? [e.target.value] : [] })}
                          className="flex-1"
                        />
                        {editFormData.styleReferenceUrls.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleRemoveStyleImageForEdit}
                            title="Supprimer l'image"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs text-center text-muted-foreground">ou</div>
                      <div className="flex gap-2">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleUploadStyleImageForEdit(file);
                            }
                          }}
                          disabled={isUploadingStyleImage}
                          className="flex-1"
                          id="edit-style-upload"
                        />
                        {isUploadingStyleImage && (
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        )}
                      </div>
                    </div>
                    {editFormData.styleReferenceUrls.length > 0 && (
                      <div className="rounded-lg border bg-muted/30 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">Aperçu ({editFormData.styleReferenceUrls.length} image{editFormData.styleReferenceUrls.length > 1 ? 's' : ''}):</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleRemoveStyleImageForEdit}
                            className="h-6 px-2 text-xs"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Supprimer
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {editFormData.styleReferenceUrls.map((url, index) => (
                            <div key={index} className="relative group">
                              <img 
                                src={url} 
                                alt={`Style de référence ${index + 1}`} 
                                className="w-full h-24 object-cover rounded shadow-sm"
                                onError={(e) => {
                                  e.currentTarget.src = "";
                                  e.currentTarget.alt = "Image non disponible";
                                }}
                              />
                              <button
                                type="button"
                                onClick={handleRemoveStyleImageForEdit}
                                className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Supprimer"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Prompt système */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary" />
                    <h3 className="text-base font-semibold">Prompt système</h3>
                  </div>
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Entrez votre prompt système personnalisé..."
                      value={editFormData.promptSystemMessage}
                      onChange={(e) => setEditFormData({ ...editFormData, promptSystemMessage: e.target.value })}
                      rows={8}
                      className="resize-none font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditFormData({ ...editFormData, promptSystemMessage: DEFAULT_PROMPT_SYSTEM_MESSAGE })}
                      >
                        Charger prompt par défaut
                      </Button>
                      {editFormData.promptSystemMessage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditFormData({ ...editFormData, promptSystemMessage: "" })}
                        >
                          Effacer
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-6 border-t">
                  <Button
                    variant="outline"
                    onClick={() => setIsEditDialogOpen(false)}
                    className="min-w-24"
                  >
                    Annuler
                  </Button>
                  <Button 
                    onClick={handleUpdatePreset} 
                    disabled={isUpdating}
                    className="min-w-32"
                  >
                    {isUpdating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Mise à jour...
                      </>
                    ) : (
                      "Mettre à jour"
                    )}
                  </Button>
                </div>
              </div>
            )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isDuplicateDialogOpen} onOpenChange={setIsDuplicateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dupliquer le preset</DialogTitle>
              <DialogDescription>
                Créer une copie de "{presets.find(p => p.id === selectedPresetId)?.name}"
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="duplicate-preset-name">Nom du nouveau preset</Label>
                <Input
                  id="duplicate-preset-name"
                  placeholder="Ex: Mon nouveau preset"
                  value={duplicatePresetName}
                  onChange={(e) => setDuplicatePresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isDuplicating) {
                      handleDuplicatePreset();
                    }
                  }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsDuplicateDialogOpen(false)}
                >
                  Annuler
                </Button>
                <Button onClick={handleDuplicatePreset} disabled={isDuplicating}>
                  {isDuplicating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Duplication...
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Dupliquer
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Save LoRA Preset Dialog */}
        <Dialog open={saveLoraPresetDialogOpen} onOpenChange={setSaveLoraPresetDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Sauvegarder le preset LoRA</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="lora-preset-name">Nom du preset</Label>
                <Input
                  id="lora-preset-name"
                  placeholder="Ex: Mon LoRA personnalisé"
                  value={newLoraPresetName}
                  onChange={(e) => setNewLoraPresetName(e.target.value)}
                />
              </div>
              {editFormData && (
                <div className="p-4 bg-muted rounded-lg text-sm">
                  <p className="font-medium mb-2">Configuration actuelle :</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="break-words">
                      <span className="font-medium">URL :</span>{" "}
                      <span className="break-all">{editFormData.loraUrl || "Non définie"}</span>
                    </li>
                    <li>
                      <span className="font-medium">Steps :</span> {editFormData.loraSteps || 10}
                    </li>
                  </ul>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveLoraPresetDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSaveLoraPreset} disabled={isSavingLoraPreset || !newLoraPresetName.trim() || !editFormData?.loraUrl?.trim()}>
                {isSavingLoraPreset ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sauvegarde...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Sauvegarder
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit LoRA Preset Dialog */}
        <Dialog open={editLoraPresetDialogOpen} onOpenChange={setEditLoraPresetDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Modifier le preset LoRA</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-lora-preset-name">Nom du preset</Label>
                <Input
                  id="edit-lora-preset-name"
                  placeholder="Ex: Mon LoRA personnalisé"
                  value={editLoraPresetName}
                  onChange={(e) => setEditLoraPresetName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-lora-preset-url">URL du LoRA</Label>
                <Input
                  id="edit-lora-preset-url"
                  placeholder="https://huggingface.co/.../resolve/main/model.safetensors"
                  value={editLoraPresetUrl}
                  onChange={(e) => setEditLoraPresetUrl(e.target.value)}
                  className="break-all"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-lora-preset-steps">Nombre de steps</Label>
                <Input
                  id="edit-lora-preset-steps"
                  type="number"
                  min={4}
                  max={50}
                  value={editLoraPresetSteps}
                  onChange={(e) => setEditLoraPresetSteps(parseInt(e.target.value) || 10)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditLoraPresetDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleUpdateLoraPreset} disabled={isUpdatingLoraPreset || !editLoraPresetName.trim() || !editLoraPresetUrl.trim()}>
                {isUpdatingLoraPreset ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Mise à jour...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Enregistrer
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Duplicate LoRA Preset Dialog */}
        <Dialog open={duplicateLoraPresetDialogOpen} onOpenChange={setDuplicateLoraPresetDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Dupliquer le preset LoRA</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="duplicate-lora-preset-name">Nom du nouveau preset</Label>
                <Input
                  id="duplicate-lora-preset-name"
                  placeholder="Ex: Mon LoRA personnalisé (copie)"
                  value={duplicateLoraPresetName}
                  onChange={(e) => setDuplicateLoraPresetName(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDuplicateLoraPresetDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleDuplicateLoraPreset} disabled={isDuplicatingLoraPreset || !duplicateLoraPresetName.trim()}>
                {isDuplicatingLoraPreset ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Duplication...
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Dupliquer
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
};
