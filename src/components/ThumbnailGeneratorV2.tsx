import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Loader2, Image as ImageIcon, Download, Youtube, Save, Trash2, Edit, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { JobProgressIndicator } from "@/components/JobProgressIndicator";

const DEFAULT_THUMBNAIL_PROMPT = `You are a professional YouTube thumbnail designer.

You create thumbnails based on example images provided by the user.

Image 1 will always contain the character that must be used in the thumbnail.
The following images are examples that you must study and draw inspiration from (composition, layout, typography, color palette, lighting, emotional tone, visual hierarchy, background style, and overall aesthetic).

Your Process

Step 1 — Deep Analysis
Carefully analyze each example image in depth:
Composition and framing
Color grading and dominant tones
Text placement and typography style
Contrast, lighting, and depth
Emotional expression and intensity
Visual hierarchy and focal points

Step 2 — Identify Patterns & Success Principles
Identify what ALL example thumbnails have in common (recurring colors, layout patterns, text style, character placement, background treatment, emotional tone). These shared elements are the channel's visual identity — you MUST reuse them.
Then analyze WHY these thumbnails are effective: what makes them clickable, what psychological triggers they use (curiosity gap, shock, urgency, contrast, simplicity), how they stand out in a YouTube feed. Apply these same principles to your design.

Step 3 — Understand the Topic
Fully understand the subject of the user's video before designing the thumbnail.

Step 4 — Concept Creation
Create the most compelling thumbnail concept:
Aligned with the video topic
Matching the style and structure of the example images
Using the user's character from Image 1
Optimized for curiosity, clarity, and click-through rate

If the example thumbnails contain text overlays, you MUST include text in your thumbnail too. Match the examples precisely:
Same approximate number of words (if examples have 1-2 words, use 1-2 words; if 3-5 words, use 3-5 words)
Same text size and weight relative to the image
Same color scheme and effects (outlines, shadows, gradients, glow)
Same placement and positioning on the thumbnail
Do NOT copy the exact words — write NEW text adapted to this video's topic
The text should complement the video title, create tension, spark curiosity, or amplify emotion
If the example thumbnails have NO text, do NOT add text.

Step 5 — Generate the Final Image
Produce the final thumbnail image.

Video Title:
{videoTitle}`;

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
  system_prompt: string | null;
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
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_THUMBNAIL_PROMPT);
  const [imageModel, setImageModel] = useState("ai33-gemini-image");
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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editChannelHandle, setEditChannelHandle] = useState("");
  const [editCharacterRefUrl, setEditCharacterRefUrl] = useState("");
  const [editUserDirectives, setEditUserDirectives] = useState("");
  const [editSystemPrompt, setEditSystemPrompt] = useState(DEFAULT_THUMBNAIL_PROMPT);
  const [editImageModel, setEditImageModel] = useState("ai33-gemini-image");
  const [isUploadingEdit, setIsUploadingEdit] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");

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

      // Use the final job metadata first (most reliable, already has all thumbnails)
      if (job.metadata?.generatedThumbnails) {
        const thumbnails = job.metadata.generatedThumbnails as Array<{ url: string; prompt: string; index: number }>;
        const sorted = [...thumbnails].sort((a, b) => a.index - b.index);
        setGeneratedThumbnails(sorted.map(t => t.url));
      } else {
        // Fallback: read from DB
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
        .select("id, name, channel_handle, character_ref_url, custom_prompt, system_prompt, image_model")
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
    setSystemPrompt(preset.system_prompt || DEFAULT_THUMBNAIL_PROMPT);
    setImageModel(preset.image_model || "ai33-gemini-image");
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

      const { data, error } = await supabase
        .from("thumbnail_presets")
        .insert({
          user_id: user.id,
          name: newPresetName.trim(),
          channel_handle: channelHandle.trim(),
          character_ref_url: characterRefUrl || null,
          custom_prompt: userDirectives.trim() || null,
          system_prompt: systemPrompt.trim() || null,
          image_model: imageModel,
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setNewPresetName("");
      await loadPresets();
      if (data) setSelectedPresetId(data.id);
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
          system_prompt: systemPrompt.trim() || null,
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

  const openEditDialog = () => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) return;
    setEditName(preset.name);
    setEditChannelHandle(preset.channel_handle || "");
    setEditCharacterRefUrl(preset.character_ref_url || "");
    setEditUserDirectives(preset.custom_prompt || "");
    setEditSystemPrompt(preset.system_prompt || DEFAULT_THUMBNAIL_PROMPT);
    setEditImageModel(preset.image_model || "ai33-gemini-image");
    setIsEditDialogOpen(true);
  };

  const handleEditCharacterUpload = async (file: File) => {
    setIsUploadingEdit(true);
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
      setEditCharacterRefUrl(publicUrl);
    } catch (error: any) {
      toast.error("Erreur lors de l'upload");
    } finally {
      setIsUploadingEdit(false);
    }
  };

  const saveEditPreset = async () => {
    if (!selectedPresetId || !editName.trim()) return;

    try {
      const { error } = await supabase
        .from("thumbnail_presets")
        .update({
          name: editName.trim(),
          channel_handle: editChannelHandle.trim() || null,
          character_ref_url: editCharacterRefUrl || null,
          custom_prompt: editUserDirectives.trim() || null,
          system_prompt: editSystemPrompt.trim() || null,
          image_model: editImageModel,
        } as any)
        .eq("id", selectedPresetId);

      if (error) throw error;

      toast.success("Preset modifié !");
      setIsEditDialogOpen(false);
      // Also update the form with the edited values
      setChannelHandle(editChannelHandle);
      setCharacterRefUrl(editCharacterRefUrl);
      setUserDirectives(editUserDirectives);
      setSystemPrompt(editSystemPrompt);
      setImageModel(editImageModel);
      await loadPresets();
    } catch (error: any) {
      console.error("Error editing V2 preset:", error);
      toast.error("Erreur lors de la modification");
    }
  };

  const openDuplicateDialog = () => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) return;
    setDuplicateName(`${preset.name} (copie)`);
    setIsDuplicateDialogOpen(true);
  };

  const duplicatePreset = async () => {
    if (!selectedPresetId || !duplicateName.trim()) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const preset = presets.find(p => p.id === selectedPresetId);
      if (!preset) return;

      const { data, error } = await supabase
        .from("thumbnail_presets")
        .insert({
          user_id: user.id,
          name: duplicateName.trim(),
          channel_handle: preset.channel_handle,
          character_ref_url: preset.character_ref_url,
          custom_prompt: preset.custom_prompt,
          system_prompt: preset.system_prompt,
          image_model: preset.image_model,
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      toast.success("Preset dupliqué !");
      setIsDuplicateDialogOpen(false);
      await loadPresets();
      if (data) setSelectedPresetId(data.id);
    } catch (error: any) {
      console.error("Error duplicating V2 preset:", error);
      toast.error("Erreur lors de la duplication");
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
        systemPrompt: systemPrompt.trim() || undefined,
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
                onClick={updatePreset}
                disabled={!selectedPresetId}
                size="icon"
                variant="outline"
                title="Sauvegarder les valeurs actuelles dans le preset"
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

          {/* Custom system prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Prompt système</Label>
              {systemPrompt !== DEFAULT_THUMBNAIL_PROMPT && (
                <button
                  type="button"
                  onClick={() => setSystemPrompt(DEFAULT_THUMBNAIL_PROMPT)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Réinitialiser
                </button>
              )}
            </div>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              className="text-sm font-mono"
            />
            {systemPrompt !== DEFAULT_THUMBNAIL_PROMPT && (
              <p className="text-xs text-amber-500">⚠️ Prompt modifié — sauvegarde le preset pour le conserver.</p>
            )}
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
                  <SelectItem value="ai33-gemini-image">Gemini Pro Image via AI33 Pro</SelectItem>
                  <SelectItem value="seedream-4.5">SeedDream 4.5 via Replicate</SelectItem>
                  <SelectItem value="seedream-5-lite">SeedDream 5.0 Lite via Replicate</SelectItem>
                  <SelectItem value="seedream-4">SeedDream 4.0 via Replicate</SelectItem>
                </SelectContent>
              </Select>
              {imageModel === 'gemini-3-pro-image-preview' && (
                <p className="text-xs text-muted-foreground">
                  Utilise ta clé Google Gemini (configurée dans ton Profil).
                </p>
              )}
              {imageModel === 'ai33-gemini-image' && (
                <p className="text-xs text-muted-foreground">
                  Utilise ta clé AI33 Pro (configurée dans ton Profil). Résolution 1K.
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
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                  <SelectItem value="9">9</SelectItem>
                  <SelectItem value="10">10</SelectItem>
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

      {/* Edit preset dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifier le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nom du preset</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Chaîne YouTube</Label>
              <Input
                value={editChannelHandle}
                onChange={(e) => setEditChannelHandle(e.target.value)}
                placeholder="@NomDeLaChaine"
              />
            </div>

            <div className="space-y-2">
              <Label>Personnage / Visage de référence</Label>
              {editCharacterRefUrl ? (
                <div className="relative group inline-block">
                  <img
                    src={editCharacterRefUrl}
                    alt="Character"
                    className="w-24 h-24 object-cover rounded-lg border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setEditCharacterRefUrl("")}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => document.getElementById('edit-character-upload')?.click()}
                >
                  <input
                    id="edit-character-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleEditCharacterUpload(e.target.files[0])}
                  />
                  {isUploadingEdit ? (
                    <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Upload className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Ajouter un visage</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Directives supplémentaires</Label>
              <Textarea
                value={editUserDirectives}
                onChange={(e) => setEditUserDirectives(e.target.value)}
                rows={3}
                className="text-sm"
                placeholder="Ex: Ajoute du texte rouge en gros..."
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Prompt système</Label>
                {editSystemPrompt !== DEFAULT_THUMBNAIL_PROMPT && (
                  <button
                    type="button"
                    onClick={() => setEditSystemPrompt(DEFAULT_THUMBNAIL_PROMPT)}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
              <Textarea
                value={editSystemPrompt}
                onChange={(e) => setEditSystemPrompt(e.target.value)}
                rows={10}
                className="text-sm font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label>Modèle d'image</Label>
              <Select value={editImageModel} onValueChange={setEditImageModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3-pro-image-preview">Gemini 3 Pro Image</SelectItem>
                  <SelectItem value="ai33-gemini-image">Gemini Pro Image via AI33 Pro</SelectItem>
                  <SelectItem value="seedream-4.5">SeedDream 4.5 via Replicate</SelectItem>
                  <SelectItem value="seedream-5-lite">SeedDream 5.0 Lite via Replicate</SelectItem>
                  <SelectItem value="seedream-4">SeedDream 4.0 via Replicate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Annuler</Button>
              <Button onClick={saveEditPreset} disabled={!editName.trim()}>Enregistrer</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate preset dialog */}
      <Dialog open={isDuplicateDialogOpen} onOpenChange={setIsDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dupliquer le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nom de la copie</Label>
              <Input
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && duplicatePreset()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsDuplicateDialogOpen(false)}>Annuler</Button>
              <Button onClick={duplicatePreset} disabled={!duplicateName.trim()}>Dupliquer</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
