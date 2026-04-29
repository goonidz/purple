import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, X, Loader2, Image as ImageIcon, Save, Download, Trash2, Edit, Copy, GripVertical, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { JobProgressIndicator } from "@/components/JobProgressIndicator";

interface ThumbnailGeneratorProps {
  projectId: string;
  videoScript: string;
  videoTitle: string;
  standalone?: boolean; // If true, no real project exists - standalone mode
  thumbnailProjectId?: string; // For standalone thumbnail projects
}

interface ThumbnailPreset {
  id: string;
  name: string;
  example_urls: string[];
  character_ref_url: string | null;
  custom_prompt: string | null;
  image_model: string | null;
  text_model: string | null;
}

const DEFAULT_THUMBNAIL_PROMPT = `Tu es un expert en création de miniatures YouTube accrocheuses et performantes.

Ton rôle est de créer 3 prompts de miniatures YouTube BASÉS SUR LE CONTENU DU SCRIPT/TITRE fourni, en utilisant le STYLE VISUEL des exemples comme référence.

DISTINCTION CRUCIALE - STYLE vs CONTENU:
- Les images d'exemples = RÉFÉRENCE DE STYLE UNIQUEMENT (couleurs, composition, typographie, effets visuels, mise en page)
- Le script/titre de la vidéo = SOURCE DU CONTENU (sujet, personnages, éléments visuels pertinents)
- NE COPIE JAMAIS les personnes, textes, ou sujets des exemples - ils sont là uniquement pour montrer le style visuel désiré
- Le contenu de tes miniatures doit être 100% basé sur le script et le titre de la vidéo

CONTEXTE:
- Tu vas recevoir des images d'exemples montrant le STYLE VISUEL à reproduire (pas le contenu!)
- Tu vas recevoir le TITRE et le SCRIPT de la vidéo - c'est ça qui détermine le CONTENU des miniatures

RÈGLES STRICTES:
1. ANALYSE les exemples pour: palette de couleurs, style d'illustration, composition, effets visuels, typographie
2. IGNORE complètement: les personnes, le texte, le sujet des exemples - ce n'est PAS le contenu à reproduire
3. CRÉE des miniatures dont le SUJET et le CONTENU viennent UNIQUEMENT du script/titre de la vidéo
4. Décris des personnages ou éléments visuels pertinents au contenu du script
5. Les prompts doivent être en ANGLAIS
6. Chaque prompt: 60-100 mots, détaillé sur le style visuel ET pertinent au contenu du script
7. N'utilise JAMAIS le mot "dead" (reformule autrement)

RÈGLES DE SIMPLICITÉ:
- Maximum 3-4 éléments visuels par miniature
- Compositions épurées et lisibles
- 1-2 éléments visuels forts, pas beaucoup de petits détails
- Arrière-plan simple
- 2-3 éléments visuels clés tirés du script = design efficace`;

interface GeneratedThumbnailHistory {
  id: string;
  thumbnail_urls: string[];
  prompts: string[];
  created_at: string;
  preset_name: string | null;
}

