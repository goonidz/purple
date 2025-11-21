import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Loader2, Image as ImageIcon, Save, Download, Trash2, Edit, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ThumbnailGeneratorProps {
  projectId: string;
  videoScript: string;
}

interface ThumbnailPreset {
  id: string;
  name: string;
  example_urls: string[];
  character_ref_url: string | null;
}

interface GeneratedThumbnailHistory {
  id: string;
  thumbnail_urls: string[];
  prompts: string[];
  created_at: string;
}

export const ThumbnailGenerator = ({ projectId, videoScript }: ThumbnailGeneratorProps) => {
  const [exampleUrls, setExampleUrls] = useState<string[]>([]);
  const [characterRefUrl, setCharacterRefUrl] = useState<string>("");
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [thumbnailHistory, setThumbnailHistory] = useState<GeneratedThumbnailHistory[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [presets, setPresets] = useState<ThumbnailPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [isDraggingExamples, setIsDraggingExamples] = useState(false);
  const [isDraggingCharacter, setIsDraggingCharacter] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ThumbnailPreset | null>(null);
  const [editName, setEditName] = useState("");
  const [duplicateName, setDuplicateName] = useState("");

  useEffect(() => {
    loadPresets();
    loadThumbnailHistory();
  }, []);

  const loadPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("thumbnail_presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;

      const mappedPresets: ThumbnailPreset[] = (data || []).map(preset => ({
        id: preset.id,
        name: preset.name,
        example_urls: Array.isArray(preset.example_urls) 
          ? preset.example_urls.filter((url): url is string => typeof url === 'string')
          : [],
        character_ref_url: preset.character_ref_url,
      }));

      setPresets(mappedPresets);
    } catch (error: any) {
      console.error("Error loading presets:", error);
    }
  };

  const loadThumbnailHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("generated_thumbnails")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mappedHistory: GeneratedThumbnailHistory[] = (data || []).map(item => ({
        id: item.id,
        thumbnail_urls: Array.isArray(item.thumbnail_urls)
          ? item.thumbnail_urls.filter((url): url is string => typeof url === 'string')
          : [],
        prompts: Array.isArray(item.prompts)
          ? item.prompts.filter((p): p is string => typeof p === 'string')
          : [],
        created_at: item.created_at,
      }));

      setThumbnailHistory(mappedHistory);
    } catch (error: any) {
      console.error("Error loading thumbnail history:", error);
    }
  };

  const loadPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    setExampleUrls(preset.example_urls || []);
    setCharacterRefUrl(preset.character_ref_url || "");
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
        .from("thumbnail_presets")
        .insert({
          user_id: user.id,
          name: newPresetName.trim(),
          example_urls: exampleUrls,
          character_ref_url: characterRefUrl || null,
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

  const handleExampleUpload = async (files: FileList) => {
    if (files.length === 0) return;
    
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const uploadedUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = `${user.id}/thumbnails/examples/${Date.now()}_${file.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from("style-references")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("style-references")
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      setExampleUrls(prev => [...prev, ...uploadedUrls]);
      toast.success(`${uploadedUrls.length} exemple(s) ajouté(s) !`);
    } catch (error: any) {
      console.error("Error uploading examples:", error);
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
      toast.success("Personnage ajouté !");
    } catch (error: any) {
      console.error("Error uploading character:", error);
      toast.error("Erreur lors de l'upload");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOverExamples = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingExamples(true);
  };

  const handleDragLeaveExamples = () => {
    setIsDraggingExamples(false);
  };

  const handleDropExamples = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingExamples(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleExampleUpload(files);
    }
  };

  const handleDragOverCharacter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingCharacter(true);
  };

  const handleDragLeaveCharacter = () => {
    setIsDraggingCharacter(false);
  };

  const handleDropCharacter = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingCharacter(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleCharacterUpload(files[0]);
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

      // Étape 1: Générer 3 prompts créatifs avec Gemini
      // Collecter tous les prompts précédemment générés
      const previousPrompts = thumbnailHistory.flatMap(item => item.prompts);
      
      toast.info("Génération de 3 prompts créatifs avec Gemini...");
      const { data: promptsData, error: promptsError } = await supabase.functions.invoke("generate-thumbnail-prompts", {
        body: { 
          videoScript,
          exampleUrls,
          characterRefUrl,
          previousPrompts: previousPrompts.length > 0 ? previousPrompts : undefined
        }
      });

      if (promptsError) throw promptsError;
      if (!promptsData?.prompts || promptsData.prompts.length !== 3) {
        throw new Error("Failed to generate prompts");
      }

      const creativePrompts = promptsData.prompts as string[];
      console.log("Generated creative prompts:", creativePrompts);
      toast.success("Prompts créatifs générés !");

      // Étape 2: Générer les 3 miniatures EN PARALLÈLE
      toast.info("Génération des 3 miniatures en parallèle...");
      
      const generationPromises = creativePrompts.map(async (prompt, i) => {
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

          return publicUrl;
        }
        throw new Error(`Failed to generate thumbnail ${i + 1}`);
      });

      const results = await Promise.all(generationPromises);
      generated.push(...results);

      setGeneratedThumbnails(generated);
      toast.success("Toutes les miniatures sont générées !");

      // Sauvegarder dans l'historique
      const { error: saveError } = await supabase
        .from("generated_thumbnails")
        .insert({
          project_id: projectId,
          user_id: user.id,
          thumbnail_urls: generated,
          prompts: creativePrompts,
        });

      if (saveError) {
        console.error("Error saving to history:", saveError);
      } else {
        await loadThumbnailHistory();
      }
    } catch (error: any) {
      console.error("Error generating thumbnails:", error);
      toast.error("Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const { error } = await supabase
        .from("generated_thumbnails")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Génération supprimée !");
      await loadThumbnailHistory();
    } catch (error: any) {
      console.error("Error deleting history item:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const downloadThumbnail = async (url: string, index: number) => {
    try {
      // Fetch l'image depuis l'URL
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Créer un URL temporaire pour le blob
      const blobUrl = window.URL.createObjectURL(blob);
      
      // Créer un lien et télécharger
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `thumbnail_${index + 1}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Nettoyer l'URL temporaire
      window.URL.revokeObjectURL(blobUrl);
      toast.success("Miniature téléchargée !");
    } catch (error) {
      console.error("Error downloading thumbnail:", error);
      toast.error("Erreur lors du téléchargement");
    }
  };

  const openEditDialog = () => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) {
      toast.error("Sélectionnez un preset à modifier");
      return;
    }
    setEditingPreset(preset);
    setEditName(preset.name);
    setIsEditDialogOpen(true);
  };

  const updatePreset = async () => {
    if (!editingPreset || !editName.trim()) {
      toast.error("Veuillez entrer un nom");
      return;
    }

    try {
      const { error } = await supabase
        .from("thumbnail_presets")
        .update({
          name: editName.trim(),
          example_urls: exampleUrls,
          character_ref_url: characterRefUrl || null,
        })
        .eq("id", editingPreset.id);

      if (error) throw error;

      toast.success("Preset modifié !");
      setIsEditDialogOpen(false);
      setEditingPreset(null);
      await loadPresets();
    } catch (error: any) {
      console.error("Error updating preset:", error);
      toast.error("Erreur lors de la modification");
    }
  };

  const openDuplicateDialog = () => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) {
      toast.error("Sélectionnez un preset à dupliquer");
      return;
    }
    setEditingPreset(preset);
    setDuplicateName(`${preset.name} (copie)`);
    setIsDuplicateDialogOpen(true);
  };

  const duplicatePreset = async () => {
    if (!editingPreset || !duplicateName.trim()) {
      toast.error("Veuillez entrer un nom");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase
        .from("thumbnail_presets")
        .insert({
          user_id: user.id,
          name: duplicateName.trim(),
          example_urls: editingPreset.example_urls,
          character_ref_url: editingPreset.character_ref_url,
        });

      if (error) throw error;

      toast.success("Preset dupliqué !");
      setIsDuplicateDialogOpen(false);
      setEditingPreset(null);
      await loadPresets();
    } catch (error: any) {
      console.error("Error duplicating preset:", error);
      toast.error("Erreur lors de la duplication");
    }
  };

  const deletePreset = async () => {
    if (!selectedPresetId) {
      toast.error("Sélectionnez un preset à supprimer");
      return;
    }

    if (!confirm("Êtes-vous sûr de vouloir supprimer ce preset ?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("thumbnail_presets")
        .delete()
        .eq("id", selectedPresetId);

      if (error) throw error;

      toast.success("Preset supprimé !");
      setSelectedPresetId("");
      await loadPresets();
    } catch (error: any) {
      console.error("Error deleting preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Générer des miniatures YouTube</h3>
      
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generate">Générer</TabsTrigger>
          <TabsTrigger value="history">Historique ({thumbnailHistory.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
          {/* Gestion des presets */}
          <Card className="p-4 bg-muted/30">
            <Label className="text-sm font-medium mb-2 block">Presets</Label>
            <div className="flex gap-2">
              <Select value={selectedPresetId} onValueChange={(value) => {
                setSelectedPresetId(value);
                loadPreset(value);
              }}>
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
                onClick={openEditDialog}
                disabled={!selectedPresetId}
                size="icon"
                variant="outline"
                title="Modifier le preset"
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                onClick={openDuplicateDialog}
                disabled={!selectedPresetId}
                size="icon"
                variant="outline"
                title="Dupliquer le preset"
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                onClick={deletePreset}
                disabled={!selectedPresetId}
                size="icon"
                variant="outline"
                title="Supprimer le preset"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex gap-2 mt-4">
              <Input
                placeholder="Nom du preset"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="flex-1"
              />
              <Button
                onClick={saveAsPreset}
                disabled={isSavingPreset || !newPresetName.trim()}
                size="sm"
              >
                {isSavingPreset ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
              </Button>
            </div>
          </Card>

          {/* Exemples de miniatures */}
          <div>
            <Label className="mb-2">Exemples de miniatures (style)</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDraggingExamples ? 'border-primary bg-primary/10' : 'border-muted-foreground/25'
              }`}
              onDragOver={handleDragOverExamples}
              onDragLeave={handleDragLeaveExamples}
              onDrop={handleDropExamples}
              onClick={() => document.getElementById('example-upload')?.click()}
            >
              <input
                id="example-upload"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files && handleExampleUpload(e.target.files)}
              />
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Glisse ou clique pour ajouter des exemples
              </p>
            </div>

            {exampleUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-4 mt-4">
                {exampleUrls.map((url, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={url}
                      alt={`Example ${index + 1}`}
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
              </div>
            )}
          </div>

          {/* Référence du personnage */}
          <div>
            <Label className="mb-2">
              Personnage de référence (UNIQUEMENT le personnage)
            </Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDraggingCharacter ? 'border-primary bg-primary/10' : 'border-muted-foreground/25'
              }`}
              onDragOver={handleDragOverCharacter}
              onDragLeave={handleDragLeaveCharacter}
              onDrop={handleDropCharacter}
              onClick={() => document.getElementById('character-upload')?.click()}
            >
              <input
                id="character-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleCharacterUpload(e.target.files[0])}
              />
              <ImageIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Ajoute une image avec uniquement ton personnage
              </p>
            </div>

            {characterRefUrl && (
              <div className="relative group mt-4 inline-block">
                <img
                  src={characterRefUrl}
                  alt="Character reference"
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
            )}
          </div>

          {/* Bouton de génération */}
          <Button
            onClick={generateThumbnails}
            disabled={isGenerating || exampleUrls.length === 0 || !characterRefUrl}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              "Générer 3 miniatures"
            )}
          </Button>

          {/* Résultats de génération */}
          {generatedThumbnails.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-semibold">Miniatures générées</h4>
              <div className="grid grid-cols-3 gap-4">
                {generatedThumbnails.map((url, index) => (
                  <div key={index} className="space-y-2">
                    <img
                      src={url}
                      alt={`Generated ${index + 1}`}
                      className="w-full aspect-video object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setPreviewImage(url)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => downloadThumbnail(url, index)}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Télécharger
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {thumbnailHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Aucune génération précédente</p>
            </Card>
          ) : (
            thumbnailHistory.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString('fr-FR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {item.thumbnail_urls.map((url, index) => (
                    <div key={index} className="space-y-2">
                      <img
                        src={url}
                        alt={`History ${index + 1}`}
                        className="w-full aspect-video object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setPreviewImage(url)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => downloadThumbnail(url, index)}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Télécharger
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog pour prévisualiser l'image en grand */}
      <Dialog open={previewImage !== null} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Aperçu de la miniature</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img
              src={previewImage}
              alt="Preview"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog pour modifier un preset */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modifier le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom du preset</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nom du preset"
              />
            </div>
            
            <div>
              <Label>Exemples actuels ({exampleUrls.length})</Label>
              {exampleUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {exampleUrls.map((url, index) => (
                    <img
                      key={index}
                      src={url}
                      alt={`Example ${index + 1}`}
                      className="w-full h-24 object-cover rounded border"
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label>Personnage de référence</Label>
              {characterRefUrl && (
                <img
                  src={characterRefUrl}
                  alt="Character"
                  className="w-32 h-32 object-cover rounded border mt-2"
                />
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={updatePreset} disabled={!editName.trim()}>
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog pour dupliquer un preset */}
      <Dialog open={isDuplicateDialogOpen} onOpenChange={setIsDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dupliquer le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom du nouveau preset</Label>
              <Input
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                placeholder="Nom du preset"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setIsDuplicateDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={duplicatePreset} disabled={!duplicateName.trim()}>
                Dupliquer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
