import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Play, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

interface SceneEditorProps {
  scene: GeneratedPrompt;
  sceneIndex: number;
  onUpdate: (updatedScene: GeneratedPrompt) => void;
  onPlayFromHere: () => void;
  userId: string;
  subtitleSettings?: { size: "small" | "medium" | "large"; position: "top" | "bottom" };
  onSubtitleSettingsChange?: (settings: { size: "small" | "medium" | "large"; position: "top" | "bottom" }) => void;
}

export const SceneEditor = ({
  scene,
  sceneIndex,
  onUpdate,
  onPlayFromHere,
  userId,
  subtitleSettings = { size: "medium", position: "bottom" },
  onSubtitleSettingsChange
}: SceneEditorProps) => {
  const [localScene, setLocalScene] = useState(scene);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const handleTextChange = (field: keyof GeneratedPrompt, value: string) => {
    const updated = { ...localScene, [field]: value };
    setLocalScene(updated);
    onUpdate(updated);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Veuillez sélectionner une image");
      return;
    }

    setIsUploadingImage(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${Date.now()}-scene-${sceneIndex}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('generated-images')
        .getPublicUrl(fileName);

      const updated = { ...localScene, imageUrl: publicUrl };
      setLocalScene(updated);
      onUpdate(updated);
      toast.success("Image uploadée !");
    } catch (error: any) {
      console.error("Error uploading image:", error);
      toast.error(error.message || "Erreur lors de l'upload de l'image");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleDeleteImage = () => {
    const updated = { ...localScene, imageUrl: undefined };
    setLocalScene(updated);
    onUpdate(updated);
    toast.success("Image supprimée");
  };

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Scène {sceneIndex + 1}</h3>
        
        {/* Image */}
        <div className="space-y-3">
          <Label>Image</Label>
          {localScene.imageUrl ? (
            <div className="relative group">
              <img
                src={localScene.imageUrl}
                alt={`Scene ${sceneIndex + 1}`}
                className="w-full aspect-video object-cover rounded-lg"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button
                  size="lg"
                  onClick={onPlayFromHere}
                  className="gap-2"
                >
                  <Play className="h-6 w-6" />
                  Play
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <label className="cursor-pointer">
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-3">
                  {isUploadingImage ? "Upload en cours..." : "Cliquez pour uploader une image"}
                </p>
                <Button size="sm" variant="outline" asChild>
                  <span>Parcourir</span>
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={isUploadingImage}
                />
              </label>
            </div>
          )}
        </div>

        {/* Text */}
        <div className="space-y-2 mt-4">
          <Label>Texte de la scène</Label>
          <Textarea
            value={localScene.text}
            onChange={(e) => handleTextChange('text', e.target.value)}
            className="min-h-[100px]"
            placeholder="Texte de la scène..."
          />
        </div>

        {/* Prompt */}
        <div className="space-y-2 mt-4">
          <Label>Prompt d'image</Label>
          <Textarea
            value={localScene.prompt}
            onChange={(e) => handleTextChange('prompt', e.target.value)}
            className="min-h-[120px]"
            placeholder="Prompt pour générer l'image..."
          />
        </div>

        {/* Timings */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="space-y-2">
            <Label>Début (secondes)</Label>
            <Input
              type="number"
              step="0.1"
              value={localScene.startTime}
              onChange={(e) => handleTextChange('startTime', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Fin (secondes)</Label>
            <Input
              type="number"
              step="0.1"
              value={localScene.endTime}
              onChange={(e) => handleTextChange('endTime', e.target.value)}
            />
          </div>
        </div>

        {/* Subtitle Settings */}
        {onSubtitleSettingsChange && (
          <div className="space-y-3 mt-4 pt-4 border-t">
            <Label>Paramètres des sous-titres</Label>
            <div className="flex gap-2">
              <Button
                variant={subtitleSettings.size === "small" ? "default" : "outline"}
                size="sm"
                onClick={() => onSubtitleSettingsChange({ ...subtitleSettings, size: "small" })}
              >
                Petit
              </Button>
              <Button
                variant={subtitleSettings.size === "medium" ? "default" : "outline"}
                size="sm"
                onClick={() => onSubtitleSettingsChange({ ...subtitleSettings, size: "medium" })}
              >
                Moyen
              </Button>
              <Button
                variant={subtitleSettings.size === "large" ? "default" : "outline"}
                size="sm"
                onClick={() => onSubtitleSettingsChange({ ...subtitleSettings, size: "large" })}
              >
                Grand
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant={subtitleSettings.position === "top" ? "default" : "outline"}
                size="sm"
                onClick={() => onSubtitleSettingsChange({ ...subtitleSettings, position: "top" })}
              >
                Haut
              </Button>
              <Button
                variant={subtitleSettings.position === "bottom" ? "default" : "outline"}
                size="sm"
                onClick={() => onSubtitleSettingsChange({ ...subtitleSettings, position: "bottom" })}
              >
                Bas
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
