import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Upload, Download, Save, Trash2, Pencil, Copy, FolderOpen, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseStyleReferenceUrls } from "@/lib/styleReferenceHelpers";
import { DurationRange, DEFAULT_DURATION_RANGES, SHORT_FORM_DURATION_RANGES } from "@/lib/durationRanges";
import { DurationRangesEditor } from "@/components/DurationRangesEditor";

interface LoraPreset {
  id: string;
  name: string;
  lora_url: string;
  lora_steps: number;
}

interface Preset {
  id: string;
  name: string;
  scene_duration_0to1: number;
  scene_duration_1to3: number;
  scene_duration_3plus: number;
  range_end_1: number;
  range_end_2: number;
  duration_ranges?: DurationRange[];
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

interface ProjectConfigurationModalProps {
  transcriptData: any;
  currentProjectId: string;
  onComplete: (semiAutoMode: boolean) => void;
  onCancel: () => void;
}

export const ProjectConfigurationModal = ({
  transcriptData,
  currentProjectId,
  onComplete,
  onCancel,
}: ProjectConfigurationModalProps) => {
  const [step, setStep] = useState<"review" | "scene-config" | "prompt-config" | "image-config">("review");
  const [durationRanges, setDurationRanges] = useState<DurationRange[]>(DEFAULT_DURATION_RANGES);
  const [sceneFormat, setSceneFormat] = useState<"long" | "short">("long");
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [imageWidth, setImageWidth] = useState(1920);
  const [imageHeight, setImageHeight] = useState(1080);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageModel, setImageModel] = useState("seedream-4.5");
  const [styleReferenceUrls, setStyleReferenceUrls] = useState<string[]>([]);
  const [loraUrl, setLoraUrl] = useState("");
  const [loraSteps, setLoraSteps] = useState(10);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [semiAutoMode, setSemiAutoMode] = useState(false);
  
  // Preset loading
  const [presets, setPresets] = useState<Preset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  
  // Thumbnail preset for semi-auto mode
  const [thumbnailPresets, setThumbnailPresets] = useState<any[]>([]);
  const [selectedThumbnailPresetId, setSelectedThumbnailPresetId] = useState<string>("");
  
  // LoRA presets
  const [loraPresets, setLoraPresets] = useState<LoraPreset[]>([]);
  const [selectedLoraPresetId, setSelectedLoraPresetId] = useState<string>("");
  const [newLoraPresetName, setNewLoraPresetName] = useState("");
  const [isSavingLoraPreset, setIsSavingLoraPreset] = useState(false);
  const [loraPresetPopoverOpen, setLoraPresetPopoverOpen] = useState(false);
  const [saveLoraPresetDialogOpen, setSaveLoraPresetDialogOpen] = useState(false);
  const [editLoraPresetDialogOpen, setEditLoraPresetDialogOpen] = useState(false);
  const [editingLoraPresetId, setEditingLoraPresetId] = useState<string | null>(null);
  const [editLoraPresetName, setEditLoraPresetName] = useState("");
  const [editLoraPresetUrl, setEditLoraPresetUrl] = useState("");
  const [editLoraPresetSteps, setEditLoraPresetSteps] = useState(10);
  const [isUpdatingLoraPreset, setIsUpdatingLoraPreset] = useState(false);
  const [duplicateLoraPresetDialogOpen, setDuplicateLoraPresetDialogOpen] = useState(false);
  const [duplicateLoraPresetName, setDuplicateLoraPresetName] = useState("");
  const [isDuplicatingLoraPreset, setIsDuplicatingLoraPreset] = useState(false);

