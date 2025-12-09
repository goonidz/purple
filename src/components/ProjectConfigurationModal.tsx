import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Plus, Upload, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseStyleReferenceUrls } from "@/lib/styleReferenceHelpers";

interface Preset {
  id: string;
  name: string;
  scene_duration_0to1: number;
  scene_duration_1to3: number;
  scene_duration_3plus: number;
  example_prompts: string[];
  image_width: number;
  image_height: number;
  aspect_ratio: string;
  style_reference_url: string | null;
  image_model: string;
  prompt_system_message: string | null;
}

interface ProjectConfigurationModalProps {
  transcriptData: any;
  currentProjectId: string;
  onComplete: (semiAutoMode: boolean, thumbnailPresetId?: string) => void;
  onCancel: () => void;
}

export const ProjectConfigurationModal = ({
  transcriptData,
  currentProjectId,
  onComplete,
  onCancel,
}: ProjectConfigurationModalProps) => {
  const [step, setStep] = useState<"review" | "scene-config" | "prompt-config" | "image-config">("review");
  const [sceneDuration0to1, setSceneDuration0to1] = useState(4);
  const [sceneDuration1to3, setSceneDuration1to3] = useState(6);
  const [sceneDuration3plus, setSceneDuration3plus] = useState(8);
  const [sceneFormat, setSceneFormat] = useState<"long" | "short">("long");
  const [range1End, setRange1End] = useState(60);
  const [range2End, setRange2End] = useState(180);
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [imageWidth, setImageWidth] = useState(1920);
  const [imageHeight, setImageHeight] = useState(1080);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageModel, setImageModel] = useState("seedream-4.5");
  const [styleReferenceUrls, setStyleReferenceUrls] = useState<string[]>([]);
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

  // Load presets on mount
  useEffect(() => {
    loadPresets();
    loadThumbnailPresets();
  }, []);

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
      
      const mappedPresets: Preset[] = (data || []).map(preset => ({
        id: preset.id,
        name: preset.name,
        scene_duration_0to1: preset.scene_duration_0to1 || 4,
        scene_duration_1to3: preset.scene_duration_1to3 || 6,
        scene_duration_3plus: preset.scene_duration_3plus || 8,
        example_prompts: Array.isArray(preset.example_prompts) 
          ? preset.example_prompts.filter((p): p is string => typeof p === 'string')
          : [],
        image_width: preset.image_width || 1920,
        image_height: preset.image_height || 1080,
        aspect_ratio: preset.aspect_ratio || "16:9",
        style_reference_url: preset.style_reference_url,
        image_model: (preset as any).image_model || 'seedream-4.5',
        prompt_system_message: (preset as any).prompt_system_message || null,
      }));
      
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
      setSceneDuration0to1(preset.scene_duration_0to1);
      setSceneDuration1to3(preset.scene_duration_1to3);
      setSceneDuration3plus(preset.scene_duration_3plus);
      setExamplePrompts(preset.example_prompts.length > 0 ? preset.example_prompts : ["", "", ""]);
      setImageWidth(preset.image_width);
      setImageHeight(preset.image_height);
      setAspectRatio(preset.aspect_ratio);
      setImageModel(preset.image_model);
      if (preset.style_reference_url) {
        setStyleReferenceUrls(parseStyleReferenceUrls(preset.style_reference_url));
      }
      setSelectedPresetId(presetId);
      toast.success(`Preset "${preset.name}" chargé !`);
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
    const ratios: Record<string, [number, number]> = {
      "16:9": [1920, 1080],
      "9:16": [1080, 1920],
      "1:1": [1080, 1080],
      "4:3": [1440, 1080],
    };
    if (ratios[value]) {
      const [w, h] = ratios[value];
      setImageWidth(w);
      setImageHeight(h);
    }
  };

  const handleFinalizeConfiguration = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          scene_duration_0to1: sceneDuration0to1,
          scene_duration_1to3: sceneDuration1to3,
          scene_duration_3plus: sceneDuration3plus,
          example_prompts: examplePrompts,
          image_width: imageWidth,
          image_height: imageHeight,
          aspect_ratio: aspectRatio,
          image_model: imageModel,
          style_reference_url: styleReferenceUrls.length > 0 ? JSON.stringify(styleReferenceUrls) : null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;

      toast.success("Configuration enregistrée !");
      onComplete(semiAutoMode, selectedThumbnailPresetId || undefined);
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
          <div className="space-y-2">
            <Label>Format de contenu</Label>
            <RadioGroup value={sceneFormat} onValueChange={(value) => {
              const newFormat = value as "long" | "short";
              setSceneFormat(newFormat);
              if (newFormat === "short") {
                setRange1End(5);
                setRange2End(15);
                setSceneDuration0to1(2);
                setSceneDuration1to3(4);
                setSceneDuration3plus(6);
              } else {
                setRange1End(60);
                setRange2End(180);
                setSceneDuration0to1(4);
                setSceneDuration1to3(6);
                setSceneDuration3plus(8);
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

          <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium mb-2 block">Plage 1 : 0 à {range1End}s</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Fin de plage (sec)</Label>
                    <Input
                      type="number"
                      min="1"
                      max={sceneFormat === "long" ? "120" : "30"}
                      value={range1End}
                      onChange={(e) => setRange1End(parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="60"
                      value={sceneDuration0to1}
                      onChange={(e) => setSceneDuration0to1(parseInt(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">Plage 2 : {range1End}s à {range2End}s</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Fin de plage (sec)</Label>
                    <Input
                      type="number"
                      min={range1End + 1}
                      max={sceneFormat === "long" ? "600" : "60"}
                      value={range2End}
                      onChange={(e) => setRange2End(parseInt(e.target.value) || range1End + 1)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="180"
                      value={sceneDuration1to3}
                      onChange={(e) => setSceneDuration1to3(parseInt(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">Plage 3 : {range2End}s et plus</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="opacity-50">
                    <Label className="text-xs text-muted-foreground">Sans limite</Label>
                    <Input disabled value="∞" className="bg-muted" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="600"
                      value={sceneDuration3plus}
                      onChange={(e) => setSceneDuration3plus(parseInt(e.target.value))}
                    />
                  </div>
                </div>
              </div>
            </div>
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
            <Select value={imageModel} onValueChange={setImageModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seedream-4.0">SeedDream 4.0</SelectItem>
                <SelectItem value="seedream-4.5">SeedDream 4.5</SelectItem>
                <SelectItem value="z-image-turbo">Z-Image Turbo (rapide)</SelectItem>
              </SelectContent>
            </Select>
            {imageModel === "z-image-turbo" && styleReferenceUrls.length > 0 && (
              <p className="text-xs text-amber-600">
                Z-Image Turbo ne supporte pas les images de référence de style
              </p>
            )}
          </div>
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
    </div>
  );
};
