import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProjectConfigurationModalProps {
  transcriptData: any;
  currentProjectId: string;
  onComplete: () => void;
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
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [imageWidth, setImageWidth] = useState(1920);
  const [imageHeight, setImageHeight] = useState(1080);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [styleReferenceUrl, setStyleReferenceUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
          style_reference_url: styleReferenceUrl || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;

      toast.success("Configuration enregistrée !");
      onComplete();
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
            <Label>Durée pour scènes de 0-1 seconde (en secondes)</Label>
            <Input
              type="number"
              value={sceneDuration0to1}
              onChange={(e) => setSceneDuration0to1(parseInt(e.target.value))}
              min={1}
              max={30}
            />
          </div>
          <div className="space-y-2">
            <Label>Durée pour scènes de 1-3 secondes</Label>
            <Input
              type="number"
              value={sceneDuration1to3}
              onChange={(e) => setSceneDuration1to3(parseInt(e.target.value))}
              min={1}
              max={30}
            />
          </div>
          <div className="space-y-2">
            <Label>Durée pour scènes de 3+ secondes</Label>
            <Input
              type="number"
              value={sceneDuration3plus}
              onChange={(e) => setSceneDuration3plus(parseInt(e.target.value))}
              min={1}
              max={30}
            />
          </div>
        </div>
      )}

      {step === "prompt-config" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ajoutez 2-3 exemples de prompts pour que l'IA comprenne le style souhaité
          </p>
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
            <Label>Image de référence de style (optionnel)</Label>
            <div className="border-2 border-dashed rounded-lg p-4 text-center">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleStyleImageUpload(file);
                  }
                }}
                className="hidden"
                id="style-upload"
                disabled={isUploading}
              />
              <label htmlFor="style-upload" className="cursor-pointer">
                <div className="flex flex-col items-center gap-2">
                  {isUploading ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Upload en cours...</p>
                    </>
                  ) : styleReferenceUrl ? (
                    <>
                      <img src={styleReferenceUrl} alt="Style reference" className="h-24 w-24 object-cover rounded" />
                      <p className="text-xs text-muted-foreground">Cliquez pour changer</p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Cliquez pour uploader une image</p>
                    </>
                  )}
                </div>
              </label>
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