  // Load presets on mount
  useEffect(() => {
    loadPresets();
    loadLoraPresets();
    loadThumbnailPresets();
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

  const loadThumbnailPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("thumbnail_presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      setThumbnailPresets(data || []);
    } catch (error) {
      console.error("Error loading thumbnail presets:", error);
    }
  };

  const loadPresets = async () => {
    setIsLoadingPresets(true);
    try {
      const { data, error } = await supabase
        .from("presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      
      const mappedPresets: Preset[] = (data || []).map(preset => {
        // Parse duration_ranges from database or create from legacy format
        let parsedRanges: DurationRange[] | undefined;
        const presetData = preset as any;
        if (presetData.duration_ranges) {
          parsedRanges = presetData.duration_ranges as DurationRange[];
        }
        
        return {
          id: preset.id,
          name: preset.name,
          scene_duration_0to1: preset.scene_duration_0to1 || 4,
          scene_duration_1to3: preset.scene_duration_1to3 || 6,
          scene_duration_3plus: preset.scene_duration_3plus || 8,
          range_end_1: presetData.range_end_1 || 60,
          range_end_2: presetData.range_end_2 || 180,
          duration_ranges: parsedRanges,
          example_prompts: Array.isArray(preset.example_prompts) 
            ? preset.example_prompts.filter((p): p is string => typeof p === 'string')
            : [],
          image_width: preset.image_width || 1920,
          image_height: preset.image_height || 1080,
          aspect_ratio: preset.aspect_ratio || "16:9",
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
    } finally {
      setIsLoadingPresets(false);
    }
  };

  const handleLoadPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      // Use duration_ranges if available, otherwise build from legacy format
      if (preset.duration_ranges && preset.duration_ranges.length > 0) {
        setDurationRanges(preset.duration_ranges);
      } else {
        setDurationRanges([
          { endSeconds: preset.range_end_1, sceneDuration: preset.scene_duration_0to1 },
          { endSeconds: preset.range_end_2, sceneDuration: preset.scene_duration_1to3 },
          { endSeconds: null, sceneDuration: preset.scene_duration_3plus },
        ]);
      }
      setExamplePrompts(preset.example_prompts.length > 0 ? preset.example_prompts : ["", "", ""]);
      setImageWidth(preset.image_width);
      setImageHeight(preset.image_height);
      setAspectRatio(preset.aspect_ratio);
      setImageModel(preset.image_model);
      setLoraUrl(preset.lora_url || "");
      setLoraSteps(preset.lora_steps || 10);
      if (preset.style_reference_url) {
        setStyleReferenceUrls(parseStyleReferenceUrls(preset.style_reference_url));
      }
      setSelectedPresetId(presetId);
      toast.success(`Preset "${preset.name}" chargé !`);
    }
  };

  const handleLoadLoraPreset = (presetId: string) => {
    const preset = loraPresets.find(p => p.id === presetId);
    if (preset) {
      setLoraUrl(preset.lora_url);
      setLoraSteps(preset.lora_steps);
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
      
      // Reload current values if this preset is selected
      if (selectedLoraPresetId === editingLoraPresetId) {
        setLoraUrl(editLoraPresetUrl);
        setLoraSteps(editLoraPresetSteps);
      }
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

  const handleSaveLoraPreset = async () => {
    if (!newLoraPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }
    if (!loraUrl.trim()) {
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
          lora_url: loraUrl.trim(),
          lora_steps: loraSteps,
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
        setLoraUrl("");
        setLoraSteps(10);
      }
      await loadLoraPresets();
    } catch (error: any) {
      console.error("Error deleting LoRA preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleStyleImageUpload = async (files: FileList) => {
    if (styleReferenceUrls.length >= 15) {
      toast.error("Vous ne pouvez pas uploader plus de 15 images");
      return;
    }

    const filesToUpload = Array.from(files).slice(0, 15 - styleReferenceUrls.length);
    setIsUploading(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const uploadPromises = filesToUpload.map(async (file) => {
        const fileName = `${user.id}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("style-references")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("style-references")
          .getPublicUrl(fileName);

        return publicUrl;
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      setStyleReferenceUrls([...styleReferenceUrls, ...uploadedUrls]);
      toast.success(`${uploadedUrls.length} image(s) de référence uploadée(s) !`);
    } catch (error: any) {
      console.error("Error uploading style images:", error);
      toast.error("Erreur lors de l'upload des images");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveStyleImage = (indexToRemove: number) => {
    setStyleReferenceUrls(styleReferenceUrls.filter((_, index) => index !== indexToRemove));
    toast.success("Image supprimée");
  };

  const handleAspectRatioChange = (value: string) => {
    setAspectRatio(value);
    // Use lower resolutions for z-image-turbo and z-image-turbo-lora (max 1440px)
    const isZImageTurbo = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const ratios: Record<string, [number, number]> = {
      "16:9": isZImageTurbo ? [1280, 720] : [1920, 1080],
      "9:16": isZImageTurbo ? [720, 1280] : [1080, 1920],
      "1:1": [1024, 1024],
      "4:3": isZImageTurbo ? [1280, 960] : [1440, 1080],
    };
    if (ratios[value]) {
      const [w, h] = ratios[value];
      setImageWidth(w);
      setImageHeight(h);
    }
  };

  const handleModelChange = (model: string) => {
    setImageModel(model);
    // Adapt dimensions when switching to z-image-turbo or z-image-turbo-lora
    // Z-Image Turbo cannot generate in 1080p, so use lower resolutions
    if (model === 'z-image-turbo' || model === 'z-image-turbo-lora') {
      // Always use standard z-image-turbo resolutions based on aspect ratio
      switch (aspectRatio) {
        case "16:9":
          setImageWidth(1280);
          setImageHeight(720);
          break;
        case "9:16":
          setImageWidth(720);
          setImageHeight(1280);
          break;
        case "1:1":
          setImageWidth(1024);
          setImageHeight(1024);
          break;
        case "4:3":
          setImageWidth(1280);
          setImageHeight(960);
          break;
      }
      toast.info("Dimensions ajustées pour Z-Image Turbo (max 720p)");
    } else if (model === 'seedream-4.0' || model === 'seedream-4.5') {
      // SeedDream can handle HD, restore HD resolutions based on aspect ratio
      switch (aspectRatio) {
        case "16:9":
          setImageWidth(1920);
          setImageHeight(1080);
          break;
        case "9:16":
          setImageWidth(1080);
          setImageHeight(1920);
          break;
        case "1:1":
          setImageWidth(1024);
          setImageHeight(1024);
          break;
        case "4:3":
          setImageWidth(1440);
          setImageHeight(1080);
          break;
      }
    }
  };

  const handleFinalizeConfiguration = async () => {
    setIsSaving(true);
    try {
      // Extract legacy format from durationRanges for backward compatibility
      const legacyRanges = durationRanges.slice(0, 3);
      const range1End = legacyRanges[0]?.endSeconds || 60;
      const range2End = legacyRanges[1]?.endSeconds || 180;
      
      const { error } = await supabase
        .from("projects")
        .update({
          duration_ranges: durationRanges as any,
          // Legacy columns for backward compatibility
          scene_duration_0to1: legacyRanges[0]?.sceneDuration || 4,
          scene_duration_1to3: legacyRanges[1]?.sceneDuration || 6,
          scene_duration_3plus: legacyRanges[2]?.sceneDuration || 8,
          range_end_1: range1End,
          range_end_2: range2End,
          example_prompts: examplePrompts,
          image_width: imageWidth,
          image_height: imageHeight,
          aspect_ratio: aspectRatio,
          image_model: imageModel,
          lora_url: loraUrl || null,
          lora_steps: loraSteps,
          style_reference_url: styleReferenceUrls.length > 0 ? JSON.stringify(styleReferenceUrls) : null,
          thumbnail_preset_id: selectedThumbnailPresetId || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;

      toast.success("Configuration enregistrée !");
      onComplete(semiAutoMode);
    } catch (error: any) {
      console.error("Error saving configuration:", error);
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setIsSaving(false);
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case "review": return "Transcription terminée";
      case "scene-config": return "Configuration des scènes";
      case "prompt-config": return "Configuration des prompts";
      case "image-config": return "Configuration des images";
    }
  };

  const getStepDescription = () => {
    switch (step) {
      case "review": return "Vérifiez la transcription avant de continuer";
      case "scene-config": return "Définissez les durées de scènes selon le contenu";
      case "prompt-config": return "Ajoutez 2-3 exemples de prompts pour guider l'IA";
      case "image-config": return "Configurez les dimensions et le style des images";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{getStepTitle()}</h2>
        <p className="text-sm text-muted-foreground">{getStepDescription()}</p>
      </div>

      {step === "review" && (
        <div className="space-y-4">
          {/* Preset selector */}
          <div className="rounded-lg border p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2 mb-3">
              <Download className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Charger un preset (optionnel)</h3>
            </div>
            {isLoadingPresets ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des presets...
              </div>
            ) : presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun preset sauvegardé. Vous pourrez en créer après avoir configuré un projet.
              </p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedPresetId} onValueChange={handleLoadPreset}>
                  <SelectTrigger className="flex-1 bg-background">
                    <SelectValue placeholder="Sélectionner un preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 max-h-60 overflow-y-auto bg-muted/30">
            <h3 className="font-semibold mb-2 text-sm">Transcription :</h3>
            {transcriptData.full_text ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {transcriptData.full_text}
              </p>
            ) : transcriptData.segments && transcriptData.segments.length > 0 ? (
              <div className="space-y-2 text-sm">
                {transcriptData.segments.slice(0, 50).map((segment: any, index: number) => (
                  <span key={index} className="text-muted-foreground">
                    {segment.text}{" "}
                  </span>
                ))}
                {transcriptData.segments.length > 50 && (
                  <p className="text-xs text-muted-foreground italic mt-2">
                    ... et {transcriptData.segments.length - 50} mots de plus
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Aucune transcription disponible
              </p>
            )}
          </div>
        </div>
      )}

      {step === "scene-config" && (
        <div className="space-y-4">
          {/* Preset selector */}
          <div className="rounded-lg border p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2 mb-3">
              <Download className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Charger un preset (optionnel)</h3>
            </div>
            {isLoadingPresets ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des presets...
              </div>
            ) : presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun preset sauvegardé. Vous pourrez en créer après avoir configuré un projet.
              </p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedPresetId} onValueChange={handleLoadPreset}>
                  <SelectTrigger className="flex-1 bg-background">
                    <SelectValue placeholder="Sélectionner un preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="default"
                  onClick={() => {
                    if (selectedPresetId) {
                      handleLoadPreset(selectedPresetId);
                    }
                  }}
                  disabled={!selectedPresetId}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Charger
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Format de contenu</Label>
            <RadioGroup value={sceneFormat} onValueChange={(value) => {
              const newFormat = value as "long" | "short";
              setSceneFormat(newFormat);
              if (newFormat === "short") {
                setDurationRanges(SHORT_FORM_DURATION_RANGES);
              } else {
                setDurationRanges(DEFAULT_DURATION_RANGES);
              }
            }}>
              <div className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="long" id="modal-format-long" />
                  <Label htmlFor="modal-format-long" className="font-normal cursor-pointer">Long form</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="short" id="modal-format-short" />
                  <Label htmlFor="modal-format-short" className="font-normal cursor-pointer">Short form</Label>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="p-4 border rounded-lg bg-muted/30">
            <DurationRangesEditor
              ranges={durationRanges}
              onChange={setDurationRanges}
              maxEndValue={sceneFormat === "long" ? 600 : 60}
            />
          </div>
        </div>
      )}

      {step === "prompt-config" && (
        <div className="space-y-4">
          {examplePrompts.map((prompt, index) => (
            <div key={index} className="space-y-2">
              <Label>Exemple de prompt {index + 1}</Label>
              <Textarea
                value={prompt}
                onChange={(e) => {
                  const newPrompts = [...examplePrompts];
                  newPrompts[index] = e.target.value;
                  setExamplePrompts(newPrompts);
                }}
                placeholder="Exemple: Un paysage montagneux au coucher du soleil, style photographique réaliste"
                rows={3}
              />
            </div>
          ))}
        </div>
      )}

      {step === "image-config" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Modèle de génération</Label>
            <Select value={imageModel} onValueChange={handleModelChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seedream-4.0">SeedDream 4.0</SelectItem>
                <SelectItem value="seedream-4.5">SeedDream 4.5</SelectItem>
                <SelectItem value="z-image-turbo">Z-Image Turbo (rapide)</SelectItem>
                <SelectItem value="z-image-turbo-lora">Z-Image Turbo LoRA</SelectItem>
              </SelectContent>
            </Select>
            {imageModel === "z-image-turbo" && styleReferenceUrls.length > 0 && (
              <p className="text-xs text-amber-600">
                Z-Image Turbo ne supporte pas les images de référence de style
              </p>
            )}
          </div>
          
          {/* LoRA configuration for z-image-turbo-lora */}
          {imageModel === "z-image-turbo-lora" && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
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
                      if (loraUrl.trim() && loraSteps > 0) {
                        setNewLoraPresetName("");
                        setSaveLoraPresetDialogOpen(true);
                      } else {
                        toast.error("Veuillez d'abord configurer l'URL et les steps");
                      }
                    }}
                    disabled={!loraUrl.trim()}
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
                <Label>URL du LoRA (HuggingFace .safetensors)</Label>
                <Input
                  value={loraUrl}
                  onChange={(e) => setLoraUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../resolve/main/model.safetensors"
                  className="break-all"
                />
                <p className="text-xs text-muted-foreground">
                  URL publique vers votre fichier .safetensors sur HuggingFace
                </p>
              </div>
              <div className="space-y-2">
                <Label>Nombre de steps</Label>
                <Input
                  type="number"
                  value={loraSteps}
                  onChange={(e) => setLoraSteps(parseInt(e.target.value) || 10)}
                  min={4}
                  max={50}
                />
                <p className="text-xs text-muted-foreground">
                  Plus de steps = meilleure qualité mais plus lent (recommandé: 10)
                </p>
              </div>
              
            </div>
          )}
          <div className="space-y-2">
            <Label>Aspect Ratio</Label>
            <Select value={aspectRatio} onValueChange={handleAspectRatioChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (Paysage)</SelectItem>
                <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                <SelectItem value="1:1">1:1 (Carré)</SelectItem>
                <SelectItem value="4:3">4:3 (Standard)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Largeur (px)</Label>
              <Input
                type="number"
                value={imageWidth}
                onChange={(e) => setImageWidth(parseInt(e.target.value))}
                min={512}
                max={1920}
              />
            </div>
            <div className="space-y-2">
              <Label>Hauteur (px)</Label>
              <Input
                type="number"
                value={imageHeight}
                onChange={(e) => setImageHeight(parseInt(e.target.value))}
                min={512}
                max={1920}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Images de référence de style (optionnel - max 15)</Label>
            <div className="border-2 border-dashed rounded-lg p-4">
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    handleStyleImageUpload(files);
                  }
                }}
                className="hidden"
                id="style-upload"
                disabled={isUploading || styleReferenceUrls.length >= 15}
              />
              <label htmlFor="style-upload" className={`cursor-pointer block ${styleReferenceUrls.length >= 15 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <div className="flex flex-col items-center gap-2 mb-4">
                  {isUploading ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Upload en cours...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {styleReferenceUrls.length >= 15 
                          ? "Maximum atteint (15 images)"
                          : `Cliquez pour uploader des images (${styleReferenceUrls.length}/15)`
                        }
                      </p>
                    </>
                  )}
                </div>
              </label>
              {styleReferenceUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {styleReferenceUrls.map((url, index) => (
                    <div key={index} className="relative group">
                      <img 
                        src={url} 
                        alt={`Style reference ${index + 1}`} 
                        className="h-20 w-full object-cover rounded border-2 border-border"
                      />
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleRemoveStyleImage(index);
                        }}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        type="button"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Thumbnail preset selector for semi-auto mode */}
          <div className="space-y-2">
            <Label>Preset de miniatures (pour le mode semi-automatique)</Label>
            <Select value={selectedThumbnailPresetId} onValueChange={setSelectedThumbnailPresetId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un preset de miniatures..." />
              </SelectTrigger>
              <SelectContent>
                {thumbnailPresets.length === 0 ? (
                  <SelectItem value="none" disabled>Aucun preset disponible</SelectItem>
                ) : (
                  thumbnailPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Requis si le mode semi-automatique est activé pour générer les miniatures
            </p>
          </div>

          {/* Semi-automatic mode option */}
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="semi-auto-mode"
                checked={semiAutoMode}
                onChange={(e) => setSemiAutoMode(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <label htmlFor="semi-auto-mode" className="font-medium cursor-pointer block">
                  Mode semi-automatique
                </label>
                <p className="text-sm text-muted-foreground mt-1">
                  Génère automatiquement tous les prompts, images et miniatures sans intervention manuelle après la configuration.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <div className="flex gap-2">
          {step !== "review" && (
            <Button
              variant="outline"
              onClick={() => {
                const steps: Array<"review" | "scene-config" | "prompt-config" | "image-config"> = ["review", "scene-config", "prompt-config", "image-config"];
                const currentIndex = steps.indexOf(step);
                if (currentIndex > 0) {
                  setStep(steps[currentIndex - 1]);
                }
              }}
            >
              Précédent
            </Button>
          )}
          {step !== "image-config" ? (
            <Button
              onClick={() => {
                const steps: Array<"review" | "scene-config" | "prompt-config" | "image-config"> = ["review", "scene-config", "prompt-config", "image-config"];
                const currentIndex = steps.indexOf(step);
                if (currentIndex < steps.length - 1) {
                  setStep(steps[currentIndex + 1]);
                }
              }}
            >
              Suivant
            </Button>
          ) : (
            <Button onClick={handleFinalizeConfiguration} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                "Valider et continuer"
              )}
            </Button>
          )}
        </div>
      </div>

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
            <div className="p-4 bg-muted rounded-lg text-sm">
              <p className="font-medium mb-2">Configuration actuelle :</p>
              <ul className="space-y-1 text-muted-foreground">
                <li className="break-words">
                  <span className="font-medium">URL :</span>{" "}
                  <span className="break-all">{loraUrl || "Non définie"}</span>
                </li>
                <li>
                  <span className="font-medium">Steps :</span> {loraSteps}
                </li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveLoraPresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSaveLoraPreset} disabled={isSavingLoraPreset || !newLoraPresetName.trim() || !loraUrl.trim()}>
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
          </DialogFooter>
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
          <DialogFooter>
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
          </DialogFooter>
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
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