export const ThumbnailGenerator = ({ projectId, videoScript, videoTitle, standalone = false, thumbnailProjectId }: ThumbnailGeneratorProps) => {
  const [exampleUrls, setExampleUrls] = useState<string[]>([]);
  const [characterRefUrl, setCharacterRefUrl] = useState<string>("");
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [thumbnailHistory, setThumbnailHistory] = useState<GeneratedThumbnailHistory[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
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
  const [editCustomPrompt, setEditCustomPrompt] = useState("");
  const [duplicateName, setDuplicateName] = useState("");
  const [isEditImageDialogOpen, setIsEditImageDialogOpen] = useState(false);
  const [editingImageUrl, setEditingImageUrl] = useState<string>("");
  const [editingImagePrompt, setEditingImagePrompt] = useState("");
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_THUMBNAIL_PROMPT);
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]);
  const [imageModel, setImageModel] = useState<string>("ai33-seedream-4.5");
  const [textModel, setTextModel] = useState<string>("claude-sonnet-4-6");
  const [userIdea, setUserIdea] = useState<string>("");
  // How many of the 5 prompts should be variations of the user idea.
  // Default 0 when the textarea is empty, auto-bumped to 2 when it becomes non-empty
  // (see effect below). Editable in the UI (0..5).
  const [userIdeaCount, setUserIdeaCount] = useState<number>(0);
  const prevUserIdeaEmptyRef = useRef<boolean>(true);
  // A/B test mode: optional second preset for splitting the 5 prompts.
  // selectedPreset2Id = "" means A/B disabled. preset2Count is editable in the UI.
  // Auto-defaults: empty -> selected = 2 (clamped to 5 - userIdeaCount).
  const [selectedPreset2Id, setSelectedPreset2Id] = useState<string>("");
  const [preset2Count, setPreset2Count] = useState<number>(0);
  const prevPreset2EmptyRef = useRef<boolean>(true);
  const [isDescribingThumbnail, setIsDescribingThumbnail] = useState(false);
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [avoidPreviousPrompts, setAvoidPreviousPrompts] = useState<boolean>(false);
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null);
  const [sourceVideoThumbnailUrl, setSourceVideoThumbnailUrl] = useState<string | null>(null);
  const [hasAutoLoadedPreset, setHasAutoLoadedPreset] = useState<boolean>(false);

  // Auto-adjust userIdeaCount on empty <-> non-empty transitions of the idea textarea:
  // - empty -> non-empty : bump count (1 if preset 2 also active to leave room, else 2)
  // - non-empty -> empty : reset count to 0
  // Mid-typing (still non-empty) leaves the user-chosen count untouched.
  useEffect(() => {
    const isEmpty = !userIdea.trim();
    const wasEmpty = prevUserIdeaEmptyRef.current;
    if (wasEmpty && !isEmpty) {
      setUserIdeaCount(selectedPreset2Id ? 1 : 2);
    } else if (!wasEmpty && isEmpty) {
      setUserIdeaCount(0);
    }
    prevUserIdeaEmptyRef.current = isEmpty;
  }, [userIdea, selectedPreset2Id]);

  // Auto-adjust preset2Count on empty <-> selected transitions of the preset 2 select.
  // When activating preset 2, default to 2; if the user idea is also active, lower
  // userIdeaCount to 1 (so distribution stays 1+2+2 = 5).
  useEffect(() => {
    const isEmpty = !selectedPreset2Id;
    const wasEmpty = prevPreset2EmptyRef.current;
    if (wasEmpty && !isEmpty) {
      const ideaActive = !!userIdea.trim() && userIdeaCount > 0;
      const newPreset2Count = Math.min(2, ideaActive ? 5 - 1 : 5);
      setPreset2Count(newPreset2Count);
      if (ideaActive && userIdeaCount > 5 - newPreset2Count) {
        setUserIdeaCount(Math.max(1, 5 - newPreset2Count));
      }
    } else if (!wasEmpty && isEmpty) {
      setPreset2Count(0);
    }
    prevPreset2EmptyRef.current = isEmpty;
    // userIdeaCount intentionally not in deps: we only react to preset2 select changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset2Id]);

  // Clamp preset2Count whenever userIdeaCount grows so the sum never exceeds 5.
  useEffect(() => {
    const max = 5 - userIdeaCount;
    if (preset2Count > max) {
      setPreset2Count(Math.max(0, max));
    }
  }, [userIdeaCount, preset2Count]);

  const extractYouTubeId = (url: string): string | null => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "youtu.be") {
        const id = u.pathname.split("/").filter(Boolean)[0];
        return id || null;
      }
      if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
        const v = u.searchParams.get("v");
        if (v) return v;
        const parts = u.pathname.split("/").filter(Boolean);
        // /shorts/:id, /embed/:id
        if (parts[0] === "shorts" || parts[0] === "embed") {
          return parts[1] || null;
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const computeYouTubeThumbnailUrls = (youtubeId: string) => {
    // maxresdefault may 404 for some videos; we'll fallback onError to hqdefault
    return {
      maxres: `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`,
      hq: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  };

  // Background job management for thumbnails
  const handleJobComplete = useCallback(async (job: GenerationJob) => {
    if (job.job_type === 'thumbnails') {
      toast.success("Miniatures générées en arrière-plan !");
      setIsGenerating(false);
      
      // Immediately update from job metadata (synchronous, no race condition)
      if (job.metadata?.generatedThumbnails) {
        const thumbnails = job.metadata.generatedThumbnails as Array<{ url: string; prompt: string; index: number }>;
        const sorted = [...thumbnails].sort((a, b) => a.index - b.index);
        setGeneratedThumbnails(sorted.map(t => t.url));
        setGeneratedPrompts(sorted.map(t => t.prompt));
      }
      
      // Also load from DB as backup (has the canonical data)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        let query = supabase
          .from("generated_thumbnails")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1);
        
        if (thumbnailProjectId) {
          query = query.eq("thumbnail_project_id", thumbnailProjectId);
        } else {
          query = query.eq("project_id", projectId);
        }
        
        const { data: latestThumbnails } = await query;
        
        if (latestThumbnails && latestThumbnails.length > 0) {
          const latest = latestThumbnails[0];
          // Display the generated thumbnails in the current generation area
          const urls = Array.isArray(latest.thumbnail_urls)
            ? latest.thumbnail_urls.filter((url): url is string => typeof url === 'string')
            : [];
          const prompts = Array.isArray(latest.prompts)
            ? latest.prompts.filter((p): p is string => typeof p === 'string')
            : [];
          
          setGeneratedThumbnails(urls);
          setGeneratedPrompts(prompts);
        }
      }
      
      loadThumbnailHistory();
    }
  }, [projectId, thumbnailProjectId]);

  const handleJobFailed = useCallback((job: GenerationJob) => {
    if (job.job_type === 'thumbnails') {
      const errorMessage = job.error_message || 'Génération échouée';
      
      // Check for WORKER_LIMIT error and provide helpful guidance
      if (errorMessage.includes('WORKER_LIMIT') || errorMessage.includes('worker') || errorMessage.includes('memory')) {
        toast.error(
          "⚠️ Limite de ressources atteinte. Vos images sont trop lourdes. Réduisez la taille des images d'exemple (max 500KB chacune) ou utilisez moins d'images.",
          { duration: 8000 }
        );
      } else {
        toast.error(`Erreur: ${errorMessage}`);
      }
      setIsGenerating(false);
    }
  }, []);

  const { 
    activeJobs, 
    startJob, 
    hasActiveJob,
    getJobByType
  } = useGenerationJobs({
    projectId: standalone ? null : projectId,
    onJobComplete: handleJobComplete,
    onJobFailed: handleJobFailed,
    autoRetryImages: false, // No auto-retry for thumbnails
    standalone
  });

  // Sync isGenerating with active jobs AND update thumbnails progressively
  useEffect(() => {
    const thumbnailJob = getJobByType('thumbnails');
    
    if (thumbnailJob && !isGenerating) {
      setIsGenerating(true);
    }
    
    // Update thumbnails progressively from job metadata
    if (thumbnailJob?.metadata?.generatedThumbnails) {
      const thumbnails = thumbnailJob.metadata.generatedThumbnails as Array<{ url: string; prompt: string; index: number }>;
      // Sort by index and extract URLs and prompts
      const sorted = [...thumbnails].sort((a, b) => a.index - b.index);
      setGeneratedThumbnails(sorted.map(t => t.url));
      setGeneratedPrompts(sorted.map(t => t.prompt));
    }
  }, [activeJobs, hasActiveJob, isGenerating, getJobByType]);

  useEffect(() => {
    loadPresets();
    loadThumbnailHistory();
  }, []);

  // Reset auto-load flag when project changes
  useEffect(() => {
    setHasAutoLoadedPreset(false);
  }, [projectId]);

  // Auto-load preset from project DB (direct project assignment, then channel via calendar).
  // The previous sessionStorage-based "Priority 1" was removed: it was a redundant cache of
  // the same channel preset that we resolve below from the DB, and it leaked between
  // projects when the Miniatures tab was never opened on the previous project (the
  // "consume on read" was conditional on the preset existing in the user's list).
  useEffect(() => {
    if (presets.length === 0 || standalone || hasAutoLoadedPreset) return;

    console.log("[ThumbnailGenerator] Auto-load check:", {
      presetsCount: presets.length,
      projectId,
      selectedPresetId,
      hasAutoLoadedPreset
    });

    // Load from project (direct assignment) or from channel (via content_calendar relation)
    if (projectId) {
      (async () => {
        try {
          console.log("[ThumbnailGenerator] Fetching channel preset for project:", projectId);
          
          // First, try to get presets from project (direct assignment)
          const { data: projectData, error: projectError } = await supabase
            .from("projects")
            .select("thumbnail_preset_id, thumbnail_preset_id_2")
            .eq("id", projectId)
            .single();
          
          if (projectError) {
            console.error("[ThumbnailGenerator] Error fetching project:", projectError);
          }
          
          let presetId = projectData?.thumbnail_preset_id;
          let preset2Id = projectData?.thumbnail_preset_id_2;
          console.log("[ThumbnailGenerator] Project thumbnail presets:", { presetId, preset2Id });
          
          // If no direct preset, try to get it from the linked channel
          if (!presetId || !preset2Id) {
            console.log("[ThumbnailGenerator] Missing project preset(s), checking channel via calendar...");
            const { data: calendarData, error: calendarError } = await supabase
              .from("content_calendar")
              .select(`
                channel_id,
                channels!inner (
                  thumbnail_preset_id,
                  thumbnail_preset_id_2,
                  thumbnail_preset_enabled,
                  name
                )
              `)
              .eq("project_id", projectId)
              .maybeSingle();
            
            if (calendarError) {
              console.error("[ThumbnailGenerator] Error fetching calendar:", calendarError);
            } else if (calendarData) {
              const channelData = (calendarData as any).channels;
              if (!presetId) presetId = channelData?.thumbnail_preset_id;
              if (!preset2Id) preset2Id = channelData?.thumbnail_preset_id_2;
              console.log("[ThumbnailGenerator] Channel presets:", {
                channelName: channelData?.name,
                presetId,
                preset2Id,
                enabled: channelData?.thumbnail_preset_enabled
              });
            } else {
              console.log("[ThumbnailGenerator] No calendar entry found for this project");
            }
          }
          
          // Load preset 1 if found (this populates the active fields: customPrompt, exampleUrls, etc.)
          if (presetId) {
            const preset = presets.find(p => p.id === presetId);
            console.log("[ThumbnailGenerator] Found preset 1:", preset?.name);
            if (preset) {
              loadPreset(presetId);
              setSelectedPresetId(presetId);
              setHasAutoLoadedPreset(true);
              toast.success(`Preset miniatures "${preset.name}" chargé depuis le channel`);
            }
          } else {
            console.log("[ThumbnailGenerator] No thumbnail preset found (project or channel)");
          }
          // Apply preset 2 separately — does NOT call loadPreset() (it must not overwrite
          // the active fields that are governed by preset 1)
          if (preset2Id && preset2Id !== presetId) {
            const preset2 = presets.find(p => p.id === preset2Id);
            if (preset2) {
              setSelectedPreset2Id(preset2Id);
              prevPreset2EmptyRef.current = false; // skip the auto-default that would override
              console.log("[ThumbnailGenerator] Auto-loaded preset 2:", preset2.name);
            }
          }
        } catch (error) {
          console.error("[ThumbnailGenerator] Error loading thumbnail preset:", error);
        }
      })();
    }
  }, [presets, projectId, standalone, hasAutoLoadedPreset]);

  useEffect(() => {
    if (standalone) return;
    if (!projectId) return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("content_calendar")
          .select("source_url, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        const url = (data as any)?.source_url as string | null;
        setSourceVideoUrl(url || null);

        if (url) {
          const ytId = extractYouTubeId(url);
          if (ytId) {
            const { maxres } = computeYouTubeThumbnailUrls(ytId);
            setSourceVideoThumbnailUrl(maxres);
          } else {
            setSourceVideoThumbnailUrl(null);
          }
        } else {
          setSourceVideoThumbnailUrl(null);
        }
      } catch (e: any) {
        // Non-blocking
        console.warn("Failed to load source video URL:", e?.message || e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, standalone]);

  const youtubeId = sourceVideoUrl ? extractYouTubeId(sourceVideoUrl) : null;
  const youtubeThumbs = youtubeId ? computeYouTubeThumbnailUrls(youtubeId) : null;

  const describeThumbnail = async () => {
    const thumbUrl = sourceVideoThumbnailUrl || youtubeThumbs?.maxres || youtubeThumbs?.hq;
    if (!thumbUrl) {
      toast.error("Aucune miniature disponible à analyser");
      return;
    }
    setIsDescribingThumbnail(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      const { data, error } = await supabase.functions.invoke('qa-image-gemini', {
        body: { imageUrl: thumbUrl, userId: user.id, mode: 'describe' },
      });
      if (error) throw error;
      if (data?.description) {
        setUserIdea(prev => prev ? `${prev}\n\n${data.description}` : data.description);
        toast.success("Description ajoutée");
      } else {
        throw new Error("Pas de description reçue");
      }
    } catch (err: any) {
      console.error("Describe thumbnail error:", err);
      toast.error(err.message || "Erreur lors de l'analyse");
    } finally {
      setIsDescribingThumbnail(false);
    }
  };

  const SourceVideoCard = () => {
    if (standalone) return null;
    if (!sourceVideoUrl) return null;

    return (
      <Card className="p-4 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-[240px] max-w-[40%] shrink-0">
            {youtubeThumbs?.maxres ? (
              <a href={sourceVideoUrl} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={sourceVideoThumbnailUrl || youtubeThumbs.maxres}
                  alt="Miniature de la vidéo source"
                  className="w-full rounded-md border object-cover"
                  onError={() => {
                    // Fallback to hq thumbnail if maxres isn't available
                    if (youtubeThumbs?.hq) setSourceVideoThumbnailUrl(youtubeThumbs.hq);
                  }}
                />
              </a>
            ) : (
              <div className="w-full aspect-video rounded-md border flex items-center justify-center text-xs text-muted-foreground">
                Miniature indisponible
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-semibold">Vidéo source</div>
                <div className="text-xs text-muted-foreground truncate">
                  <a href={sourceVideoUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {sourceVideoUrl}
                  </a>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {youtubeId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={describeThumbnail}
                    disabled={isDescribingThumbnail}
                    title="Analyser la composition de la miniature et l'insérer dans 'Ton idée / direction'"
                  >
                    {isDescribingThumbnail ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5 mr-1" />
                    )}
                    Décrire
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <a href={sourceVideoUrl} target="_blank" rel="noopener noreferrer">
                    Ouvrir
                  </a>
                </Button>
              </div>
            </div>

            {!youtubeId && (
              <div className="mt-2 text-xs text-muted-foreground">
                Pour l’instant, on affiche automatiquement la miniature uniquement pour les URLs YouTube.
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  const loadPresets = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("thumbnail_presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      if (error) throw error;

      const mappedPresets: ThumbnailPreset[] = (data || []).map(preset => ({
        id: preset.id,
        name: preset.name,
        example_urls: Array.isArray(preset.example_urls) 
          ? preset.example_urls.filter((url): url is string => typeof url === 'string')
          : [],
        character_ref_url: preset.character_ref_url,
        custom_prompt: preset.custom_prompt || null,
        image_model: (preset as any).image_model || null,
        text_model: (preset as any).text_model || null,
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

      // Use thumbnail_project_id for standalone projects, otherwise use project_id
      let query = supabase
        .from("generated_thumbnails")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (thumbnailProjectId) {
        query = query.eq("thumbnail_project_id", thumbnailProjectId);
      } else if (!standalone) {
        query = query.eq("project_id", projectId);
      } else {
        // Pure standalone without project - no history
        setThumbnailHistory([]);
        return;
      }

      const { data, error } = await query;

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
        preset_name: (item as any).preset_name || null,
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
    setCustomPrompt(preset.custom_prompt || DEFAULT_THUMBNAIL_PROMPT);
    setImageModel(preset.image_model || "ai33-seedream-4.5");
    setTextModel(preset.text_model || "claude-sonnet-4-6");
    toast.success("Preset chargé !");
  };

  const saveAsPreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
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
          custom_prompt: customPrompt !== DEFAULT_THUMBNAIL_PROMPT ? customPrompt : null,
          image_model: imageModel,
          text_model: textModel,
        } as any);

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

  // Compress image to reduce file size while maintaining quality
  const compressImage = (file: File, maxWidth = 1920, maxHeight = 1080, quality = 0.85): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        let { width, height } = img;
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        
        canvas.width = width;
        canvas.height = height;
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        // Draw image with smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not compress image'));
              return;
            }
            
            // Create new file with compressed data
            const compressedFile = new File(
              [blob], 
              file.name.replace(/\.[^.]+$/, '.jpg'), 
              { type: 'image/jpeg' }
            );
            
            console.log(`Image compressed: ${(file.size / 1024).toFixed(1)}KB -> ${(compressedFile.size / 1024).toFixed(1)}KB`);
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = URL.createObjectURL(file);
    });
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
        
        // Compress image before upload
        const compressedFile = await compressImage(file);
        
        const fileName = `${user.id}/thumbnails/examples/${Date.now()}_${compressedFile.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from("style-references")
          .upload(fileName, compressedFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("style-references")
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      setExampleUrls(prev => [...prev, ...uploadedUrls]);
      toast.success(`${uploadedUrls.length} exemple(s) ajouté(s) et compressé(s) !`);
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

      // Compress image before upload
      const compressedFile = await compressImage(file);
      
      const fileName = `${user.id}/thumbnails/character/${Date.now()}_${compressedFile.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from("style-references")
        .upload(fileName, compressedFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("style-references")
        .getPublicUrl(fileName);

      setCharacterRefUrl(publicUrl);
      toast.success("Personnage ajouté et compressé !");
    } catch (error: any) {
      console.error("Error uploading character:", error);
      toast.error("Erreur lors de l'upload");
    } finally {
      setIsUploading(false);
    }
  };

  const handleThumbnailUpload = async (files: FileList) => {
    if (files.length === 0) return;
    setIsUploadingThumbnail(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");

      const uploadedUrls: string[] = [];
      const effectiveProjectId = standalone ? (thumbnailProjectId || 'standalone') : projectId;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const compressedFile = await compressImage(file);
        const timestamp = Date.now();
        const fileName = `${effectiveProjectId}/uploaded_thumb_${timestamp}_${i}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from("generated-images")
          .upload(fileName, compressedFile, { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("generated-images")
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      await supabase.from('generated_thumbnails').insert({
        project_id: standalone ? null : projectId,
        thumbnail_project_id: thumbnailProjectId || null,
        user_id: user.id,
        thumbnail_urls: uploadedUrls,
        prompts: uploadedUrls.map(() => "Importée manuellement"),
        preset_name: null,
      });

      toast.success(`${uploadedUrls.length} miniature(s) importée(s) !`);
      await loadThumbnailHistory();
    } catch (error: any) {
      console.error("Error uploading thumbnails:", error);
      toast.error("Erreur lors de l'import");
    } finally {
      setIsUploadingThumbnail(false);
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

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    // Reorder the array
    setExampleUrls(prev => {
      const newUrls = [...prev];
      const draggedItem = newUrls[draggedIndex];
      newUrls.splice(draggedIndex, 1);
      newUrls.splice(index, 0, draggedItem);
      setDraggedIndex(index);
      return newUrls;
    });
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const generateThumbnails = async () => {
    if (hasActiveJob('thumbnails')) {
      toast.error("Une génération de miniatures est déjà en cours");
      return;
    }

    setIsGenerating(true);
    setGeneratedThumbnails([]);
    setGeneratedPrompts([]);

    try {
      // Collect previous prompts for variation (only if option is enabled)
      const previousPrompts = avoidPreviousPrompts 
        ? thumbnailHistory.flatMap(item => item.prompts)
        : [];
      
      toast.info("Lancement de la génération en arrière-plan...");
      
      // Get the preset name if one is selected
      const selectedPreset = presets.find(p => p.id === selectedPresetId);
      const presetName = selectedPreset?.name || null;
      
      // Start background job with all required metadata
      await startJob('thumbnails', {
        videoScript,
        videoTitle,
        exampleUrls,
        characterRefUrl: characterRefUrl || undefined,
        previousPrompts: previousPrompts.length > 0 ? previousPrompts : undefined,
        customPrompt: customPrompt !== DEFAULT_THUMBNAIL_PROMPT ? customPrompt : undefined,
        userIdea: userIdea.trim() || undefined,
        userIdeaCount: userIdea.trim() ? userIdeaCount : 0,
        selectedPreset2Id: selectedPreset2Id || undefined,
        preset2Count: selectedPreset2Id ? preset2Count : 0,
        imageModel,
        textModel,
        presetName,
        standalone, // Pass standalone flag to skip project lookup
        thumbnailProjectId // Pass for saving to thumbnail_projects
      });
      
      toast.success("Génération démarrée ! Vous pouvez quitter cette page.");
    } catch (error: any) {
      console.error("Error starting thumbnails job:", error);
      const errorMessage = error?.message || "Erreur lors du lancement";
      
      // Check for WORKER_LIMIT error and provide helpful guidance
      if (errorMessage.includes('WORKER_LIMIT') || errorMessage.includes('worker') || errorMessage.includes('memory')) {
        toast.error(
          "⚠️ Limite de ressources atteinte. Vos images sont trop lourdes. Réduisez la taille des images d'exemple (max 500KB chacune) ou utilisez moins d'images.",
          { duration: 8000 }
        );
      } else {
        toast.error(errorMessage);
      }
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
    setEditCustomPrompt(preset.custom_prompt || DEFAULT_THUMBNAIL_PROMPT);
    setImageModel(preset.image_model || "ai33-seedream-4.5");
    setTextModel(preset.text_model || "claude-sonnet-4-6");
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
          custom_prompt: editCustomPrompt !== DEFAULT_THUMBNAIL_PROMPT ? editCustomPrompt : null,
          image_model: imageModel,
          text_model: textModel,
        } as any)
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
          custom_prompt: editingPreset.custom_prompt,
          image_model: editingPreset.image_model,
          text_model: editingPreset.text_model,
        } as any);

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

  const openEditImageDialog = (imageUrl: string) => {
    setEditingImageUrl(imageUrl);
    setEditingImagePrompt("");
    setIsEditImageDialogOpen(true);
  };

  const editThumbnailImage = async () => {
    if (!editingImageUrl || !editingImagePrompt.trim()) {
      toast.error("Veuillez entrer une instruction de modification");
      return;
    }

    setIsEditingImage(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      toast.info("Modification de la miniature en cours...");

      // Use the existing generate-image-seedream function with uploadToStorage
      const { data, error } = await supabase.functions.invoke("generate-image-seedream", {
        body: {
          prompt: editingImagePrompt,
          width: 1920,
          height: 1080,
          image_urls: [editingImageUrl],
          uploadToStorage: true,
          storageFolder: 'thumbnails',
          filePrefix: 'edited_thumbnail'
        }
      });

      if (error) throw error;
      if (!data?.output) throw new Error("No image generated");

      const publicUrl = Array.isArray(data.output) ? data.output[0] : data.output;

      // Add to local history
      // Generate UUID compatible with all browsers
      const generateUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };
      
      const newHistory: GeneratedThumbnailHistory[] = [
        {
          id: generateUUID(),
          prompts: [editingImagePrompt],
          thumbnail_urls: [publicUrl],
          created_at: new Date().toISOString(),
          preset_name: null
        },
        ...thumbnailHistory
      ];
      setThumbnailHistory(newHistory);

      // Save to database
      await supabase.from('generated_thumbnails').insert({
        project_id: standalone ? null : projectId,
        thumbnail_project_id: thumbnailProjectId || null,
        user_id: user.id,
        prompts: [editingImagePrompt],
        thumbnail_urls: [publicUrl]
      });

      toast.success("Miniature modifiée avec succès");
      setIsEditImageDialogOpen(false);
      setEditingImagePrompt("");
    } catch (error: any) {
      console.error('Error editing thumbnail:', error);
      toast.error(error?.message || "Erreur lors de la modification de la miniature");
    } finally {
      setIsEditingImage(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Générer des miniatures YouTube</h3>

      <SourceVideoCard />
      
      <div className="space-y-6">
        <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full flex items-center justify-between py-3">
              <span className="text-sm font-medium">Paramètres de génération</span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${configOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-6 pt-4">
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

            {/* A/B test (preset 2 optionnel) */}
            <Collapsible className="mt-4">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-2">
                    A/B test (optionnel)
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        selectedPreset2Id
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {selectedPreset2Id ? 'On' : 'Off'}
                    </span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Preset miniature B</Label>
                  <Select
                    value={selectedPreset2Id || "none"}
                    onValueChange={async (value) => {
                      const newId = value === "none" ? "" : value;
                      setSelectedPreset2Id(newId);
                      // Persist on real projects so the user's choice survives reload
                      if (!standalone && projectId) {
                        try {
                          const { error } = await supabase
                            .from("projects")
                            .update({ thumbnail_preset_id_2: newId || null })
                            .eq("id", projectId);
                          if (error) {
                            console.error("[ThumbnailGenerator] Failed to save preset 2:", error);
                          }
                        } catch (err) {
                          console.error("[ThumbnailGenerator] Failed to save preset 2:", err);
                        }
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Aucun (A/B désactivé)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun (A/B désactivé)</SelectItem>
                      {presets
                        .filter((p) => p.id !== selectedPresetId)
                        .map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedPreset2Id && (
                  <>
                    <div className="flex items-center gap-3 pt-1">
                      <Label className="text-xs text-muted-foreground whitespace-nowrap">
                        Variations preset B
                      </Label>
                      <Select
                        value={String(preset2Count)}
                        onValueChange={(v) => setPreset2Count(Number(v))}
                      >
                        <SelectTrigger className="h-8 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 5 - userIdeaCount + 1 }, (_, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {i} / 5
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground pt-1">
                      Distribution : Preset A: {Math.max(0, 5 - userIdeaCount - preset2Count)} · Preset B: {preset2Count} · Décrire: {userIdeaCount}
                    </div>
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>
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
                  <div 
                    key={url} 
                    className={`relative group cursor-grab active:cursor-grabbing ${draggedIndex === index ? 'opacity-50' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="absolute top-2 left-2 z-10 bg-black/50 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="w-4 h-4 text-white" />
                    </div>
                    <img
                      src={url}
                      alt={`Example ${index + 1}`}
                      className="w-full h-auto max-h-40 object-contain rounded-lg border bg-muted/50 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setPreviewImage(url)}
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeExample(index);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Référence du personnage (optionnel) */}
          <div>
            <Label className="mb-2">
              Personnage de référence (optionnel)
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
                Ajoute une image de ton personnage (optionnel)
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

          {/* Idée / direction pour les miniatures (optionnel) */}
          <div className="space-y-2">
            <Label className="text-sm">
              Ton idée / direction (optionnel)
            </Label>
            <Textarea
              value={userIdea}
              onChange={(e) => setUserIdea(e.target.value)}
              rows={2}
              className="text-sm"
              placeholder="Ex: Je veux une miniature avec un effet avant/après, ou un visage choqué avec du texte rouge..."
            />
            <div className="flex items-center gap-3 pt-1">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">
                Variations basées sur cette idée
              </Label>
              <Select
                value={String(userIdeaCount)}
                onValueChange={(v) => setUserIdeaCount(Number(v))}
                disabled={!userIdea.trim()}
              >
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 - preset2Count + 1 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {i} / 5
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {!userIdea.trim()
                  ? "Remplis l'idée ci-dessus pour activer"
                  : userIdeaCount === 0
                    ? "Idée ignorée"
                    : userIdeaCount === 5
                      ? "Toutes les miniatures suivent l'idée"
                      : selectedPreset2Id && preset2Count > 0
                        ? `${userIdeaCount} idée + ${preset2Count} preset B + ${Math.max(0, 5 - userIdeaCount - preset2Count)} preset A`
                        : `${userIdeaCount} miniature(s) suivent l'idée, ${5 - userIdeaCount} indépendante(s) du script`}
              </span>
            </div>
          </div>

          {/* Prompt système personnalisable */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Prompt système (modifiable)
            </Label>
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              placeholder="Entrez votre prompt personnalisé..."
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCustomPrompt(DEFAULT_THUMBNAIL_PROMPT)}
              className="text-muted-foreground"
            >
              Réinitialiser au prompt par défaut
            </Button>
          </div>

          {/* Sélection du modèle de texte (LLM) */}
          <div className="space-y-2">
            <Label>Modèle de génération de prompts</Label>
            <Select value={textModel} onValueChange={setTextModel}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un modèle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (Qualité)</SelectItem>
                <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash (Rapide)</SelectItem>
              </SelectContent>
            </Select>
            {textModel === "claude-sonnet-4-6" && (
              <p className="text-xs text-muted-foreground mt-2 italic px-1">
                ⚠️ Avec Claude, seule la première image sera envoyée en exemple pour générer les prompts des miniatures. La qualité est par contre bien supérieure.
              </p>
            )}
          </div>

          {/* Sélection du modèle d'image */}
          <div className="space-y-2">
            <Label>Modèle de génération d'image</Label>
            <Select value={imageModel} onValueChange={setImageModel}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un modèle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ai33-seedream-4.5">Seedream 4.5 via AI33 Pro (Recommandé)</SelectItem>
                <SelectItem value="seedream-4.5">SeedDream 4.5 via Replicate</SelectItem>
                <SelectItem value="seedream-5-lite">SeedDream 5.0 Lite</SelectItem>
                <SelectItem value="ai33-gemini-flash">Gemini 3.1 Flash Image via AI33 Pro</SelectItem>
                <SelectItem value="ai33-gemini-image">Gemini Pro Image via AI33 Pro</SelectItem>
                <SelectItem value="gemini-3-pro-image-preview">Gemini 3 Pro Image (Google)</SelectItem>
                <SelectItem value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image (Google)</SelectItem>
                <SelectItem value="seedream-4">SeedDream 4.0</SelectItem>
                <SelectItem value="z-image-turbo">Z-Image Turbo (Rapide)</SelectItem>
              </SelectContent>
            </Select>
            {imageModel === 'z-image-turbo' && exampleUrls.length > 0 && (
              <p className="text-xs text-amber-500">
                ⚠️ Z-Image Turbo ne supporte pas les images de référence. Elles seront ignorées.
              </p>
            )}
          </div>
          </CollapsibleContent>
        </Collapsible>

          {/* Option pour éviter les prompts précédents */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="avoid-previous"
              checked={avoidPreviousPrompts}
              onCheckedChange={(checked) => setAvoidPreviousPrompts(checked === true)}
            />
            <Label htmlFor="avoid-previous" className="text-sm cursor-pointer">
              Éviter de répéter les idées des miniatures précédentes
            </Label>
          </div>

          {/* Bouton de génération */}
          <Button
            onClick={generateThumbnails}
            disabled={isGenerating}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              "Générer 5 miniatures"
            )}
          </Button>

          {/* Job progress indicator */}
          {getJobByType('thumbnails') && (
            <JobProgressIndicator job={getJobByType('thumbnails')!} />
          )}

          {/* Résultats de génération */}
          {generatedThumbnails.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-semibold">Miniatures générées</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {generatedThumbnails.map((url, index) => (
                  <div key={index} className="space-y-2">
                    <img
                      src={url}
                      alt={`Generated ${index + 1}`}
                      className="w-full aspect-video object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setPreviewImage(url)}
                    />
                    {generatedPrompts[index] && (
                      <div className="p-2 bg-muted rounded text-xs text-muted-foreground max-h-24 overflow-y-auto">
                        <p className="font-medium text-foreground mb-1">Prompt {index + 1}:</p>
                        {generatedPrompts[index]}
                      </div>
                    )}
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
      </div>

      {/* History section - displayed below */}
      {thumbnailHistory.length > 0 && (
        <div className="space-y-4 mt-8">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-semibold">Historique ({thumbnailHistory.length})</h4>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isUploadingThumbnail}
                onClick={() => document.getElementById('thumbnail-upload-input')?.click()}
              >
                {isUploadingThumbnail ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Importer
              </Button>
              <input
                id="thumbnail-upload-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleThumbnailUpload(e.target.files)}
              />
            </div>
          </div>
          {thumbnailHistory.map((item) => (
            <div key={item.id} className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString('fr-FR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {item.preset_name && (
                    <span className="text-xs font-medium text-primary">
                      {item.preset_name}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => deleteHistoryItem(item.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {item.thumbnail_urls.map((url, index) => (
                  <div key={index} className="space-y-1.5">
                    <div className="relative group">
                      <img
                        src={url}
                        alt={`History ${index + 1}`}
                        className="w-full aspect-video object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setPreviewImage(url)}
                      />
                      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditImageDialog(url);
                          }}
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Modifier
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadThumbnail(url, index);
                          }}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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
        <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] sm:w-full flex flex-col p-6">
          <div className="overflow-y-auto flex-1 min-h-0">
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
              <Label>Exemples actuels ({exampleUrls.length}) - <span className="text-muted-foreground font-normal">glisser pour réorganiser</span></Label>
              {exampleUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {exampleUrls.map((url, index) => (
                    <div 
                      key={url} 
                      className={`relative group cursor-grab active:cursor-grabbing ${draggedIndex === index ? 'opacity-50' : ''}`}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="absolute top-1 left-1 z-10 bg-black/50 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical className="w-4 h-4 text-white" />
                      </div>
                      <img
                        src={url}
                        alt={`Example ${index + 1}`}
                        className="w-full h-24 object-cover rounded border"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeExample(index)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors hover:border-primary hover:bg-primary/5 mt-2"
                onClick={() => document.getElementById('edit-example-upload')?.click()}
              >
                <input
                  id="edit-example-upload"
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files && handleExampleUpload(e.target.files)}
                />
                <Upload className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Ajouter des exemples</p>
              </div>
            </div>

            <div>
              <Label className="mb-2">Personnage de référence (optionnel)</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isDraggingCharacter ? 'border-primary bg-primary/10' : 'border-muted-foreground/25'
                }`}
                onDragOver={handleDragOverCharacter}
                onDragLeave={handleDragLeaveCharacter}
                onDrop={handleDropCharacter}
                onClick={() => document.getElementById('character-upload-edit')?.click()}
              >
                <input
                  id="character-upload-edit"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleCharacterUpload(e.target.files[0])}
                />
                <ImageIcon className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {characterRefUrl ? "Remplacer le personnage" : "Ajouter un personnage"}
                </p>
              </div>
              {characterRefUrl && (
                <div className="relative group mt-3 inline-block">
                  <img
                    src={characterRefUrl}
                    alt="Character"
                    className="w-32 h-32 object-cover rounded-lg border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); setCharacterRefUrl(""); }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            <div>
              <Label>Modèle de génération de prompts</Label>
              <Select value={textModel} onValueChange={setTextModel}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choisir un modèle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (Qualité)</SelectItem>
                  <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash (Rapide)</SelectItem>
                </SelectContent>
              </Select>
              {textModel === "claude-sonnet-4-6" && (
                <p className="text-xs text-muted-foreground mt-2 italic px-1">
                  ⚠️ Avec Claude, seule la première image sera envoyée en exemple. La qualité est par contre bien supérieure.
                </p>
              )}
            </div>

            <div>
              <Label>Modèle de génération d'image</Label>
              <Select value={imageModel} onValueChange={setImageModel}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choisir un modèle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai33-seedream-4.5">Seedream 4.5 via AI33 Pro (Recommandé)</SelectItem>
                  <SelectItem value="seedream-4.5">SeedDream 4.5 via Replicate</SelectItem>
                  <SelectItem value="seedream-5-lite">SeedDream 5.0 Lite</SelectItem>
                  <SelectItem value="ai33-gemini-image">Gemini Pro Image via AI33 Pro</SelectItem>
                  <SelectItem value="gemini-3-pro-image-preview">Gemini 3 Pro Image (Google)</SelectItem>
                  <SelectItem value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image (Google)</SelectItem>
                  <SelectItem value="seedream-4">SeedDream 4.0</SelectItem>
                  <SelectItem value="z-image-turbo">Z-Image Turbo (Rapide)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Prompt système</Label>
              <Textarea
                value={editCustomPrompt}
                onChange={(e) => setEditCustomPrompt(e.target.value)}
                rows={8}
                className="font-mono text-sm mt-2"
                placeholder="Prompt système personnalisé..."
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditCustomPrompt(DEFAULT_THUMBNAIL_PROMPT)}
                className="text-muted-foreground mt-1"
              >
                Réinitialiser au prompt par défaut
              </Button>
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

      {/* Edit Image Dialog */}
      <Dialog open={isEditImageDialogOpen} onOpenChange={setIsEditImageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la miniature</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Image à modifier</Label>
              <div className="mt-2 aspect-video bg-muted rounded-lg overflow-hidden">
                <img src={editingImageUrl} alt="Image à modifier" className="w-full h-full object-cover" />
              </div>
            </div>
            <div>
              <Label htmlFor="editPrompt">Instruction de modification</Label>
              <Textarea
                id="editPrompt"
                placeholder="Ex: Rendre l'arrière-plan plus sombre, ajouter un effet de lumière, changer la couleur du texte..."
                value={editingImagePrompt}
                onChange={(e) => setEditingImagePrompt(e.target.value)}
                rows={4}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditImageDialogOpen(false)} disabled={isEditingImage}>
              Annuler
            </Button>
            <Button onClick={editThumbnailImage} disabled={isEditingImage || !editingImagePrompt.trim()}>
              {isEditingImage ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Modification en cours...
                </>
              ) : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
