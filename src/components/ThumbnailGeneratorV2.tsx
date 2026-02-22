import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Loader2, Image as ImageIcon, Download, Youtube, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { JobProgressIndicator } from "@/components/JobProgressIndicator";

interface ThumbnailGeneratorV2Props {
  projectId: string;
  videoScript: string;
  videoTitle: string;
}

interface ThumbnailV2Preset {
  id: string;
  name: string;
  channel_handle: string | null;
  character_ref_url: string | null;
  custom_prompt: string | null;
  image_model: string | null;
}

interface HistoryItem {
  id: string;
  thumbnail_urls: string[];
  prompts: string[];
  created_at: string;
}

export const ThumbnailGeneratorV2 = ({ projectId, videoScript, videoTitle }: ThumbnailGeneratorV2Props) => {
  const [channelHandle, setChannelHandle] = useState("");
  const [characterRefUrl, setCharacterRefUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingCharacter, setIsDraggingCharacter] = useState(false);
  const [userDirectives, setUserDirectives] = useState("");
  const [imageModel, setImageModel] = useState("gemini-3-pro-image-preview");
  const [numThumbnails, setNumThumbnails] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Preset state
  const [presets, setPresets] = useState<ThumbnailV2Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [hasAutoLoadedPreset, setHasAutoLoadedPreset] = useState(false);

  // History state
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("generated_thumbnails")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setHistory((data || []).map(item => ({
        id: item.id,
        thumbnail_urls: Array.isArray(item.thumbnail_urls)
          ? item.thumbnail_urls.filter((url: unknown): url is string => typeof url === 'string')
          : [],
        prompts: Array.isArray(item.prompts)
          ? item.prompts.filter((p: unknown): p is string => typeof p === 'string')
          : [],
        created_at: item.created_at,
      })));
    } catch (error) {
      console.error("Error loading V2 history:", error);
    }
  }, [projectId]);

  const deleteHistoryItem = async (id: string) => {
    if (!confirm("Supprimer cette génération ?")) return;
    try {
      const { error } = await supabase
        .from("generated_thumbnails")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Génération supprimée !");
      await loadHistory();
    } catch (error) {
      console.error("Error deleting history item:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleJobComplete = useCallback(async (job: GenerationJob) => {
    if (job.job_type === 'thumbnails_v2') {
      toast.success("Miniatures V2 générées !");
      setIsGenerating(false);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: latestThumbnails } = await supabase
          .from("generated_thumbnails")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (latestThumbnails && latestThumbnails.length > 0) {
          const urls = Array.isArray(latestThumbnails[0].thumbnail_urls)
            ? latestThumbnails[0].thumbnail_urls.filter((url: unknown): url is string => typeof url === 'string')
            : [];
          setGeneratedThumbnails(urls);
        }
      }

      loadHistory();
    }
  }, [projectId, loadHistory]);

  const handleJobFailed = useCallback((job: GenerationJob) => {
    if (job.job_type === 'thumbnails_v2') {
      toast.error(`Erreur: ${job.error_message || 'Génération échouée'}`);
      setIsGenerating(false);
    }
  }, []);

  const { activeJobs, startJob, hasActiveJob, getJobByType } = useGenerationJobs({
    projectId,
    onJobComplete: handleJobComplete,
    onJobFailed: handleJobFailed,
    autoRetryImages: false,
  });

  useEffect(() => {
    const v2Job = getJobByType('thumbnails_v2');
    if (v2Job && !isGenerating) {
      setIsGenerating(true);
    } else if (!v2Job && isGenerating) {
      setIsGenerating(false);
    }
    if (v2Job?.metadata?.generatedThumbnails) {
      const thumbnails = v2Job.metadata.generatedThumbnails as Array<{ url: string; prompt: string; index: number }>;
      const sorted = [...thumbnails].sort((a, b) => a.index - b.index);
      setGeneratedThumbnails(sorted.map(t => t.url));
    }
  }, [activeJobs, hasActiveJob, isGenerating, getJobByType]);

  // Load presets + history on mount
  const loadPresets = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("thumbnail_presets")
        .select("id, name, channel_handle, character_ref_url, custom_prompt, image_model")
        .eq("user_id", user.id)
        .not("channel_handle", "is", null)
        .order("name");

      if (error) throw error;
      setPresets((data || []) as ThumbnailV2Preset[]);
    } catch (error) {
      console.error("Error loading V2 presets:", error);
    }
  }, []);

  useEffect(() => {
    loadPresets();
    loadHistory();
  }, [loadPresets, loadHistory]);

  useEffect(() => {
    setHasAutoLoadedPreset(false);
  }, [projectId]);

  // Auto-load preset from channel
  useEffect(() => {
    if (presets.length === 0 || hasAutoLoadedPreset) return;

    if (projectId) {
      (async () => {
        try {
          const { data: calendarData } = await supabase
            .from("content_calendar")
            .select(`
              channel_id,
              channels!inner (
                thumbnail_v2_preset_id,
                name
              )
            `)
            .eq("project_id", projectId)
            .maybeSingle();

          if (!calendarData) return;

          const channelData = (calendarData as any).channels;
          const presetId = channelData?.thumbnail_v2_preset_id;

          if (presetId) {
            const preset = presets.find(p => p.id === presetId);
            if (preset) {
              applyPreset(preset);
              setSelectedPresetId(presetId);
              setHasAutoLoadedPreset(true);
              toast.success(`Preset V2 "${preset.name}" chargé depuis la chaîne`);
            }
          }
        } catch (error) {
          console.error("Error auto-loading V2 preset:", error);
        }
      })();
    }
  }, [presets, projectId, hasAutoLoadedPreset]);

  const applyPreset = (preset: ThumbnailV2Preset) => {
    setChannelHandle(preset.channel_handle || "");
    setCharacterRefUrl(preset.character_ref_url || "");
    setUserDirectives(preset.custom_prompt || "");
    setImageModel(preset.image_model || "gemini-3-pro-image-preview");
  };

  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      applyPreset(preset);
      toast.success(`Preset "${preset.name}" chargé`);
    }
  };

  const saveAsPreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Entre un nom pour le preset");
      return;
    }
    if (!channelHandle.trim()) {
      toast.error("Entre un @ de chaîne YouTube");
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
          channel_handle: channelHandle.trim(),
          character_ref_url: characterRefUrl || null,
          custom_prompt: userDirectives.trim() || null,
          image_model: imageModel,
        } as any);

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setNewPresetName("");
      await loadPresets();
    } catch (error: any) {
      console.error("Error saving V2 preset:", error);
      toast.error("Erreur lors de la sauvegarde du preset");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const updatePreset = async () => {
    if (!selectedPresetId) return;

    try {
      const { error } = await supabase
        .from("thumbnail_presets")
        .update({
          channel_handle: channelHandle.trim(),
          character_ref_url: characterRefUrl || null,
          custom_prompt: userDirectives.trim() || null,
          image_model: imageModel,
        } as any)
        .eq("id", selectedPresetId);

      if (error) throw error;

      toast.success("Preset mis à jour !");
      await loadPresets();
    } catch (error: any) {
      console.error("Error updating V2 preset:", error);
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const deletePreset = async () => {
    if (!selectedPresetId) return;
    if (!confirm("Supprimer ce preset ?")) return;

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
      console.error("Error deleting V2 preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const compressImage = (file: File, maxWidth = 1920, maxHeight = 1080, quality = 0.85): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        if (!ctx) { reject(new Error('Could not get canvas context')); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Could not compress image')); return; }
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleCharacterUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const compressedFile = await compressImage(file);
      const fileName = `${user.id}/thumbnails-v2/character/${Date.now()}_${compressedFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from("style-references")
        .upload(fileName, compressedFile);
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

  const generateThumbnails = async () => {
    if (!channelHandle.trim()) {
      toast.error("Entre le @ d'une chaîne YouTube");
      return;
    }

    if (hasActiveJob('thumbnails_v2')) {
      toast.error("Une génération V2 est déjà en cours");
      return;
    }

    setIsGenerating(true);
    setGeneratedThumbnails([]);

    try {
      toast.info("Chargement des miniatures de la chaîne...");
      const { data, error } = await supabase.functions.invoke('fetch-channel-thumbnails', {
        body: { channelHandle: channelHandle.trim() }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const thumbnailUrls: string[] = data.thumbnailUrls || [];
      if (thumbnailUrls.length === 0) {
        throw new Error("Aucune miniature trouvée sur cette chaîne");
      }

      toast.info(`${thumbnailUrls.length} miniatures chargées, lancement de la génération...`);

      await startJob('thumbnails_v2', {
        videoScript,
        videoTitle,
        exampleUrls: thumbnailUrls,
        characterRefUrl: characterRefUrl || undefined,
        userDirectives: userDirectives.trim() || undefined,
        imageModel,
        numThumbnails,
      });

      toast.success("Génération V2 démarrée !");
    } catch (error: any) {
      console.error("Error starting thumbnails V2 job:", error);
      toast.error(error?.message || "Erreur lors du lancement");
      setIsGenerating(false);
    }
  };

  const downloadThumbnail = async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `thumbnail_v2_${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Erreur lors du téléchargement");
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Youtube className="w-5 h-5" />
          Miniature V2 — Style chaîne YouTube
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Entre le @ d'une chaîne YouTube, ajoute ton visage, et génère des miniatures dans le même style.
        </p>
      </div>

      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generate">Générer</TabsTrigger>
          <TabsTrigger value="history">Historique ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
          {/* Preset management */}
          <Card className="p-4 bg-muted/30 space-y-3">
            <Label className="text-sm font-medium">Presets</Label>
            <div className="flex gap-2">
              <Select value={selectedPresetId} onValueChange={handlePresetSelect}>
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
                onClick={updatePreset}
                disabled={!selectedPresetId}
                size="icon"
                variant="outline"
                title="Mettre à jour le preset"
              >
                <Save className="w-4 h-4" />
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

            <div className="flex gap-2">
              <Input
                placeholder="Nom du nouveau preset"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && saveAsPreset()}
              />
              <Button
                onClick={saveAsPreset}
                disabled={isSavingPreset || !newPresetName.trim()}
                size="sm"
              >
                {isSavingPreset ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-1" />
                    Sauvegarder
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Channel handle input */}
          <div className="space-y-2">
            <Label>Chaîne YouTube</Label>
            <Input
              value={channelHandle}
              onChange={(e) => setChannelHandle(e.target.value)}
              placeholder="@NomDeLaChaine"
              onKeyDown={(e) => e.key === 'Enter' && !isGenerating && generateThumbnails()}
            />
          </div>

          {/* Character reference */}
          <div className="space-y-2">
            <Label>Personnage / Visage de référence</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                isDraggingCharacter ? 'border-primary bg-primary/10' : 'border-muted-foreground/25'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingCharacter(true); }}
              onDragLeave={() => setIsDraggingCharacter(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingCharacter(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith('image/')) handleCharacterUpload(file);
              }}
              onClick={() => document.getElementById('v2-character-upload')?.click()}
            >
              <input
                id="v2-character-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleCharacterUpload(e.target.files[0])}
              />
              {isUploading ? (
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
              ) : (
                <>
                  <Upload className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Glisse ou clique pour ajouter ton visage
                  </p>
                </>
              )}
            </div>

            {characterRefUrl && (
              <div className="relative group inline-block mt-2">
                <img
                  src={characterRefUrl}
                  alt="Character reference"
                  className="w-32 h-32 object-cover rounded-lg border"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setCharacterRefUrl("")}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          {/* User directives */}
          <div className="space-y-2">
            <Label>Directives supplémentaires (optionnel)</Label>
            <Textarea
              value={userDirectives}
              onChange={(e) => setUserDirectives(e.target.value)}
              rows={3}
              className="text-sm"
              placeholder="Ex: Ajoute du texte rouge en gros, utilise un fond sombre, expression choquée..."
            />
          </div>

          {/* Model & count selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Modèle d'image</Label>
              <Select value={imageModel} onValueChange={setImageModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3-pro-image-preview">Gemini 3 Pro Image (Recommandé)</SelectItem>
                  <SelectItem value="seedream-4.5">SeedDream 4.5</SelectItem>
                  <SelectItem value="seedream-4">SeedDream 4.0</SelectItem>
                </SelectContent>
              </Select>
              {imageModel === 'gemini-3-pro-image-preview' && (
                <p className="text-xs text-muted-foreground">
                  Utilise ta clé Google Gemini (configurée dans ton Profil).
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Nombre de miniatures</Label>
              <Select value={String(numThumbnails)} onValueChange={(v) => setNumThumbnails(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Generate button */}
          <Button
            onClick={generateThumbnails}
            disabled={isGenerating || !channelHandle.trim()}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <ImageIcon className="w-5 h-5 mr-2" />
                Générer {numThumbnails} miniature{numThumbnails > 1 ? 's' : ''} dans ce style
              </>
            )}
          </Button>

          {/* Job progress */}
          {getJobByType('thumbnails_v2') && (
            <JobProgressIndicator job={getJobByType('thumbnails_v2')!} />
          )}

          {/* Generated results */}
          {generatedThumbnails.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-semibold">Miniatures générées</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {generatedThumbnails.map((url, index) => (
                  <div key={index} className="space-y-2">
                    <img
                      src={url}
                      alt={`Generated V2 ${index + 1}`}
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
          {history.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Aucune génération précédente</p>
            </Card>
          ) : (
            history.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex justify-between items-start mb-4">
                  <p className="text-sm text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString('fr-FR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Image preview dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Aperçu</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img
              src={previewImage}
              alt="Preview"
              className="w-full h-auto"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
