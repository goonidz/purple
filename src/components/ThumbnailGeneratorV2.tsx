import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Upload, X, Loader2, Image as ImageIcon, Download, Search, Youtube } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { JobProgressIndicator } from "@/components/JobProgressIndicator";

interface ThumbnailGeneratorV2Props {
  projectId: string;
  videoScript: string;
  videoTitle: string;
}

export const ThumbnailGeneratorV2 = ({ projectId, videoScript, videoTitle }: ThumbnailGeneratorV2Props) => {
  const [channelHandle, setChannelHandle] = useState("");
  const [channelTitle, setChannelTitle] = useState("");
  const [channelThumbnailUrls, setChannelThumbnailUrls] = useState<string[]>([]);
  const [selectedThumbnails, setSelectedThumbnails] = useState<Set<number>>(new Set());
  const [isLoadingChannel, setIsLoadingChannel] = useState(false);

  const [characterRefUrl, setCharacterRefUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingCharacter, setIsDraggingCharacter] = useState(false);

  const [userDirectives, setUserDirectives] = useState("");
  const [imageModel, setImageModel] = useState("gemini-3-pro-image-preview");
  const [numThumbnails, setNumThumbnails] = useState(3);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
    }
  }, [projectId]);

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
    }
    if (v2Job?.metadata?.generatedThumbnails) {
      const thumbnails = v2Job.metadata.generatedThumbnails as Array<{ url: string; prompt: string; index: number }>;
      const sorted = [...thumbnails].sort((a, b) => a.index - b.index);
      setGeneratedThumbnails(sorted.map(t => t.url));
    }
  }, [activeJobs, hasActiveJob, isGenerating, getJobByType]);

  const loadChannelThumbnails = async () => {
    if (!channelHandle.trim()) {
      toast.error("Entre le @ d'une chaîne YouTube");
      return;
    }

    setIsLoadingChannel(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-channel-thumbnails', {
        body: { channelHandle: channelHandle.trim() }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setChannelThumbnailUrls(data.thumbnailUrls || []);
      setChannelTitle(data.channelTitle || channelHandle);
      // Select all by default
      setSelectedThumbnails(new Set((data.thumbnailUrls || []).map((_: string, i: number) => i)));
      toast.success(`${data.thumbnailUrls?.length || 0} miniatures chargées depuis "${data.channelTitle}"`);
    } catch (error: any) {
      console.error("Error loading channel thumbnails:", error);
      toast.error(error?.message || "Erreur lors du chargement de la chaîne");
    } finally {
      setIsLoadingChannel(false);
    }
  };

  const toggleThumbnailSelection = (index: number) => {
    setSelectedThumbnails(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedThumbnails(new Set(channelThumbnailUrls.map((_, i) => i)));
  };

  const deselectAll = () => {
    setSelectedThumbnails(new Set());
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
    const selectedUrls = channelThumbnailUrls.filter((_, i) => selectedThumbnails.has(i));

    if (selectedUrls.length === 0) {
      toast.error("Sélectionne au moins une miniature de référence");
      return;
    }

    if (hasActiveJob('thumbnails_v2')) {
      toast.error("Une génération V2 est déjà en cours");
      return;
    }

    setIsGenerating(true);
    setGeneratedThumbnails([]);

    try {
      toast.info("Lancement de la génération V2 en arrière-plan...");

      await startJob('thumbnails_v2', {
        videoScript,
        videoTitle,
        exampleUrls: selectedUrls,
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
          Charge les miniatures d'une chaîne YouTube, ajoute ton visage, et génère des miniatures dans le même style.
        </p>
      </div>

      {/* Channel handle input */}
      <div className="space-y-3">
        <Label>Chaîne YouTube</Label>
        <div className="flex gap-2">
          <Input
            value={channelHandle}
            onChange={(e) => setChannelHandle(e.target.value)}
            placeholder="@NomDeLaChaine"
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && loadChannelThumbnails()}
          />
          <Button
            onClick={loadChannelThumbnails}
            disabled={isLoadingChannel || !channelHandle.trim()}
          >
            {isLoadingChannel ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className="ml-2 hidden sm:inline">Charger</span>
          </Button>
        </div>
      </div>

      {/* Channel thumbnails grid */}
      {channelThumbnailUrls.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>
              Miniatures de "{channelTitle}" ({selectedThumbnails.size}/{channelThumbnailUrls.length} sélectionnées)
            </Label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>Tout</Button>
              <Button variant="ghost" size="sm" onClick={deselectAll}>Aucune</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {channelThumbnailUrls.map((url, index) => (
              <div
                key={url}
                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                  selectedThumbnails.has(index)
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-transparent opacity-50 hover:opacity-75'
                }`}
                onClick={() => toggleThumbnailSelection(index)}
              >
                <img
                  src={url}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
                {selectedThumbnails.has(index) && (
                  <div className="absolute top-1 right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                    <span className="text-primary-foreground text-xs font-bold">&#10003;</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
        disabled={isGenerating || selectedThumbnails.size === 0}
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

      {/* Image preview dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
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
