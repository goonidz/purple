import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, X, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PresetManager } from "@/components/PresetManager";

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSave: () => void;
}

export const ProjectSettingsDialog = ({
  open,
  onOpenChange,
  projectId,
  onSave,
}: ProjectSettingsDialogProps) => {
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
  const [styleReferenceUrl, setStyleReferenceUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && projectId) {
      loadProjectSettings();
    }
  }, [open, projectId]);

  const loadProjectSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;

      setSceneDuration0to1(data.scene_duration_0to1 || 4);
      setSceneDuration1to3(data.scene_duration_1to3 || 6);
      setSceneDuration3plus(data.scene_duration_3plus || 8);
      setExamplePrompts((data.example_prompts as string[]) || ["", "", ""]);
      setImageWidth(data.image_width || 1920);
      setImageHeight(data.image_height || 1080);
      setAspectRatio(data.aspect_ratio || "16:9");
      setStyleReferenceUrl(data.style_reference_url || "");
    } catch (error: any) {
      console.error("Error loading settings:", error);
      toast.error("Erreur lors du chargement des paramètres");
    }
  };

  const handleStyleImageUpload = async (file: File) => {
    setIsUploading(true);
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

      setStyleReferenceUrl(publicUrl);
      toast.success("Image de référence uploadée !");
    } catch (error: any) {
      console.error("Error uploading style image:", error);
      toast.error("Erreur lors de l'upload de l'image");
    } finally {
      setIsUploading(false);
    }
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

  const handleSave = async () => {
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
          style_reference_url: styleReferenceUrl || null,
        })
        .eq("id", projectId);

      if (error) throw error;

      toast.success("Paramètres enregistrés !");
      onSave();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setIsSaving(false);
    }
  };

  const updatePrompt = (index: number, value: string) => {
    const newPrompts = [...examplePrompts];
    newPrompts[index] = value;
    setExamplePrompts(newPrompts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl">Paramètres du projet</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="presets" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="presets">Presets</TabsTrigger>
              <TabsTrigger value="scenes">Scènes</TabsTrigger>
              <TabsTrigger value="prompts">Prompts</TabsTrigger>
              <TabsTrigger value="images">Images</TabsTrigger>
            </TabsList>

            <div className="mt-6">
              {/* Presets */}
              <TabsContent value="presets" className="space-y-4">
                <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10">
                  <h3 className="text-lg font-semibold mb-2">Charger un preset</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Les presets vous permettent de sauvegarder et réutiliser vos configurations préférées
                  </p>
                  <PresetManager
                    currentConfig={{
                      sceneDuration0to1,
                      sceneDuration1to3,
                      sceneDuration3plus,
                      examplePrompts,
                      imageWidth,
                      imageHeight,
                      aspectRatio,
                      styleReferenceUrl,
                    }}
                    onLoadPreset={(preset) => {
                      setSceneDuration0to1(preset.scene_duration_0to1);
                      setSceneDuration1to3(preset.scene_duration_1to3);
                      setSceneDuration3plus(preset.scene_duration_3plus);
                      setExamplePrompts(preset.example_prompts);
                      setImageWidth(preset.image_width);
                      setImageHeight(preset.image_height);
                      setAspectRatio(preset.aspect_ratio);
                      setStyleReferenceUrl(preset.style_reference_url || "");
                      toast.success(`Preset "${preset.name}" chargé !`);
                    }}
                  />
                </Card>
              </TabsContent>

              {/* Scènes */}
              <TabsContent value="scenes" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Configuration des durées de scènes</h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Format de contenu</Label>
                      <RadioGroup
                        value={sceneFormat}
                        onValueChange={(value) => {
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
                        }}
                      >
                        <div className="flex gap-4">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="long" id="scene-format-long" />
                            <Label htmlFor="scene-format-long" className="font-normal cursor-pointer">
                              Long form
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="short" id="scene-format-short" />
                            <Label htmlFor="scene-format-short" className="font-normal cursor-pointer">
                              Short form
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                      <div className="space-y-3">
                        <div>
                          <Label className="text-sm font-medium mb-2 block">
                            Plage 1 : 0 à {range1End}s
                          </Label>
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
                          <Label className="text-sm font-medium mb-2 block">
                            Plage 2 : {range1End}s à {range2End}s
                          </Label>
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
                          <Label className="text-sm font-medium mb-2 block">
                            Plage 3 : {range2End}s et plus
                          </Label>
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
                </Card>
              </TabsContent>

              {/* Prompts */}
              <TabsContent value="prompts" className="space-y-4">
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold">Exemples de prompts</h3>
                      <p className="text-sm text-muted-foreground">
                        Fournissez 2-3 exemples pour guider le style de génération
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExamplePrompts([...examplePrompts, ""])}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Ajouter
                    </Button>
                  </div>
                  
                  <div className="space-y-4">
                    {examplePrompts.map((prompt, index) => (
                      <div key={index} className="relative">
                        <Label className="text-sm font-medium">Exemple {index + 1}</Label>
                        <div className="relative mt-2">
                          <Textarea
                            value={prompt}
                            onChange={(e) => updatePrompt(index, e.target.value)}
                            rows={4}
                            placeholder="Décrivez le style et le format souhaités pour les prompts..."
                            className="pr-10"
                          />
                          {examplePrompts.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute top-2 right-2"
                              onClick={() => {
                                const newPrompts = examplePrompts.filter((_, i) => i !== index);
                                setExamplePrompts(newPrompts);
                              }}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </TabsContent>

              {/* Images */}
              <TabsContent value="images" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Paramètres des images</h3>
                  
                  <div className="space-y-6">
                    <div>
                      <Label className="text-base">Format d'image</Label>
                      <Select value={aspectRatio} onValueChange={handleAspectRatioChange}>
                        <SelectTrigger className="mt-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16:9">16:9 - Paysage (YouTube, TV)</SelectItem>
                          <SelectItem value="9:16">9:16 - Portrait (Stories, Shorts)</SelectItem>
                          <SelectItem value="1:1">1:1 - Carré (Instagram)</SelectItem>
                          <SelectItem value="4:3">4:3 - Standard</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Largeur (px)</Label>
                        <Input
                          type="number"
                          value={imageWidth}
                          onChange={(e) => setImageWidth(Number(e.target.value))}
                          min={512}
                          max={2048}
                          step={64}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <Label>Hauteur (px)</Label>
                        <Input
                          type="number"
                          value={imageHeight}
                          onChange={(e) => setImageHeight(Number(e.target.value))}
                          min={512}
                          max={2048}
                          step={64}
                          className="mt-2"
                        />
                      </div>
                    </div>

                    <div className="border-t pt-6">
                      <Label className="text-base">Image de référence de style</Label>
                      <p className="text-sm text-muted-foreground mb-4">
                        Uploadez une image pour guider le style visuel de toutes vos générations
                      </p>
                      
                      {styleReferenceUrl ? (
                        <div className="relative group">
                          <img
                            src={styleReferenceUrl}
                            alt="Style reference"
                            className="w-full h-64 object-cover rounded-lg border-2"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                            <Button
                              variant="destructive"
                              onClick={() => setStyleReferenceUrl("")}
                            >
                              <X className="w-4 h-4 mr-2" />
                              Supprimer
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <label className="cursor-pointer block">
                          <div className="border-2 border-dashed rounded-lg p-12 text-center hover:bg-accent/50 transition-colors">
                            {isUploading ? (
                              <Loader2 className="w-12 h-12 animate-spin mx-auto text-primary" />
                            ) : (
                              <>
                                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                <p className="text-sm font-medium">Cliquez pour uploader</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  PNG, JPG ou WEBP
                                </p>
                              </>
                            )}
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleStyleImageUpload(e.target.files[0])}
                            disabled={isUploading}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enregistrement...
              </>
            ) : (
              "Enregistrer les modifications"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
