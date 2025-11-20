import { useState, useEffect } from "react";
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
import { Loader2, Save, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

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
}

interface PresetManagerProps {
  currentConfig: {
    sceneDuration0to1: number;
    sceneDuration1to3: number;
    sceneDuration3plus: number;
    examplePrompts: string[];
    imageWidth: number;
    imageHeight: number;
    aspectRatio: string;
    styleReferenceUrl: string;
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
          style_reference_url: currentConfig.styleReferenceUrl || null,
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
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
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
            </div>

            {selectedPresetId && (
              <div className="flex items-center justify-between p-2 bg-muted rounded-lg">
                <span className="text-xs text-muted-foreground">
                  {presets.find(p => p.id === selectedPresetId)?.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const preset = presets.find(p => p.id === selectedPresetId);
                    if (preset) deletePreset(preset.id, preset.name);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
