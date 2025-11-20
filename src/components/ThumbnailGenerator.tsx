import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, Loader2, Image as ImageIcon, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ThumbnailGeneratorProps {
  projectId: string;
  videoScript: string;
}

interface ThumbnailPreset {
  id: string;
  name: string;
  thumbnail_example_urls: string[];
  thumbnail_character_ref_url: string | null;
}

export const ThumbnailGenerator = ({ projectId, videoScript }: ThumbnailGeneratorProps) => {
  const [exampleUrls, setExampleUrls] = useState<string[]>([]);
  const [characterRefUrl, setCharacterRefUrl] = useState<string>("");
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [presets, setPresets] = useState<ThumbnailPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("presets")
        .select("id, name, thumbnail_example_urls, thumbnail_character_ref_url")
        .not("thumbnail_example_urls", "is", null)
        .order("name", { ascending: true });

      if (error) throw error;

      const mappedPresets: ThumbnailPreset[] = (data || []).map(preset => ({
        id: preset.id,
        name: preset.name,
        thumbnail_example_urls: Array.isArray(preset.thumbnail_example_urls) 
          ? preset.thumbnail_example_urls.filter((url): url is string => typeof url === 'string')
          : [],
        thumbnail_character_ref_url: preset.thumbnail_character_ref_url,
      }));

      setPresets(mappedPresets);
    } catch (error: any) {
      console.error("Error loading presets:", error);
    }
  };

  const loadPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    setExampleUrls(preset.thumbnail_example_urls || []);
    setCharacterRefUrl(preset.thumbnail_character_ref_url || "");
    toast.success("Preset chargé !");
  };

  const saveAsPreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    if (exampleUrls.length === 0) {
      toast.error("Ajoutez au moins un exemple de miniature");
      return;
    }

    setIsSavingPreset(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase
        .from("presets")
        .insert({
          user_id: user.id,
          name: newPresetName.trim(),
          thumbnail_example_urls: exampleUrls,
          thumbnail_character_ref_url: characterRefUrl || null,
        });

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setNewPresetName("");
      await loadPresets();
    } catch (error: any) {
      console.error("Error saving preset:", error);
      toast.error("Erreur lors de la sauvegarde du preset");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleExampleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const fileName = `${user.id}/thumbnails/examples/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("style-references")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("style-references")
        .getPublicUrl(fileName);

      setExampleUrls(prev => [...prev, publicUrl]);
      toast.success("Exemple ajouté !");
    } catch (error: any) {
      console.error("Error uploading example:", error);
      toast.error("Erreur lors de l'upload");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCharacterUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const fileName = `${user.id}/thumbnails/character/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("style-references")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("style-references")
        .getPublicUrl(fileName);

      setCharacterRefUrl(publicUrl);
      toast.success("Référence du personnage uploadée !");
    } catch (error: any) {
      console.error("Error uploading character:", error);
      toast.error("Erreur lors de l'upload");
    } finally {
      setIsUploading(false);
    }
  };

  const removeExample = (index: number) => {
    setExampleUrls(prev => prev.filter((_, i) => i !== index));
  };

  const generateThumbnails = async () => {
    if (exampleUrls.length === 0) {
      toast.error("Ajoute au moins un exemple de miniature");
      return;
    }
    if (!characterRefUrl) {
      toast.error("Ajoute une référence de ton personnage");
      return;
    }

    setIsGenerating(true);
    const generated: string[] = [];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Générer 3 versions
      for (let i = 0; i < 3; i++) {
        const prompt = `Create a YouTube thumbnail in the style of the provided examples. Include the character from the reference image. The video is about: ${videoScript.substring(0, 500)}. Make it eye-catching, professional, and similar in composition to the example thumbnails. Version ${i + 1} with slight variations.`;

        const { data, error } = await supabase.functions.invoke("generate-image-seedream", {
          body: {
            prompt,
            image_urls: [...exampleUrls, characterRefUrl],
            width: 1920,
            height: 1080,
          },
        });

        if (error) throw error;

        if (data?.output && Array.isArray(data.output)) {
          const imageUrl = data.output[0];
          
          // Télécharger et sauvegarder dans Supabase Storage
          const imageResponse = await fetch(imageUrl);
          const imageBlob = await imageResponse.blob();
          
          const fileName = `${user.id}/thumbnails/generated/${projectId}_${Date.now()}_v${i + 1}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("generated-images")
            .upload(fileName, imageBlob);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from("generated-images")
            .getPublicUrl(fileName);

          generated.push(publicUrl);
          toast.success(`Miniature ${i + 1}/3 générée !`);
        }
      }

      setGeneratedThumbnails(generated);
      toast.success("Toutes les miniatures sont générées !");
    } catch (error: any) {
      console.error("Error generating thumbnails:", error);
      toast.error("Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Générer des miniatures YouTube</h3>
        
        {/* Gestion des presets */}
        <Card className="p-4 mb-6 bg-muted/30">
          <Label className="text-sm font-medium mb-3 block">Presets de miniatures</Label>
          <div className="flex gap-2 mb-3">
            <Select value={selectedPresetId} onValueChange={(value) => {
              setSelectedPresetId(value);
              loadPreset(value);
            }}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Charger un preset..." />
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
          <div className="flex gap-2">
            <Input
              placeholder="Nom du nouveau preset..."
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={saveAsPreset}
              disabled={isSavingPreset || !newPresetName.trim() || exampleUrls.length === 0}
              size="sm"
            >
              {isSavingPreset ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Sauvegarder
                </>
              )}
            </Button>
          </div>
        </Card>
        
        {/* Exemples de miniatures */}
        <div className="space-y-4 mb-6">
          <Label>Exemples de miniatures (3-5 recommandés)</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {exampleUrls.map((url, index) => (
              <div key={index} className="relative group">
                <img
                  src={url}
                  alt={`Exemple ${index + 1}`}
                  className="w-full h-32 object-cover rounded-lg border"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeExample(index)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <label className="cursor-pointer">
              <div className="w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center hover:bg-accent transition-colors">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 mb-2" />
                    <span className="text-sm">Ajouter</span>
                  </>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleExampleUpload(e.target.files[0])}
                disabled={isUploading}
              />
            </label>
          </div>
        </div>

        {/* Référence du personnage */}
        <div className="space-y-4 mb-6">
          <Label>Référence du personnage</Label>
          {characterRefUrl ? (
            <div className="relative group w-fit">
              <img
                src={characterRefUrl}
                alt="Personnage"
                className="w-48 h-48 object-cover rounded-lg border"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setCharacterRefUrl("")}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <label className="cursor-pointer">
              <div className="w-48 h-48 border-2 border-dashed rounded-lg flex flex-col items-center justify-center hover:bg-accent transition-colors">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 mb-2" />
                    <span className="text-sm">Uploader</span>
                  </>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleCharacterUpload(e.target.files[0])}
                disabled={isUploading}
              />
            </label>
          )}
        </div>

        {/* Bouton de génération */}
        <Button
          onClick={generateThumbnails}
          disabled={isGenerating || exampleUrls.length === 0 || !characterRefUrl}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Génération en cours...
            </>
          ) : (
            <>
              <ImageIcon className="w-4 h-4 mr-2" />
              Générer 3 miniatures
            </>
          )}
        </Button>

        {/* Miniatures générées */}
        {generatedThumbnails.length > 0 && (
          <div className="mt-8">
            <h4 className="font-semibold mb-4">Miniatures générées</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {generatedThumbnails.map((url, index) => (
                <Card key={index} className="p-4">
                  <img
                    src={url}
                    alt={`Miniature ${index + 1}`}
                    className="w-full h-auto rounded-lg mb-2"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `thumbnail_v${index + 1}.jpg`;
                      link.click();
                    }}
                  >
                    Télécharger
                  </Button>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
