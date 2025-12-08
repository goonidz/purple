import { useState, useEffect } from "react";
import { parseStyleReferenceUrls } from "@/lib/styleReferenceHelpers";
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
import { Loader2, Save, Trash2, Plus, Copy, Settings } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

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
    sceneDuration0to1: number;
    sceneDuration1to3: number;
    sceneDuration3plus: number;
    examplePrompts: string[];
    imageWidth: number;
    imageHeight: number;
    aspectRatio: string;
    styleReferenceUrls: string[];
    imageModel: string;
    promptSystemMessage: string;
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
    sceneDuration0to1: number;
    sceneDuration1to3: number;
    sceneDuration3plus: number;
    examplePrompts: string[];
    imageWidth: number;
    imageHeight: number;
    aspectRatio: string;
    styleReferenceUrls: string[];
    imageModel: string;
    promptSystemMessage: string;
  } | null>(null);

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      
      const mappedPresets: Preset[] = (data || []).map(preset => ({
        id: preset.id,
        name: preset.name,
        scene_duration_0to1: preset.scene_duration_0to1,
        scene_duration_1to3: preset.scene_duration_1to3,
        scene_duration_3plus: preset.scene_duration_3plus,
        example_prompts: Array.isArray(preset.example_prompts) 
          ? preset.example_prompts.filter((p): p is string => typeof p === 'string')
          : [],
        image_width: preset.image_width,
        image_height: preset.image_height,
        aspect_ratio: preset.aspect_ratio,
        style_reference_url: preset.style_reference_url,
        image_model: (preset as any).image_model || 'seedream-4.5',
        prompt_system_message: (preset as any).prompt_system_message || null,
      }));
      
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

      const { error } = await supabase.from("presets").insert([
        {
          user_id: user.id,
          name: newPresetName.trim(),
          scene_duration_0to1: currentConfig.sceneDuration0to1,
          scene_duration_1to3: currentConfig.sceneDuration1to3,
          scene_duration_3plus: currentConfig.sceneDuration3plus,
          example_prompts: currentConfig.examplePrompts,
          image_width: currentConfig.imageWidth,
          image_height: currentConfig.imageHeight,
          aspect_ratio: currentConfig.aspectRatio,
          image_model: currentConfig.imageModel,
          style_reference_url: JSON.stringify(currentConfig.styleReferenceUrls),
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

  const handleLoadPreset = () => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (preset) {
      onLoadPreset(preset);
      toast.success(`Preset "${preset.name}" chargé !`);
    }
  };

  const handleUpdatePreset = async () => {
    if (!selectedPresetId || !editFormData) {
      toast.error("Aucun preset sélectionné");
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("presets")
        .update({
          name: editFormData.name,
          scene_duration_0to1: editFormData.sceneDuration0to1,
          scene_duration_1to3: editFormData.sceneDuration1to3,
          scene_duration_3plus: editFormData.sceneDuration3plus,
          example_prompts: editFormData.examplePrompts,
          image_width: editFormData.imageWidth,
          image_height: editFormData.imageHeight,
          aspect_ratio: editFormData.aspectRatio,
          image_model: editFormData.imageModel,
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
    setEditFormData({
      name: preset.name,
      sceneDuration0to1: preset.scene_duration_0to1,
      sceneDuration1to3: preset.scene_duration_1to3,
      sceneDuration3plus: preset.scene_duration_3plus,
      examplePrompts: preset.example_prompts,
      imageWidth: preset.image_width,
      imageHeight: preset.image_height,
      aspectRatio: preset.aspect_ratio,
      styleReferenceUrls: parseStyleReferenceUrls(preset.style_reference_url),
      imageModel: preset.image_model,
      promptSystemMessage: preset.prompt_system_message || DEFAULT_PROMPT_SYSTEM_MESSAGE,
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
          example_prompts: sourcePreset.example_prompts,
          image_width: sourcePreset.image_width,
          image_height: sourcePreset.image_height,
          aspect_ratio: sourcePreset.aspect_ratio,
          image_model: sourcePreset.image_model,
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
                    <div key={preset.id} className="flex items-center justify-between px-2 py-1.5 hover:bg-accent rounded-sm group">
                      <SelectItem value={preset.id} className="flex-1 p-0 focus:bg-transparent">
                        {preset.name}
                      </SelectItem>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPresetId(preset.id);
                            openEditDialogForPreset(preset);
                          }}
                        >
                          <Settings className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPresetId(preset.id);
                            openDuplicateDialogForPreset(preset);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePreset(preset.id, preset.name);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
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
            </div>
          </div>
        )}

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
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
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-duration-0to1" className="text-sm">
                        0-1 min
                      </Label>
                      <div className="relative">
                        <Input
                          id="edit-duration-0to1"
                          type="number"
                          min="1"
                          max="600"
                          value={editFormData.sceneDuration0to1}
                          onChange={(e) => setEditFormData({ ...editFormData, sceneDuration0to1: parseInt(e.target.value) })}
                          className="pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          sec
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-duration-1to3" className="text-sm">
                        1-3 min
                      </Label>
                      <div className="relative">
                        <Input
                          id="edit-duration-1to3"
                          type="number"
                          min="1"
                          max="600"
                          value={editFormData.sceneDuration1to3}
                          onChange={(e) => setEditFormData({ ...editFormData, sceneDuration1to3: parseInt(e.target.value) })}
                          className="pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          sec
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-duration-3plus" className="text-sm">
                        3+ min
                      </Label>
                      <div className="relative">
                        <Input
                          id="edit-duration-3plus"
                          type="number"
                          min="1"
                          max="600"
                          value={editFormData.sceneDuration3plus}
                          onChange={(e) => setEditFormData({ ...editFormData, sceneDuration3plus: parseInt(e.target.value) })}
                          className="pr-12"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          sec
                        </span>
                      </div>
                    </div>
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
                      <Input
                        id="edit-style-ref"
                        placeholder="https://..."
                        value={editFormData.styleReferenceUrls[0] || ""}
                        onChange={(e) => setEditFormData({ ...editFormData, styleReferenceUrls: e.target.value ? [e.target.value] : [] })}
                      />
                    </div>
                    {editFormData.styleReferenceUrls.length > 0 && (
                      <div className="rounded-lg border bg-muted/30 p-4">
                        <p className="text-xs text-muted-foreground mb-2">Aperçu ({editFormData.styleReferenceUrls.length} image{editFormData.styleReferenceUrls.length > 1 ? 's' : ''}):</p>
                        <div className="grid grid-cols-3 gap-2">
                          {editFormData.styleReferenceUrls.map((url, index) => (
                            <img 
                              key={index}
                              src={url} 
                              alt={`Style de référence ${index + 1}`} 
                              className="w-full h-24 object-cover rounded shadow-sm"
                              onError={(e) => {
                                e.currentTarget.src = "";
                                e.currentTarget.alt = "Image non disponible";
                              }}
                            />
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
      </div>
    </Card>
  );
};
