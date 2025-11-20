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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paramètres du projet</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Configuration des scènes */}
          <Card className="p-4">
            <h3 className="font-semibold mb-4">Configuration des scènes</h3>
            <div className="space-y-4">
              <div>
                <Label>Durée scènes courtes (0-1 mot)</Label>
                <Input
                  type="number"
                  value={sceneDuration0to1}
                  onChange={(e) => setSceneDuration0to1(Number(e.target.value))}
                  min={1}
                />
              </div>
              <div>
                <Label>Durée scènes moyennes (1-3 mots)</Label>
                <Input
                  type="number"
                  value={sceneDuration1to3}
                  onChange={(e) => setSceneDuration1to3(Number(e.target.value))}
                  min={1}
                />
              </div>
              <div>
                <Label>Durée scènes longues (3+ mots)</Label>
                <Input
                  type="number"
                  value={sceneDuration3plus}
                  onChange={(e) => setSceneDuration3plus(Number(e.target.value))}
                  min={1}
                />
              </div>
            </div>
          </Card>

          {/* Exemples de prompts */}
          <Card className="p-4">
            <h3 className="font-semibold mb-4">Exemples de prompts</h3>
            <div className="space-y-4">
              {examplePrompts.map((prompt, index) => (
                <div key={index}>
                  <Label>Exemple {index + 1}</Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => {
                      const newPrompts = [...examplePrompts];
                      newPrompts[index] = e.target.value;
                      setExamplePrompts(newPrompts);
                    }}
                    rows={3}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Configuration des images */}
          <Card className="p-4">
            <h3 className="font-semibold mb-4">Configuration des images</h3>
            <div className="space-y-4">
              <div>
                <Label>Ratio d'aspect</Label>
                <Select value={aspectRatio} onValueChange={handleAspectRatioChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                    <SelectItem value="1:1">1:1 (Carré)</SelectItem>
                    <SelectItem value="4:3">4:3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Largeur</Label>
                  <Input
                    type="number"
                    value={imageWidth}
                    onChange={(e) => setImageWidth(Number(e.target.value))}
                    min={512}
                    max={2048}
                  />
                </div>
                <div>
                  <Label>Hauteur</Label>
                  <Input
                    type="number"
                    value={imageHeight}
                    onChange={(e) => setImageHeight(Number(e.target.value))}
                    min={512}
                    max={2048}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Image de référence */}
          <Card className="p-4">
            <h3 className="font-semibold mb-4">Image de référence de style</h3>
            {styleReferenceUrl ? (
              <div className="relative group">
                <img
                  src={styleReferenceUrl}
                  alt="Style reference"
                  className="w-full h-48 object-cover rounded-lg"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setStyleReferenceUrl("")}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="cursor-pointer">
                <div className="border-2 border-dashed rounded-lg p-8 text-center hover:bg-accent transition-colors">
                  {isUploading ? (
                    <Loader2 className="w-8 h-8 animate-spin mx-auto" />
                  ) : (
                    <>
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Cliquez pour uploader une image
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
          </Card>

          <div className="flex justify-end gap-2 pt-4">
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
                "Enregistrer"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
