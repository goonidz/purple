import { useState, useEffect, useRef, useCallback } from "react";
import { parseStyleReferenceUrls, serializeStyleReferenceUrls } from "@/lib/styleReferenceHelpers";
import { parseTranscriptToScenes, TranscriptData, TranscriptSegment, Scene } from "@/lib/sceneParser";
import { DurationRange, DEFAULT_DURATION_RANGES, convertLegacyToRanges } from "@/lib/durationRanges";
import { sanitizeProjectName } from "@/lib/utils";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import { SceneGrid } from "@/components/SceneGrid";
import ImageSearchModal from "@/components/ImageSearchModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, Loader2, Image as ImageIcon, RefreshCw, Settings, Download, Video, Type, Check, Copy, FolderOpen, Pencil, AlertCircle, AlertTriangle, FileText, ArrowUp, MonitorPlay, Cloud, Trash2, Play, Sparkles, User as UserIcon, CheckCircle2, Clock, Maximize2, Calendar, ChevronDown, ChevronUp, Minimize2, Zap, RotateCcw, Plus } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { ProjectConfigurationModal } from "@/components/ProjectConfigurationModal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { 
  generatePremiereXML, 
  generateEDL, 
  generateCSV, 
  downloadFile, 
  downloadImagesAsZip,
  type ExportFormat,
  type ExportMode
} from "@/lib/videoExportHelpers";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { VideoPreview } from "@/components/VideoPreview";
import { AnimatorPreview } from "@/components/AnimatorPreview";
import { PresetManager } from "@/components/PresetManager";
import { ThumbnailGenerator } from "@/components/ThumbnailGenerator";
import { ThumbnailGeneratorV2 } from "@/components/ThumbnailGeneratorV2";
import { DurationRangesEditor } from "@/components/DurationRangesEditor";
import { SHORT_FORM_DURATION_RANGES } from "@/lib/durationRanges";
import { YouTubeMetadataTab } from "@/components/YouTubeMetadataTab";
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { useVideoRenderJobs, VideoRenderJob } from "@/hooks/useVideoRenderJobs";
import { useGpuRenderJobs } from "@/hooks/useGpuRenderJobs";
import { ActiveJobsBanner, ActiveVideoRenderJobsBanner, ActiveGpuRenderJobsBanner } from "@/components/JobProgressIndicator";
import { ExportPathPresetManager } from "@/components/ExportPathPresetManager";
import { renderVideo, type SubtitleSettings as RenderSubtitleSettings } from "@/lib/videoRender";
import { renderVideoGpu } from "@/lib/videoRenderGpu";

// TranscriptSegment, TranscriptData, and Scene are imported from @/lib/sceneParser

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
  videoUrl?: string;
  continuityGroupId?: number | null;
  manually_regenerated?: boolean;
  qa_checked?: boolean;
  qa_status?: 'OK' | 'REJECT';
  qa_explication?: string;
  qa_regeneration_prompt?: string;
  qa_regenerated?: boolean;
  qa_previous_rejection?: string;
  was_regenerated?: boolean;
  regenerated_prompt?: string;
}

// Fonction pour calculer les groupes si continuityGroupId manquant (rétrocompatibilité)
const calculateGroupsIfMissing = (prompts: GeneratedPrompt[]): GeneratedPrompt[] => {
  // Si tous les prompts ont déjà un continuityGroupId, retourner tel quel
  const allHaveGroupId = prompts.every(p => p?.continuityGroupId !== null && p?.continuityGroupId !== undefined);
  if (allHaveGroupId) {
    return prompts;
  }
  
  // Sinon, calculer les groupes en analysant les prompts avec reduce
  // (on utilise reduce au lieu de map pour pouvoir accéder aux éléments précédemment traités)
  let currentGroupId = 1;
  const updatedPrompts: GeneratedPrompt[] = [];
  
  for (let index = 0; index < prompts.length; index++) {
    const prompt = prompts[index];
    
    // Si déjà un groupId, le garder et mettre à jour currentGroupId si nécessaire
    if (prompt?.continuityGroupId !== null && prompt?.continuityGroupId !== undefined) {
      // Mettre à jour currentGroupId pour les prochaines scènes
      if (prompt.continuityGroupId > currentGroupId) {
        currentGroupId = prompt.continuityGroupId;
      }
      updatedPrompts.push(prompt);
      continue;
    }
    
    // Détecter continuité par pattern dans le prompt
    const promptText = prompt?.prompt?.toLowerCase() || '';
    const hasContinuityPattern = promptText.includes('same') || promptText.includes('keeping') || promptText.startsWith('same');
    
    // Si continuité détectée, utiliser le même groupe que la scène précédente
    if (hasContinuityPattern && index > 0) {
      const previousGroupId = updatedPrompts[index - 1]?.continuityGroupId;
      if (previousGroupId !== null && previousGroupId !== undefined) {
        updatedPrompts.push({
          ...prompt,
          continuityGroupId: previousGroupId
        });
        continue;
      }
    }
    
    // Nouveau groupe si première scène ou pas de continuité
    if (index === 0 || !hasContinuityPattern) {
      currentGroupId++;
    }
    
    updatedPrompts.push({
      ...prompt,
      continuityGroupId: currentGroupId
    });
  }
  
  return updatedPrompts;
};

const Index = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [calendarChannelName, setCalendarChannelName] = useState<string | null>(null);
  const [calendarChannelColor, setCalendarChannelColor] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [channelThumbnailVersion, setChannelThumbnailVersion] = useState<'v1' | 'v2' | 'both' | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([]);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [durationRanges, setDurationRanges] = useState<DurationRange[]>(DEFAULT_DURATION_RANGES);
  const [sceneFormat, setSceneFormat] = useState<"long" | "short">("long");
  
  // Legacy states for backward compatibility (derived from durationRanges)
  const sceneDuration0to1 = durationRanges[0]?.sceneDuration || 4;
  const sceneDuration1to3 = durationRanges[1]?.sceneDuration || 6;
  const sceneDuration3plus = durationRanges[durationRanges.length - 1]?.sceneDuration || 8;
  const range1End = durationRanges[0]?.endSeconds || 60;
  const range2End = durationRanges[1]?.endSeconds || 180;
  const [preferSentenceBoundaries, setPreferSentenceBoundaries] = useState(true);
  const [promptSystemMessage, setPromptSystemMessage] = useState<string>("");
  const [qaPrompt, setQaPrompt] = useState<string>("");
  const [showQAConfirmDialog, setShowQAConfirmDialog] = useState(false);
  const [scriptGenerationPrompt, setScriptGenerationPrompt] = useState<string | null>(null);
  const [isScriptCollapsed, setIsScriptCollapsed] = useState(false);
  const [isPromptCollapsed, setIsPromptCollapsed] = useState(false);
  const cancelGenerationRef = useRef(false);
  const cancelImageGenerationRef = useRef(false);
  const [imageWidth, setImageWidth] = useState<number>(1920);
  const [imageHeight, setImageHeight] = useState<number>(1080);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [imageModel, setImageModel] = useState<string>("seedream-4.5");
  const [loraUrl, setLoraUrl] = useState<string>("");
  const [loraSteps, setLoraSteps] = useState<number>(10);
  const [qaEnabled, setQaEnabled] = useState<boolean>(false);
  const [visualMode, setVisualMode] = useState<"images" | "gameplay">("images");
  const [gameplayUrls, setGameplayUrls] = useState<string[]>([]);
  const [gameplayUploading, setGameplayUploading] = useState(false);
  const [gameplayUploadProgress, setGameplayUploadProgress] = useState<{filename: string; percent: number; speed: string; loaded: number; total: number} | null>(null);
  const [gameplayLoadingFiles, setGameplayLoadingFiles] = useState(false);
  const [gameplayServerFiles, setGameplayServerFiles] = useState<{filename: string; url: string; sizeMB: number}[]>([]);
  const [visualContinuityEnabled, setVisualContinuityEnabled] = useState<boolean>(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatingImageIndices, setGeneratingImageIndices] = useState<Set<number>>(new Set());
  const [generatingPromptIndex, setGeneratingPromptIndex] = useState<number | null>(null);
  const [regeneratedScenes, setRegeneratedScenes] = useState<Set<number>>(new Set());
  
  // Helpers for managing generating image indices
  const addGeneratingImageIndex = (index: number) => {
    setGeneratingImageIndices(prev => new Set([...prev, index]));
  };
  
  const removeGeneratingImageIndex = (index: number) => {
    setGeneratingImageIndices(prev => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };
  const [styleReferenceUrls, setStyleReferenceUrls] = useState<string[]>([]);
  const [uploadedStyleImageUrl, setUploadedStyleImageUrl] = useState<string>("");
  const [isUploadingStyleImage, setIsUploadingStyleImage] = useState(false);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null);
  const [regeneratingPromptIndex, setRegeneratingPromptIndex] = useState<number | null>(null);
  const [confirmRegeneratePrompt, setConfirmRegeneratePrompt] = useState<number | null>(null);
  const [confirmRegenerateImage, setConfirmRegenerateImage] = useState<number | null>(null);
  const [confirmAnimateScene, setConfirmAnimateScene] = useState<number | null>(null);
  const [animatingSceneIndex, setAnimatingSceneIndex] = useState<number | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [imageSearchSceneIndex, setImageSearchSceneIndex] = useState<number>(0);
  const [imageSearchSceneText, setImageSearchSceneText] = useState<string>("");
  const [imageSearchPreviousScenes, setImageSearchPreviousScenes] = useState<string[]>([]);
  const [imageSearchNextScenes, setImageSearchNextScenes] = useState<string[]>([]);
  const [projectSummary, setProjectSummary] = useState<string | null>(null);
  const [projectScript, setProjectScript] = useState<string | null>(null);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  const [imageSearchPromptSystem, setImageSearchPromptSystem] = useState<string>("");
  const [confirmGenerateImages, setConfirmGenerateImages] = useState(false);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState<string>("");
  const [editingSceneIndex, setEditingSceneIndex] = useState<number | null>(null);
  const [editingSceneText, setEditingSceneText] = useState<string>("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("premiere-xml");
  const [exportMode, setExportMode] = useState<ExportMode>("with-images");
  const [exportFramerate, setExportFramerate] = useState<number>(10);
  const [exportEffectType, setExportEffectType] = useState<'opencv_zoom' | 'pan' | 'none'>('opencv_zoom');
  const [exportRenderMethod, setExportRenderMethod] = useState<'standard' | 'lanczos'>('standard');
  const [exportBasePath, setExportBasePath] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [useGpuRendering, setUseGpuRendering] = useState(true);

  // Render preset state
  const [renderPresets, setRenderPresets] = useState<any[]>([]);
  const [currentRenderPresetId, setCurrentRenderPresetId] = useState<string | null>(null);
  const [blackscreenUrl, setBlackscreenUrl] = useState<string | null>(null);
  const [blackscreenOpacity, setBlackscreenOpacity] = useState(0.45);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [animatorVideoUrl, setAnimatorVideoUrl] = useState<string | null>(null);
  const [isAnimatorGenerating, setIsAnimatorGenerating] = useState(false);
  const [isAnimatorChannel, setIsAnimatorChannel] = useState(false);
  const [animatorPipelineStatus, setAnimatorPipelineStatus] = useState<{ current_step: string; step_status: string } | null>(null);
  const [animatorTokens, setAnimatorTokens] = useState<{ input: number; output: number; cacheRead: number; cacheCreated: number } | null>(null);
  const [animatorCostUsd, setAnimatorCostUsd] = useState<number | null>(null);
  const [animatorSegments, setAnimatorSegments] = useState<{ start: number; end: number; text: string }[] | null>(null);
  const [animatorSegmentsProcessed, setAnimatorSegmentsProcessed] = useState<{ start: number; end: number; text: string }[] | null>(null);
  const [animatorSceneStatuses, setAnimatorSceneStatuses] = useState<{ scene_index: number; animator_code_status: string | null; animator_code: string | null }[]>([]);
  const [isRetryingScene, setIsRetryingScene] = useState<number | null>(null);
  const [expandedAnimatorScenes, setExpandedAnimatorScenes] = useState<Set<number>>(new Set());
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [thumbnailDialogOpen, setThumbnailDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("video");
  const [imageGenerationProgress, setImageGenerationProgress] = useState(0);
  const [imageGenerationTotal, setImageGenerationTotal] = useState(0);
  const [generationStatsDialog, setGenerationStatsDialog] = useState(false);
  const [generationStats, setGenerationStats] = useState<{
    generated: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const [missingImagesInfo, setMissingImagesInfo] = useState<{count: number, indices: number[]} | null>(null);
  const [upscaleInfo, setUpscaleInfo] = useState<{needsUpscale: number, alreadyUpscaled: number, highRes: number, indices: number[]} | null>(null);
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectNameValue, setEditingProjectNameValue] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showConfigurationModal, setShowConfigurationModal] = useState(false);

  // Ref to store thumbnail preset ID for semi-auto mode
  const thumbnailPresetIdRef = useRef<string | null>(null);
  // Ref to store whether thumbnail auto-chaining is enabled
  const thumbnailChainEnabledRef = useRef<boolean>(false);

  // Load thumbnail chain enabled flag from sessionStorage on mount
  useEffect(() => {
    const chainEnabled = sessionStorage.getItem("auto_thumbnail_chain_enabled");
    if (chainEnabled === "true") {
      thumbnailChainEnabledRef.current = true;
      // Clear after loading so it doesn't persist beyond the current session
      sessionStorage.removeItem("auto_thumbnail_chain_enabled");
    }
  }, []);

  // Set page title based on project name
  useEffect(() => {
    document.title = projectName || "Projet";
  }, [projectName]);

  // Use ref for currentProjectId to avoid stale closures in callbacks
  const currentProjectIdRef = useRef(currentProjectId);
  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  // Ref for startJob to use in callbacks without circular dependency
  const startJobRef = useRef<((jobType: any, metadata?: any) => Promise<any>) | null>(null);

  // Background job management
  const handleJobComplete = useCallback((job: GenerationJob) => {
    // Check if semi-auto mode is enabled and chain next job
    const metadata = job.metadata as { semiAutoMode?: boolean; thumbnailPresetId?: string; remainingAfterChunk?: number } | null;
    const isSemiAuto = metadata?.semiAutoMode === true;
    const thumbnailPresetId = metadata?.thumbnailPresetId || thumbnailPresetIdRef.current;
    const remainingAfterChunk = metadata?.remainingAfterChunk ?? 0;
    
    // For chunked jobs (prompts/images/upscale), only show completion notification on last chunk
    const isLastChunk = remainingAfterChunk === 0;
    
    // Show progress for intermediate chunks, full notification only for last chunk
    if (job.job_type === 'prompts' || job.job_type === 'images' || job.job_type === 'upscale') {
      if (!isLastChunk) {
        // Intermediate chunk - don't show final notification yet
        console.log(`${job.job_type} chunk complete, ${remainingAfterChunk} remaining`);
      } else {
        // Last chunk - show notification
        const messages: Record<string, string> = {
          'prompts': 'Prompts générés en arrière-plan !',
          'images': 'Images générées en arrière-plan !',
          'upscale': 'Images upscalées en 1920x1088 !'
        };
        toast.success(messages[job.job_type]);
      }
    } else {
      // Non-chunked jobs - always show notification
      const messages: Record<string, string> = {
        'transcription': 'Transcription terminée !',
        'thumbnails': 'Miniatures générées en arrière-plan !',
        'single_prompt': 'Prompt généré !',
        'single_image': 'Image générée !',
        'single_animation': 'Scène animée avec succès !',
        'qa': job.error_message ? `⚠️ QA terminé avec erreurs : ${job.error_message}` : `✅ Vérification QA terminée ! (${job.total} images vérifiées)`,
        'qa_regen': `${job.total} images régénérées après rejet QA !`
      };
      
      if (job.job_type === 'qa' && job.error_message) {
        toast.warning(messages[job.job_type]);
      } else {
        toast.success(messages[job.job_type] || 'Génération terminée !');
      }
    }
    
    // Reset generating states
    if (job.job_type === 'prompts') {
      // Only reset if last chunk
      if (isLastChunk) {
        setIsGeneratingPrompts(false);
      }
      
      // Semi-auto: backend already chains to images job, just update UI state (only on last chunk)
      if (isSemiAuto && isLastChunk) {
        toast.info("Génération des images en cours...");
        setIsGeneratingImages(true);
      }
    } else if (job.job_type === 'images') {
      // Only reset and show semi-auto notification if last chunk
      if (isLastChunk) {
        setIsGeneratingImages(false);
        
        // Semi-auto: backend already chains to thumbnails job if preset is set AND chaining is enabled
        if (isSemiAuto && thumbnailPresetId && thumbnailChainEnabledRef.current) {
          toast.info("Génération des miniatures en cours...");
        } else if (isSemiAuto && (!thumbnailPresetId || !thumbnailChainEnabledRef.current)) {
          const reason = !thumbnailPresetId ? "aucun preset sélectionné" : "génération automatique désactivée";
          toast.success(`🎉 Génération semi-automatique terminée (sans miniatures - ${reason}) !`);
        }
      }
    } else if (job.job_type === 'thumbnails') {
      // Semi-auto complete!
      if (isSemiAuto) {
        toast.success("🎉 Génération semi-automatique terminée !");
      }
    } else if (job.job_type === 'qa') {
      // Show chaining info for semi-auto
      if (isSemiAuto && !job.error_message) {
        // Check if there are rejected images (this info would be in the project data after reload)
        // For now, just show a generic chaining message
        toast.info("Traitement des images en cours...");
      }
    } else if (job.job_type === 'qa_regen') {
      // Show chaining info for semi-auto
      if (isSemiAuto) {
        toast.info("Upscaling en cours...");
      }
    } else if (job.job_type === 'upscale') {
      // Show chaining info for semi-auto (only on last chunk)
      if (isLastChunk) {
        if (isSemiAuto && thumbnailPresetId && thumbnailChainEnabledRef.current) {
          toast.info("Génération des miniatures en cours...");
        } else if (isSemiAuto && (!thumbnailPresetId || !thumbnailChainEnabledRef.current)) {
          const reason = !thumbnailPresetId ? "aucun preset sélectionné" : "génération automatique désactivée";
          toast.success(`🎉 Génération complète (sans miniatures - ${reason}) !`);
        }
      }
    } else if (job.job_type === 'single_prompt') {
      setGeneratingPromptIndex(null);
      setRegeneratingPromptIndex(null);
    } else if (job.job_type === 'single_image') {
      const sceneIndex = job.metadata?.sceneIndex;
      if (sceneIndex !== undefined && sceneIndex !== null) {
        removeGeneratingImageIndex(sceneIndex);
      }
    } else if (job.job_type === 'single_animation') {
      setAnimatingSceneIndex(null);
    }
    
    // Also clear scene indices for images jobs with sceneIndices (manual regeneration)
    if (job.job_type === 'images' && job.metadata?.sceneIndices && Array.isArray(job.metadata.sceneIndices)) {
      job.metadata.sceneIndices.forEach((idx: number) => removeGeneratingImageIndex(idx));
    }
    
    // Reload project data to get updated data - only for jobs that modify project data
    // Skip reload for single_animation as it's handled by the Edge Function directly
    const shouldReload = !['single_animation'].includes(job.job_type);
    const projectId = currentProjectIdRef.current;
    if (shouldReload && projectId) {
      // Fetch fresh data from BOTH project table AND project_scenes (robust source)
      Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("project_scenes").select("*").eq("project_id", projectId).order("scene_index", { ascending: true })
      ]).then(([projectRes, scenesRes]) => {
        const { data, error } = projectRes;
        if (error || !data) {
          console.error("Error reloading project data:", error);
          return;
        }
        
        // Update transcript data
        if (data.transcript_json) {
          setTranscriptData(data.transcript_json as unknown as TranscriptData);
        }
        
        // Update scenes
        const existingScenes = (data.scenes as unknown as Scene[]) || [];
        setScenes(existingScenes);
        
        // Update prompts - merge project_scenes (images) with scenes/prompts JSON (timing)
        let promptsWithGroups: GeneratedPrompt[];
        // Get timing data from project.scenes (source of truth for timing)
        const scenesJson = (data.scenes as any[]) || [];
        const promptsJson = (data.prompts as any[]) || [];
        
        if (scenesRes.data && scenesRes.data.length > 0) {
          // MERGE: timing from scenes JSON, images from project_scenes
          // Build map by scene_index to handle gaps in project_scenes
          const sceneMap = new Map<number, any>();
          for (const s of scenesRes.data) {
            sceneMap.set(s.scene_index, s);
          }
          const totalScenes = Math.max(scenesJson.length, promptsJson.length, (scenesRes.data[scenesRes.data.length - 1]?.scene_index ?? -1) + 1);
          const newPrompts: GeneratedPrompt[] = [];
          for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
            const s = sceneMap.get(sceneIdx);
            newPrompts[sceneIdx] = {
              scene: `Scène ${sceneIdx + 1}`,
              prompt: s?.prompt || promptsJson[sceneIdx]?.prompt,
              text: scenesJson[sceneIdx]?.text || promptsJson[sceneIdx]?.text || '',
              startTime: scenesJson[sceneIdx]?.startTime,
              endTime: scenesJson[sceneIdx]?.endTime,
              duration: scenesJson[sceneIdx]?.endTime && scenesJson[sceneIdx]?.startTime 
                ? scenesJson[sceneIdx].endTime - scenesJson[sceneIdx].startTime 
                : undefined,
              imageUrl: s ? (s.upscaled_url || s.image_url || promptsJson[sceneIdx]?.imageUrl) : promptsJson[sceneIdx]?.imageUrl,
              imageWidth: s?.image_width || promptsJson[sceneIdx]?.imageWidth,
              imageHeight: s?.image_height || promptsJson[sceneIdx]?.imageHeight,
              qa_checked: s ? (s.qa_checked ?? promptsJson[sceneIdx]?.qa_checked) : promptsJson[sceneIdx]?.qa_checked,
              qa_status: s?.qa_status || promptsJson[sceneIdx]?.qa_status,
              qa_explication: s?.qa_explication || promptsJson[sceneIdx]?.qa_explication,
              qa_regeneration_prompt: s?.qa_regeneration_prompt || promptsJson[sceneIdx]?.qa_regeneration_prompt,
              qa_previous_rejection: s?.qa_previous_rejection || promptsJson[sceneIdx]?.qa_previous_rejection,
              was_regenerated: s ? (s.was_regenerated ?? promptsJson[sceneIdx]?.was_regenerated) : promptsJson[sceneIdx]?.was_regenerated,
              manually_regenerated: promptsJson[sceneIdx]?.manually_regenerated ?? false,
              regenerated_prompt: s?.regenerated_prompt || promptsJson[sceneIdx]?.regenerated_prompt,
              isUpscaled: s ? (s.is_upscaled ?? promptsJson[sceneIdx]?.isUpscaled) : promptsJson[sceneIdx]?.isUpscaled,
              videoUrl: s?.video_url || promptsJson[sceneIdx]?.videoUrl,
              continuityGroupId: s?.continuity_group_id || promptsJson[sceneIdx]?.continuityGroupId
            };
          }
          promptsWithGroups = calculateGroupsIfMissing(newPrompts);
          console.log(`[handleJobComplete] Loaded ${promptsWithGroups.length} prompts from project_scenes (merged with legacy fallback)`);
        } else {
          // FALLBACK: legacy JSON
          const validPrompts = ((data.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null);
          promptsWithGroups = calculateGroupsIfMissing(validPrompts);
          console.log(`[handleJobComplete] Loaded ${promptsWithGroups.length} prompts from legacy JSON`);
        }
        setGeneratedPrompts(promptsWithGroups);
        
        // Load regenerated scenes state from prompts
        const regeneratedIndices = promptsWithGroups
          .map((p, idx) => p?.manually_regenerated ? idx : -1)
          .filter(idx => idx !== -1);
        setRegeneratedScenes(new Set(regeneratedIndices));
        
        // Update audio URL
        if (data.audio_url) {
          setAudioUrl(data.audio_url);
        }
        
        // Update image dimensions (especially important after upscale)
        if (data.image_width) {
          setImageWidth(data.image_width);
        }
        if (data.image_height) {
          setImageHeight(data.image_height);
        }
        if (data.aspect_ratio) {
          setAspectRatio(data.aspect_ratio);
        }
        
        // If transcription just completed and no scenes yet, show configuration modal
        if (job.job_type === 'transcription' && data.transcript_json && existingScenes.length === 0) {
          setShowConfigurationModal(true);
        }
      });
    } else if (job.job_type === 'single_animation' && projectId) {
      // For single_animation, wait a bit then refresh prompts to get the videoUrl
      // The polling in handleAnimateScene should have already updated the state,
      // but we refresh from DB to be sure
      setTimeout(() => {
        supabase
          .from("projects")
          .select("prompts")
          .eq("id", projectId)
          .single()
          .then(({ data, error }) => {
            if (!error && data?.prompts) {
              const validPrompts = ((data.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null);
              console.log(`[handleJobComplete] Reloaded prompts for single_animation, scene:`, job.metadata?.sceneIndex, 'videoUrl:', validPrompts[job.metadata?.sceneIndex as number]?.videoUrl);
              const promptsWithGroups = calculateGroupsIfMissing(validPrompts);
              setGeneratedPrompts(promptsWithGroups);
            } else if (error) {
              console.error(`[handleJobComplete] Error loading prompts:`, error);
            }
          });
      }, 1500); // Wait 1.5s to ensure check-animation-status has updated the project
    } else if (job.job_type === 'qa') {
      // Reload project data to show QA results
      const projectId = job.project_id;
      if (projectId) {
        console.log('[handleJobComplete] QA job done, reloading prompts for project:', projectId);
        
        // Reload prompts from database to show QA badges
        supabase
          .from("projects")
          .select("prompts")
          .eq("id", projectId)
          .single()
          .then(({ data, error }) => {
            if (!error && data?.prompts) {
              const validPrompts = ((data.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null && p !== undefined);
              console.log(`[handleJobComplete] Reloaded ${validPrompts.length} prompts after QA`);
              
              // Count QA results
              const withQA = validPrompts.filter(p => p?.qa_checked);
              const okCount = withQA.filter(p => p?.qa_status === 'OK').length;
              const rejectCount = withQA.filter(p => p?.qa_status === 'REJECT').length;
              console.log(`[handleJobComplete] QA results: ${okCount} OK, ${rejectCount} rejected, ${withQA.length} total checked`);
              
              const promptsWithGroups = calculateGroupsIfMissing(validPrompts);
              setGeneratedPrompts(promptsWithGroups);
              
              // Show detailed toast
              if (rejectCount > 0) {
                toast.info(`${rejectCount} image(s) rejetée(s) - voir badges rouges`, { duration: 5000 });
              }
            } else if (error) {
              console.error(`[handleJobComplete] Error loading prompts after QA:`, error);
            }
          });
      }
    }
  }, []);

  const handleJobFailed = useCallback((job: GenerationJob) => {
    toast.error(`Erreur: ${job.error_message || 'Génération échouée'}`);
    // Reset generating states
    if (job.job_type === 'prompts') {
      setIsGeneratingPrompts(false);
    } else if (job.job_type === 'images') {
      setIsGeneratingImages(false);
      // Also clear specific scene indices if this was a manual regeneration
      const sceneIndices = job.metadata?.sceneIndices;
      if (sceneIndices && Array.isArray(sceneIndices)) {
        sceneIndices.forEach((idx: number) => removeGeneratingImageIndex(idx));
      }
    } else if (job.job_type === 'single_prompt') {
      setGeneratingPromptIndex(null);
      setRegeneratingPromptIndex(null);
    } else if (job.job_type === 'single_image') {
      const sceneIndex = job.metadata?.sceneIndex;
      if (sceneIndex !== undefined && sceneIndex !== null) {
        removeGeneratingImageIndex(sceneIndex);
      }
    } else if (job.job_type === 'single_animation') {
      setAnimatingSceneIndex(null);
    }
  }, []);

  const { 
    activeJobs, 
    startJob, 
    cancelJob, 
    hasActiveJob,
    getJobByType
  } = useGenerationJobs({
    projectId: currentProjectId,
    onJobComplete: handleJobComplete,
    onJobFailed: handleJobFailed
  });

  const {
    activeJobs: activeVideoRenderJobs,
    allJobs: allVideoRenderJobs,
    refreshJobs: refreshVideoRenderJobs,
  } = useVideoRenderJobs({
    projectId: currentProjectId,
  });

  const {
    activeJobs: activeGpuRenderJobs,
    allJobs: allGpuRenderJobs,
    refreshJobs: refreshGpuRenderJobs,
  } = useGpuRenderJobs({
    projectId: currentProjectId,
  });

  // Debug logs
  useEffect(() => {
    console.log('Active video render jobs:', activeVideoRenderJobs.length, activeVideoRenderJobs);
    console.log('All video render jobs:', allVideoRenderJobs.length, allVideoRenderJobs);
    console.log('[GPU] Active GPU render jobs:', activeGpuRenderJobs.length, activeGpuRenderJobs);
    console.log('[GPU] All GPU render jobs:', allGpuRenderJobs.length, allGpuRenderJobs);
  }, [activeVideoRenderJobs, allVideoRenderJobs, activeGpuRenderJobs, allGpuRenderJobs]);

  // Keep startJobRef updated so handleJobComplete can use it
  useEffect(() => {
    startJobRef.current = startJob;
  }, [startJob]);

  // Sync generating states with active jobs
  useEffect(() => {
    setIsGeneratingPrompts(hasActiveJob('prompts'));
    setIsGeneratingImages(hasActiveJob('images'));
  }, [activeJobs, hasActiveJob]);

  // Scroll to top button visibility
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Check authentication
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Load project from URL parameter
  useEffect(() => {
    const projectId = searchParams.get("project");
    if (projectId) {
      setCurrentProjectId(projectId);
    }
  }, [searchParams]);

  // Track if semi-auto mode has been triggered for this session
  const hasSemiAutoStartedRef = useRef(false);

  // Handle semi-auto mode from URL parameter
  useEffect(() => {
    const semiAuto = searchParams.get("semi_auto");
    const projectId = searchParams.get("project");
    
    if (semiAuto === "true" && projectId && scenes.length > 0 && !hasSemiAutoStartedRef.current && !hasActiveJob()) {
      hasSemiAutoStartedRef.current = true;
      
      // Clear the URL params
      navigate(`/project?project=${projectId}`, { replace: true });
      
      // Start semi-automatic generation pipeline
      toast.info("Mode semi-automatique activé. Génération des prompts en cours...");
      
      startJob('prompts', { 
        regenerate: false,
        semiAutoMode: true,
        thumbnailPresetId: thumbnailPresetIdRef.current
      }).then((result) => {
        if (result) {
          setIsGeneratingPrompts(true);
        }
      });
    }
  }, [searchParams, scenes, hasActiveJob, navigate, startJob]);

  // Reset semi-auto flag when project changes
  useEffect(() => {
    hasSemiAutoStartedRef.current = false;
  }, [currentProjectId]);

  // Load project data when project is selected
  useEffect(() => {
    if (currentProjectId) {
      console.log("Loading project data for:", currentProjectId);
      loadProjectData(currentProjectId);
    } else {
      // Reset loaded flags when no project is selected
      projectDataLoadedRef.current = false;
      loadAttemptDoneRef.current = false;
    }
  }, [currentProjectId]);

  // Subscribe to realtime updates for calendar entries linked to this project
  useEffect(() => {
    if (!currentProjectId) return;

    const calendarChannel = supabase
      .channel(`project-calendar-${currentProjectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'content_calendar',
          filter: `project_id=eq.${currentProjectId}`
        },
        async (payload) => {
          console.log('Calendar entry updated for this project:', payload);
          const updatedEntry = payload.new as any;
          // If calendar entry title changed, update project name
          if (updatedEntry.title && updatedEntry.title !== projectName) {
            setProjectName(updatedEntry.title);
            console.log('Project name synchronized from calendar:', updatedEntry.title);
          }
          // Update calendar date if it changed
          if (updatedEntry.scheduled_date) {
            setCalendarDate(updatedEntry.scheduled_date);
          }
          // Update status if it changed
          if (updatedEntry.status) {
            setCalendarStatus(updatedEntry.status);
          }
          // Update channel info if channel_id changed
          if (updatedEntry.channel_id) {
            const { data: channelData } = await supabase
              .from('channels')
              .select('name, color')
              .eq('id', updatedEntry.channel_id)
              .single();
            if (channelData) {
              setCalendarChannelName(channelData.name);
              setCalendarChannelColor(channelData.color);
            }
          } else {
            setCalendarChannelName(null);
            setCalendarChannelColor(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(calendarChannel);
    };
  }, [currentProjectId, projectName]);

  // Poll for project updates to refresh images in real-time during generation
  useEffect(() => {
    if (!currentProjectId) return;

    let lastHash = "";

    const pollInterval = setInterval(async () => {
      try {
        // Fetch from legacy JSON AND new project_scenes table
        const [projectRes, scenesRes] = await Promise.all([
          supabase.from('projects').select('prompts, scenes').eq('id', currentProjectId).single(),
          supabase.from('project_scenes').select('*').eq('project_id', currentProjectId).order('scene_index', { ascending: true })
        ]);

        // Get timing data from project.scenes (source of truth for timing)
        const scenesJson = (projectRes.data?.scenes as any[]) || [];
        // Get existing prompts data for fields not in project_scenes
        const promptsJson = (projectRes.data?.prompts as any[]) || [];

        if (scenesRes.data && scenesRes.data.length > 0) {
          // MERGE: timing from scenes JSON, images from project_scenes, other fields from prompts JSON
          // Build a map by scene_index to avoid sequential array issues when rows are missing
          const scenesData = scenesRes.data;
          const sceneMap = new Map<number, any>();
          for (const s of scenesData) {
            sceneMap.set(s.scene_index, s);
          }
          
          // Build array using scene_index as the actual position (not row order)
          const totalScenes = Math.max(scenesJson.length, promptsJson.length, (scenesData[scenesData.length - 1]?.scene_index ?? -1) + 1);
          const newPrompts: GeneratedPrompt[] = [];
          for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
            const s = sceneMap.get(sceneIdx);
            newPrompts[sceneIdx] = {
              scene: `Scène ${sceneIdx + 1}`,
              prompt: s?.prompt || promptsJson[sceneIdx]?.prompt,
              text: scenesJson[sceneIdx]?.text || promptsJson[sceneIdx]?.text || '',
              startTime: scenesJson[sceneIdx]?.startTime,
              endTime: scenesJson[sceneIdx]?.endTime,
              duration: scenesJson[sceneIdx]?.endTime && scenesJson[sceneIdx]?.startTime 
                ? scenesJson[sceneIdx].endTime - scenesJson[sceneIdx].startTime 
                : undefined,
              imageUrl: s ? (s.upscaled_url || s.image_url || promptsJson[sceneIdx]?.imageUrl) : promptsJson[sceneIdx]?.imageUrl,
              imageWidth: s?.image_width || promptsJson[sceneIdx]?.imageWidth,
              imageHeight: s?.image_height || promptsJson[sceneIdx]?.imageHeight,
              qa_checked: s ? (s.qa_checked ?? promptsJson[sceneIdx]?.qa_checked) : promptsJson[sceneIdx]?.qa_checked,
              qa_status: s?.qa_status || promptsJson[sceneIdx]?.qa_status,
              qa_explication: s?.qa_explication || promptsJson[sceneIdx]?.qa_explication,
              qa_regeneration_prompt: s?.qa_regeneration_prompt || promptsJson[sceneIdx]?.qa_regeneration_prompt,
              qa_previous_rejection: s?.qa_previous_rejection || promptsJson[sceneIdx]?.qa_previous_rejection,
              was_regenerated: s ? (s.was_regenerated ?? promptsJson[sceneIdx]?.was_regenerated) : promptsJson[sceneIdx]?.was_regenerated,
              regenerated_prompt: s?.regenerated_prompt || promptsJson[sceneIdx]?.regenerated_prompt,
              isUpscaled: s ? (s.is_upscaled ?? promptsJson[sceneIdx]?.isUpscaled) : promptsJson[sceneIdx]?.isUpscaled,
              videoUrl: s?.video_url || promptsJson[sceneIdx]?.videoUrl,
              continuityGroupId: s?.continuity_group_id || promptsJson[sceneIdx]?.continuityGroupId,
              manually_regenerated: promptsJson[sceneIdx]?.manually_regenerated
            };
          }

          const newHash = JSON.stringify(newPrompts);
          if (newHash !== lastHash) {
            console.log('[RobustUI] Scenes updated from project_scenes (merged with legacy fallback)');
            setGeneratedPrompts(newPrompts);
            lastHash = newHash;
          }
        } else if (projectRes.data?.prompts) {
          // FALLBACK: Use legacy JSON array
          const legacyPrompts = projectRes.data.prompts as unknown as GeneratedPrompt[];
          const newHash = JSON.stringify(legacyPrompts);
          if (newHash !== lastHash) {
            console.log('[LegacyUI] Scenes updated from JSON prompts');
            setGeneratedPrompts(legacyPrompts);
            lastHash = newHash;
          }
        }
      } catch (error) {
        console.error('Error polling for images:', error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [currentProjectId]);

  // Sync animator generating state with generation_jobs
  useEffect(() => {
    setIsAnimatorGenerating(hasActiveJob('animator_scenes' as any));
  }, [activeJobs, hasActiveJob]);

  // Poll animator pipeline status (render steps) + video URL + per-scene code statuses
  useEffect(() => {
    if (!currentProjectId || !isAnimatorChannel) {
      setAnimatorPipelineStatus(null);
      setAnimatorSceneStatuses([]);
      return;
    }
    let cancelled = false;
    let failureToasted = false;
    const poll = async () => {
      const [pipelineRes, projRes, scenesRes] = await Promise.all([
        (supabase.from("auto_pipelines" as any) as any)
          .select("current_step, step_status, error")
          .eq("project_id", currentProjectId)
          .in("current_step", ["animator_render", "wait_animator_render", "completed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
        supabase.from('projects').select('animator_video_url, animator_tokens, animator_cost_usd').eq('id', currentProjectId).single(),
        supabase.from('project_scenes')
          .select('scene_index, animator_code_status, animator_code')
          .eq('project_id', currentProjectId)
          .not('animator_code_status', 'is', null)
          .order('scene_index', { ascending: true }),
      ]);
      if (cancelled) return;
      const data = pipelineRes.data;
      setAnimatorPipelineStatus(data || null);
      if (data?.step_status === 'failed') {
        if (!failureToasted) {
          failureToasted = true;
          toast.error("Rendu Animator échoué: " + String(data?.error || 'erreur inconnue').slice(0, 200));
        }
      } else if (data && data.step_status !== 'failed') {
        failureToasted = false;
      }
      if (projRes.data?.animator_video_url) {
        setAnimatorVideoUrl(projRes.data.animator_video_url);
      }
      if (projRes.data?.animator_tokens) setAnimatorTokens(projRes.data.animator_tokens);
      if (projRes.data?.animator_cost_usd != null) setAnimatorCostUsd(Number(projRes.data.animator_cost_usd));
      if (scenesRes.data) setAnimatorSceneStatuses(scenesRes.data);
    };
    poll();
    const iv = setInterval(poll, 3_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [currentProjectId, isAnimatorChannel]);

  // Auto-save project data when it changes
  // Note: prompts are NOT included here because they are managed by the backend job queue
  useEffect(() => {
    if (currentProjectId) {
      const timeoutId = setTimeout(() => {
        saveProjectData();
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [currentProjectId, transcriptData, examplePrompts, scenes, durationRanges, styleReferenceUrls, audioUrl, imageWidth, imageHeight, aspectRatio, imageModel, loraUrl, loraSteps, promptSystemMessage, imageSearchPromptSystem]);

  // Track if we've already shown the config modal for this session
  const hasShownConfigModalRef = useRef(false);
  // Track if project data was SUCCESSFULLY loaded (guards auto-save from overwriting DB with empty state)
  const projectDataLoadedRef = useRef(false);
  // Track if load attempt finished (success or error) for UI loading spinner
  const loadAttemptDoneRef = useRef(false);
  const [, forceRender] = useState(0);
  
  // Show configuration modal if project has transcript but no scenes AND no prompts (only once per session)
  // IMPORTANT: Don't show if semi_auto mode is active (user just came from project creation workflow)
  // Also don't show if prompts already exist - this means the project was already processed
  useEffect(() => {
    const semiAuto = searchParams.get("semi_auto");
    
    // Don't show modal if semi_auto mode is active - user already configured in the creation workflow
    if (semiAuto === "true") {
      hasShownConfigModalRef.current = true;
      return;
    }
    
    // Check if configure=true param is set (e.g., from Inworld TTS with timestamps)
    const shouldConfigure = searchParams.get("configure") === "true";
    
    // Don't show if prompts already exist - project is already complete
    if (generatedPrompts.length > 0) {
      return;
    }

    // Don't show scene config for animator channels — scenes come from Groq segments
    if (isAnimatorChannel) {
      return;
    }
    
    // Force open modal when configure param is present (bypass projectDataLoaded check)
    if (shouldConfigure && transcriptData && scenes.length === 0 && currentProjectId && !hasShownConfigModalRef.current) {
      const timer = setTimeout(() => {
        setShowConfigurationModal(true);
        hasShownConfigModalRef.current = true;
        // Remove the configure param from URL
        const newParams = new URLSearchParams(searchParams);
        newParams.delete("configure");
        navigate(`/project?${newParams.toString()}`, { replace: true });
      }, 500);
      return () => clearTimeout(timer);
    }
    
    // Only show modal after project data has been loaded at least once (for normal flow)
    if (!projectDataLoadedRef.current) return;
    
    if (transcriptData && scenes.length === 0 && currentProjectId && !hasActiveJob('transcription') && !hasShownConfigModalRef.current) {
      // Small delay to allow UI to settle
      const timer = setTimeout(() => {
        setShowConfigurationModal(true);
        hasShownConfigModalRef.current = true;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [transcriptData, scenes, generatedPrompts, currentProjectId, hasActiveJob, searchParams, navigate, isAnimatorChannel]);
  
  // Reset the flag when project changes
  useEffect(() => {
    hasShownConfigModalRef.current = false;
    projectDataLoadedRef.current = false;
    loadAttemptDoneRef.current = false;
  }, [currentProjectId]);

  const loadProjectData = async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;

      // Clean up any stale VPS script job IDs
      try { localStorage.removeItem(`vps_script_job_${projectId}`); } catch (_) {}

      // Check if this is a "from scratch" project that needs to continue the workflow
      const hasScript = (data.script && data.script.length > 100) || (data.summary && data.summary.length > 100);
      const hasAudio = !!data.audio_url;
      const hasTranscript = data.transcript_json && Object.keys(data.transcript_json).length > 0;
      const hasScenes = Array.isArray(data.scenes) && data.scenes.length > 0;
      
      if (hasScript && !hasAudio && !hasTranscript) {
        navigate(`/create-from-scratch?continue=${projectId}`);
        return;
      }

      // Project has nothing yet — redirect to create-from-scratch to start/continue the workflow
      if (!hasScript && !hasAudio && !hasTranscript && !hasScenes) {
        navigate(`/create-from-scratch?continue=${projectId}`);
        return;
      }
      
      if (hasAudio && !hasTranscript && !hasScenes) {
        console.log("[loadProjectData] Project has audio but no transcript - needs transcription");
      }

      setProjectName(data.name || "");
      setProjectSummary(data.summary || null);
      setProjectScript(data.script || null);
      
      // Load transcript data
      if (data.transcript_json) {
        console.log("Loading transcript data, scenes count:", (data.scenes as any[])?.length || 0);
        setTranscriptData(data.transcript_json as unknown as TranscriptData);
      } else {
        console.log("No transcript data found in project");
        setTranscriptData(null);
      }
      
      const prompts = (data.example_prompts as string[]) || ["", "", ""];
      setExamplePrompts(Array.isArray(prompts) ? prompts : ["", "", ""]);
      
      // Load duration ranges - prefer new format, fallback to legacy
      const projectData = data as any;
      if (projectData.duration_ranges && Array.isArray(projectData.duration_ranges) && projectData.duration_ranges.length > 0) {
        setDurationRanges(projectData.duration_ranges);
      } else {
        // Convert legacy format to new format
        const legacyRanges = convertLegacyToRanges(
          data.scene_duration_0to1 || 4,
          data.scene_duration_1to3 || 6,
          data.scene_duration_3plus || 8,
          projectData.range_end_1 || 60,
          projectData.range_end_2 || 180
        );
        setDurationRanges(legacyRanges);
      }
      
      // Load existing scenes - don't auto-generate, let user configure first
      const existingScenes = (data.scenes as unknown as Scene[]) || [];
      setScenes(existingScenes);
      
      // Fetch from project_scenes table (source of truth for images)
      const { data: projectScenesData } = await supabase
        .from('project_scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('scene_index', { ascending: true });
      
      // Get timing data from project.scenes and legacy prompts
      const scenesJson = (data.scenes as any[]) || [];
      const promptsJson = (data.prompts as any[]) || [];
      
      let promptsWithGroups: GeneratedPrompt[];
      
      if (projectScenesData && projectScenesData.length > 0) {
        // MERGE: timing from scenes JSON, images from project_scenes
        // Build map by scene_index to handle gaps in project_scenes
        const sceneMap = new Map<number, any>();
        for (const s of projectScenesData) {
          sceneMap.set(s.scene_index, s);
        }
        const totalScenes = Math.max(scenesJson.length, promptsJson.length, (projectScenesData[projectScenesData.length - 1]?.scene_index ?? -1) + 1);
        const newPrompts: GeneratedPrompt[] = [];
        for (let sceneIdx = 0; sceneIdx < totalScenes; sceneIdx++) {
          const s = sceneMap.get(sceneIdx);
          newPrompts[sceneIdx] = {
            scene: `Scène ${sceneIdx + 1}`,
            prompt: s?.prompt || promptsJson[sceneIdx]?.prompt,
            text: scenesJson[sceneIdx]?.text || promptsJson[sceneIdx]?.text || '',
            startTime: scenesJson[sceneIdx]?.startTime,
            endTime: scenesJson[sceneIdx]?.endTime,
            duration: scenesJson[sceneIdx]?.endTime && scenesJson[sceneIdx]?.startTime 
              ? scenesJson[sceneIdx].endTime - scenesJson[sceneIdx].startTime 
              : undefined,
            imageUrl: s ? (s.upscaled_url || s.image_url || promptsJson[sceneIdx]?.imageUrl) : promptsJson[sceneIdx]?.imageUrl,
            imageWidth: s?.image_width || promptsJson[sceneIdx]?.imageWidth,
            imageHeight: s?.image_height || promptsJson[sceneIdx]?.imageHeight,
            qa_checked: s ? (s.qa_checked ?? promptsJson[sceneIdx]?.qa_checked) : promptsJson[sceneIdx]?.qa_checked,
            qa_status: s?.qa_status || promptsJson[sceneIdx]?.qa_status,
            qa_explication: s?.qa_explication || promptsJson[sceneIdx]?.qa_explication,
            qa_regeneration_prompt: s?.qa_regeneration_prompt || promptsJson[sceneIdx]?.qa_regeneration_prompt,
            qa_previous_rejection: s?.qa_previous_rejection || promptsJson[sceneIdx]?.qa_previous_rejection,
            was_regenerated: s ? (s.was_regenerated ?? promptsJson[sceneIdx]?.was_regenerated) : promptsJson[sceneIdx]?.was_regenerated,
            manually_regenerated: promptsJson[sceneIdx]?.manually_regenerated ?? false,
            regenerated_prompt: s?.regenerated_prompt || promptsJson[sceneIdx]?.regenerated_prompt,
            isUpscaled: s ? (s.is_upscaled ?? promptsJson[sceneIdx]?.isUpscaled) : promptsJson[sceneIdx]?.isUpscaled,
            videoUrl: s?.video_url || promptsJson[sceneIdx]?.videoUrl,
            continuityGroupId: s?.continuity_group_id || promptsJson[sceneIdx]?.continuityGroupId
          };
        }
        promptsWithGroups = calculateGroupsIfMissing(newPrompts);
        console.log(`[loadProjectData] Loaded ${promptsWithGroups.length} prompts from project_scenes (merged with legacy fallback)`);
      } else {
        // FALLBACK: Use legacy JSON array
        const validPrompts = ((data.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null && p !== undefined);
        promptsWithGroups = calculateGroupsIfMissing(validPrompts);
        console.log(`[loadProjectData] Loaded ${promptsWithGroups.length} prompts from legacy JSON`);
      }
      setGeneratedPrompts(promptsWithGroups);
      
      // Load regenerated scenes state from prompts
      const regeneratedIndices = promptsWithGroups
        .map((p, idx) => p?.manually_regenerated ? idx : -1)
        .filter(idx => idx !== -1);
      setRegeneratedScenes(new Set(regeneratedIndices));
      
      // Load image dimensions and aspect ratio
      if (projectData.image_width) setImageWidth(projectData.image_width);
      if (projectData.image_height) setImageHeight(projectData.image_height);
      if (projectData.aspect_ratio) setAspectRatio(projectData.aspect_ratio);
      if (projectData.image_model) setImageModel(projectData.image_model);
      if (projectData.lora_url) setLoraUrl(projectData.lora_url);
      if (projectData.lora_steps) setLoraSteps(projectData.lora_steps);
      setQaEnabled((projectData as any).qa_enabled === true);
      if ((projectData as any).visual_mode) setVisualMode((projectData as any).visual_mode);
      if ((projectData as any).gameplay_urls && Array.isArray((projectData as any).gameplay_urls)) setGameplayUrls((projectData as any).gameplay_urls);
      if (projectData.visual_continuity_enabled !== undefined) setVisualContinuityEnabled(projectData.visual_continuity_enabled);
      if (projectData.prompt_system_message) {
        setPromptSystemMessage(projectData.prompt_system_message);
      } else if (projectData.prompts && Array.isArray(projectData.prompts) && projectData.prompts.length > 0) {
        // Project has prompts but no system message - trigger backfill
        supabase.functions.invoke('backfill-prompt-system', {}).then(async () => {
          // Reload project to get the updated prompt_system_message
          const { data: updatedProject } = await supabase
            .from('projects')
            .select('prompt_system_message')
            .eq('id', currentProjectId)
            .single();

          if (updatedProject?.prompt_system_message) {
            setPromptSystemMessage(updatedProject.prompt_system_message);
          }
        }).catch(err => {
          console.log('Backfill failed:', err);
        });
        // Set default message for display while backfill is running
      }
      
      // Load image search prompt system
      if (projectData.image_search_prompt_system) {
        setImageSearchPromptSystem(projectData.image_search_prompt_system);
      }

      // Try to find script generation prompt from generation_jobs or pending_predictions
      if (currentProjectId) {
        // First try generation_jobs (this is where the customPrompt is stored when creating the job)
        const { data: scriptJobs, error: scriptJobsError } = await supabase
          .from('generation_jobs')
          .select('metadata, id')
          .eq('project_id', currentProjectId)
          .eq('job_type', 'script_generation')
          .order('created_at', { ascending: false })
          .limit(1);
        
        console.log('Script jobs found:', scriptJobs, 'Error:', scriptJobsError);
        
        let foundPrompt = false;
        
        if (scriptJobs && scriptJobs.length > 0) {
          console.log('Script job metadata:', scriptJobs[0].metadata);
          if (scriptJobs[0].metadata?.customPrompt) {
            console.log('Setting script generation prompt from generation_jobs:', scriptJobs[0].metadata.customPrompt);
            setScriptGenerationPrompt(scriptJobs[0].metadata.customPrompt);
            foundPrompt = true;
          } else {
            console.log('No customPrompt in generation_jobs metadata, trying pending_predictions via job_id');
            
            // Fallback: try pending_predictions using job_id
            const jobId = scriptJobs[0].id;
            const { data: predictions } = await supabase
              .from('pending_predictions')
              .select('metadata')
              .eq('job_id', jobId)
              .eq('prediction_type', 'script')
              .order('created_at', { ascending: false })
              .limit(1);
            
            console.log('Pending predictions found for job_id:', jobId, predictions);
            
            if (predictions && predictions.length > 0 && predictions[0].metadata?.customPrompt) {
              console.log('Setting script generation prompt from pending_predictions (via job_id):', predictions[0].metadata.customPrompt);
              setScriptGenerationPrompt(predictions[0].metadata.customPrompt);
              foundPrompt = true;
            }
          }
        }
        
        // If still not found, try pending_predictions directly by project_id
        if (!foundPrompt) {
          console.log('Trying pending_predictions directly by project_id');
          const { data: predictions } = await supabase
            .from('pending_predictions')
            .select('metadata')
            .eq('project_id', currentProjectId)
            .eq('prediction_type', 'script')
            .order('created_at', { ascending: false })
            .limit(1);
          
          console.log('Pending predictions found by project_id:', predictions);
          
          if (predictions && predictions.length > 0 && predictions[0].metadata?.customPrompt) {
            console.log('Setting script generation prompt from pending_predictions (via project_id):', predictions[0].metadata.customPrompt);
            setScriptGenerationPrompt(predictions[0].metadata.customPrompt);
          } else {
            console.log('No script generation prompt found in any location');
          }
        }
      }
      
      const parsedUrls = parseStyleReferenceUrls(data.style_reference_url);
      setStyleReferenceUrls(parsedUrls);
      if (parsedUrls.length > 0) {
        setUploadedStyleImageUrl(parsedUrls[0]);
      }
      console.log('[loadProjectData] animator_video_url from DB:', data.animator_video_url);
      setAnimatorVideoUrl(data.animator_video_url || null);
      if (data.animator_tokens) setAnimatorTokens(data.animator_tokens);
      if (data.animator_cost_usd != null) setAnimatorCostUsd(Number(data.animator_cost_usd));
      if (data.animator_segments?.segments) setAnimatorSegments(data.animator_segments.segments);
      if ((data as any).animator_segments_processed?.segments) setAnimatorSegmentsProcessed((data as any).animator_segments_processed.segments);
      if (data.audio_url) {
        setAudioUrl(data.audio_url);
      } else if (existingScenes.length > 0) {
        // Fallback: try to load audio from content_calendar if project has scenes but no audio
        const { data: calendarEntries } = await supabase
          .from("content_calendar")
          .select("audio_url")
          .eq("project_id", projectId)
          .not('audio_url', 'is', null)
          .limit(1);
        
        if (calendarEntries && calendarEntries.length > 0 && calendarEntries[0].audio_url) {
          console.log("Loading audio from calendar entry:", calendarEntries[0].audio_url);
          setAudioUrl(calendarEntries[0].audio_url);
        }
      }
      
      // Load user's saved export base path
      loadExportBasePath();
      
      // Load thumbnail preset ID for semi-auto mode
      if (projectData.thumbnail_preset_id) {
        thumbnailPresetIdRef.current = projectData.thumbnail_preset_id;
      }

      // Load render preset from project
      if (projectData.render_preset_id) {
        const { data: rp } = await supabase
          .from('render_presets' as any)
          .select('*')
          .eq('id', projectData.render_preset_id)
          .single();
        if (rp) {
          setCurrentRenderPresetId(rp.id);
          setExportFramerate(rp.framerate);
          setExportEffectType(rp.effect_type);
          setUseGpuRendering(rp.use_gpu);
          setBlackscreenUrl(rp.blackscreen_url);
          setBlackscreenOpacity(rp.blackscreen_opacity);
          console.log('[loadProjectData] Loaded render preset:', rp.name);
        }
      }
      
      // Load calendar date and channel if project is linked to calendar
      const { data: calendarEntries, error: calendarError } = await supabase
        .from("content_calendar")
        .select("scheduled_date, id, channel_id, status, audio_url, channels(name, color, project_preset_id, render_preset_id, thumbnail_preset_id, thumbnail_v2_preset_id, animator_preset_id)")
        .eq("project_id", projectId);
      
      if (calendarError) {
        console.error("Error loading calendar date:", calendarError);
        setCalendarDate(null);
        setCalendarChannelName(null);
        setCalendarChannelColor(null);
        setCalendarStatus(null);
        setChannelThumbnailVersion(null);
      } else {
        console.log("Calendar entries for project:", calendarEntries);
        // Get the first entry with a scheduled_date
        const entryWithDate = calendarEntries?.find(entry => entry.scheduled_date);
        const scheduledDate = entryWithDate?.scheduled_date || null;
        console.log("Setting calendar date:", scheduledDate, "from entry:", entryWithDate);
        setCalendarDate(scheduledDate);
        
        // Get channel info from calendar entry
        const entryWithChannel = calendarEntries?.find(entry => entry.channel_id && entry.channels);
        if (entryWithChannel && entryWithChannel.channels) {
          const channelData = entryWithChannel.channels as { name: string; color: string; project_preset_id?: string; render_preset_id?: string; thumbnail_preset_id?: string; thumbnail_v2_preset_id?: string; animator_preset_id?: string };
          setCalendarChannelName(channelData.name);
          setCalendarChannelColor(channelData.color);

          const hasV1 = !!channelData.thumbnail_preset_id;
          const hasV2 = !!channelData.thumbnail_v2_preset_id;
          setChannelThumbnailVersion(hasV1 && hasV2 ? 'both' : hasV1 ? 'v1' : hasV2 ? 'v2' : null);

          if (channelData.animator_preset_id) {
            const { data: animPreset } = await (supabase.from("animator_presets" as any) as any).select("enabled").eq("id", channelData.animator_preset_id).single();
            setIsAnimatorChannel(!!(animPreset as any)?.enabled);
          } else {
            setIsAnimatorChannel(false);
          }

          // Load render preset from channel if project doesn't have one
          if (!projectData.render_preset_id && channelData.render_preset_id) {
            const { data: rp } = await supabase
              .from('render_presets' as any)
              .select('*')
              .eq('id', channelData.render_preset_id)
              .single();
            if (rp) {
              setCurrentRenderPresetId(rp.id);
              setExportFramerate(rp.framerate);
              setExportEffectType(rp.effect_type);
              setUseGpuRendering(rp.use_gpu);
              setBlackscreenUrl(rp.blackscreen_url);
              setBlackscreenOpacity(rp.blackscreen_opacity);
              await supabase
                .from('projects')
                .update({ render_preset_id: channelData.render_preset_id } as any)
                .eq('id', projectId);
              console.log('[loadProjectData] Loaded render preset from channel:', rp.name);
            }
          }
          
          // Load preset from channel OR from project's saved preset_id
          const presetIdToLoad = projectData.preset_id || channelData.project_preset_id;
          if (presetIdToLoad) {
            console.log('[loadProjectData] Loading preset:', presetIdToLoad, projectData.preset_id ? '(from project)' : '(from channel)');
            const { data: preset } = await supabase
              .from('presets')
              .select('*')
              .eq('id', presetIdToLoad)
              .single();
            
            if (preset) {
              // Apply preset settings to UI only if project doesn't have custom values
              // This allows presets to set defaults while letting users override them
              if (!projectData.image_width) setImageWidth(preset.image_width);
              if (!projectData.image_height) setImageHeight(preset.image_height);
              if (!projectData.aspect_ratio) setAspectRatio(preset.aspect_ratio);
              if (!projectData.image_model) setImageModel(preset.image_model);
              if (!projectData.lora_url) setLoraUrl((preset as any).lora_url || "");
              if (!projectData.lora_steps) setLoraSteps((preset as any).lora_steps || 10);
              if (!projectData.prompt_system_message) setPromptSystemMessage((preset as any).prompt_system_message || "");
              // QA prompt always from preset (not editable per-project yet)
              setQaPrompt((preset as any).qa_prompt || "");
              if (!projectData.style_reference_url && (preset as any).style_reference_url) {
                setStyleReferenceUrls(parseStyleReferenceUrls((preset as any).style_reference_url));
              }
              if (!projectData.example_prompts && (preset as any).example_prompts) {
                setExamplePrompts((preset as any).example_prompts);
              }
              setActivePresetName(preset.name);
              setCurrentPresetId(presetIdToLoad);
              
              // Save preset_id to project if not already set (for backend LoRA loading)
              if (!projectData.preset_id && channelData.project_preset_id) {
                await supabase
                  .from('projects')
                  .update({ preset_id: channelData.project_preset_id } as any)
                  .eq('id', projectId);
              }
              
              console.log('[loadProjectData] Preset loaded:', preset.name);
            }
          }
        } else {
          setCalendarChannelName(null);
          setCalendarChannelColor(null);
          setIsAnimatorChannel(false);
        }
        
        // Get status from calendar entry
        const entryWithStatus = calendarEntries?.find(entry => entry.status);
        setCalendarStatus(entryWithStatus?.status || null);
      }
      
      // Mark that project data has been loaded successfully
      projectDataLoadedRef.current = true;
      loadAttemptDoneRef.current = true;
    } catch (error: any) {
      console.error("Error loading project:", error);
      toast.error("Erreur lors du chargement du projet");
      loadAttemptDoneRef.current = true;
      forceRender(n => n + 1);
    }
  };

  const saveProjectData = async () => {
    if (!currentProjectId) return;
    if (!projectDataLoadedRef.current) return;

    try {
      // Note: prompts are NOT saved here - they are managed by the backend job queue
      const { error } = await supabase
        .from("projects")
        .update({
          ...(transcriptData ? { transcript_json: transcriptData as any } : {}),
          ...(examplePrompts && examplePrompts.some(p => p) ? { example_prompts: examplePrompts as any } : {}),
          ...(scenes && scenes.length > 0 ? { scenes: scenes as any } : {}),
          duration_ranges: durationRanges as any,
          // Legacy columns for backward compatibility
          scene_duration_0to1: sceneDuration0to1,
          scene_duration_1to3: sceneDuration1to3,
          scene_duration_3plus: sceneDuration3plus,
          range_end_1: range1End,
          range_end_2: range2End,
          image_width: imageWidth,
          image_height: imageHeight,
          aspect_ratio: aspectRatio,
          image_model: imageModel,
          lora_url: loraUrl || null,
          lora_steps: loraSteps,
          qa_enabled: qaEnabled,
          visual_mode: visualMode,
          gameplay_urls: visualMode === 'gameplay' && gameplayUrls.length > 0 ? gameplayUrls : null,
          style_reference_url: serializeStyleReferenceUrls(styleReferenceUrls),
          ...(audioUrl ? { audio_url: audioUrl } : {}),
          prompt_system_message: promptSystemMessage || null,
          image_search_prompt_system: imageSearchPromptSystem || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;
    } catch (error: any) {
      console.error("Error saving project:", error);
    }
  };

  // Load user's saved export base path from database
  const loadExportBasePath = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('export_base_path')
        .eq('user_id', user.id)
        .single();
      
      if (!error && data?.export_base_path) {
        setExportBasePath(data.export_base_path);
      }
    } catch (error) {
      console.error("Error loading export base path:", error);
    }
  };

  // Save user's export base path to database
  const saveExportBasePath = async (path: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { error } = await supabase
        .from('user_api_keys')
        .upsert({
          user_id: user.id,
          export_base_path: path,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });
      
      if (error) throw error;
    } catch (error) {
      console.error("Error saving export base path:", error);
    }
  };

  const loadRenderPresets = async () => {
    try {
      const { data, error } = await supabase
        .from('render_presets' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) setRenderPresets(data as any[]);
    } catch {}
  };

  useEffect(() => { loadRenderPresets(); }, []);

  const applyRenderPreset = async (presetId: string | null) => {
    setCurrentRenderPresetId(presetId);
    if (!presetId) {
      setBlackscreenUrl(null);
      setBlackscreenOpacity(0.45);
      return;
    }
    const preset = renderPresets.find((p: any) => p.id === presetId);
    if (preset) {
      setExportFramerate(preset.framerate);
      setExportEffectType(preset.effect_type);
      setUseGpuRendering(preset.use_gpu);
      setBlackscreenUrl(preset.blackscreen_url);
      setBlackscreenOpacity(preset.blackscreen_opacity);
    }
    if (currentProjectId) {
      await supabase
        .from('projects')
        .update({ render_preset_id: presetId } as any)
        .eq('id', currentProjectId);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const formatTimecode = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // parseTranscriptToScenes is imported from @/lib/sceneParser

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== "application/json") {
        toast.error("Veuillez sélectionner un fichier JSON");
        return;
      }
      setTranscriptFile(file);
      toast.success("Fichier chargé avec succès");
    }
  };

  const handleSaveProjectName = async () => {
    if (!currentProjectId || !editingProjectNameValue.trim()) return;
    
    try {
      const newName = editingProjectNameValue.trim();
      
      // Update project name
      const { error: projectError } = await supabase
        .from("projects")
        .update({ name: newName })
        .eq("id", currentProjectId);

      if (projectError) throw projectError;
      
      // Also update title in content_calendar if this project is linked to a calendar entry
      const { error: calendarError } = await supabase
        .from("content_calendar")
        .update({ title: newName })
        .eq("project_id", currentProjectId);

      if (calendarError) {
        console.warn("Could not update calendar entry title:", calendarError);
        // Don't throw - project update succeeded, calendar update is optional
      }
      
      setProjectName(newName);
      setIsEditingProjectName(false);
      setEditingProjectNameValue("");
      toast.success("Titre mis à jour");
    } catch (error: any) {
      console.error("Error updating project name:", error);
      toast.error("Erreur lors de la mise à jour du titre");
    }
  };

  const handleGenerateScenes = async () => {
    if (!transcriptFile) {
      toast.error("Veuillez d'abord charger un fichier de transcription");
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    setIsGeneratingScenes(true);
    try {
      const fileContent = await transcriptFile.text();
      const data: TranscriptData = JSON.parse(fileContent);
      setTranscriptData(data);
      
      const generatedScenes = parseTranscriptToScenes(
        data,
        durationRanges,
        undefined, undefined, undefined, undefined,
        preferSentenceBoundaries
      );
      
      setScenes(generatedScenes);
      toast.success(`${generatedScenes.length} scènes générées !`);
    } catch (error) {
      toast.error("Erreur lors de la génération des scènes");
      console.error(error);
    } finally {
      setIsGeneratingScenes(false);
    }
  };

  const handleGeneratePrompts = async (testMode: boolean = false) => {
    if (scenes.length === 0) {
      toast.error("Veuillez d'abord générer les scènes");
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Check if already has active job
    if (hasActiveJob('prompts')) {
      toast.info("Une génération de prompts est déjà en cours");
      return;
    }

    // Start background job
    const result = await startJob('prompts', { regenerate: false });
    if (result) {
      setIsGeneratingPrompts(true);
      toast.info("Génération des prompts lancée en arrière-plan. Vous pouvez quitter cette page.");
    }
  };

  const regenerateSinglePrompt = async (sceneIndex: number) => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    setRegeneratingPromptIndex(sceneIndex);
    
    // Start background job
    const result = await startJob('single_prompt', { sceneIndex });
    if (!result) {
      setRegeneratingPromptIndex(null);
    }
  };

  const generateSinglePrompt = async (sceneIndex: number) => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    setGeneratingPromptIndex(sceneIndex);
    
    // Start background job
    const result = await startJob('single_prompt', { sceneIndex });
    if (!result) {
      setGeneratingPromptIndex(null);
    }
  };

  const copyToClipboard = async (prompt: string, index: number) => {
    try {
      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(prompt);
        setCopiedIndex(index);
        toast.success("Prompt copié !");
        setTimeout(() => setCopiedIndex(null), 2000);
        return;
      }
      
      // Fallback: use old method with textarea
      const textArea = document.createElement('textarea');
      textArea.value = prompt;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setCopiedIndex(index);
          toast.success("Prompt copié !");
          setTimeout(() => setCopiedIndex(null), 2000);
        } else {
          toast.error("Erreur lors de la copie");
        }
      } catch (err) {
        document.body.removeChild(textArea);
        toast.error("Erreur lors de la copie");
      }
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      toast.error("Erreur lors de la copie");
    }
  };

  const handleAspectRatioChange = (ratio: string) => {
    setAspectRatio(ratio);
    // Use lower resolutions for z-image-turbo and z-image-turbo-lora (max 1440px)
    const isZImageTurbo = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    switch (ratio) {
      case "16:9":
        setImageWidth(isZImageTurbo ? 960 : 1920);
        setImageHeight(isZImageTurbo ? 544 : 1080);
        break;
      case "9:16":
        setImageWidth(isZImageTurbo ? 720 : 1080);
        setImageHeight(isZImageTurbo ? 1280 : 1920);
        break;
      case "1:1":
        setImageWidth(isZImageTurbo ? 1024 : 1024);
        setImageHeight(isZImageTurbo ? 1024 : 1024);
        break;
      case "4:3":
        setImageWidth(isZImageTurbo ? 1280 : 1920);
        setImageHeight(isZImageTurbo ? 960 : 1440);
        break;
      case "custom":
        // Keep current values
        break;
    }
  };

  const handleModelChange = (model: string) => {
    setImageModel(model);
    // Adapt dimensions when switching to z-image-turbo or z-image-turbo-lora
    // Z-Image Turbo cannot generate in 1080p, so use lower resolutions
    if (model === 'z-image-turbo' || model === 'z-image-turbo-lora') {
      // Always use standard z-image-turbo resolutions based on aspect ratio
      switch (aspectRatio) {
        case "16:9":
          setImageWidth(960);
          setImageHeight(544);
          break;
        case "9:16":
          setImageWidth(720);
          setImageHeight(1280);
          break;
        case "1:1":
          setImageWidth(1024);
          setImageHeight(1024);
          break;
        case "4:3":
          setImageWidth(1280);
          setImageHeight(960);
          break;
      }
      toast.info("Dimensions ajustées pour Z-Image Turbo (upscale x2 automatique)");
    } else if (model === 'seedream-4' || model === 'seedream-4.5' || model === 'seedream-5-lite' || model === 'grok-imagine') {
      switch (aspectRatio) {
        case "16:9":
          setImageWidth(1920);
          setImageHeight(1080);
          break;
        case "9:16":
          setImageWidth(1080);
          setImageHeight(1920);
          break;
        case "1:1":
          setImageWidth(1024);
          setImageHeight(1024);
          break;
        case "4:3":
          setImageWidth(1440);
          setImageHeight(1080);
          break;
      }
    }
  };

  const handleStyleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error("Veuillez sélectionner une image");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 10MB");
      return;
    }

    setIsUploadingStyleImage(true);

    try {
      if (!user) throw new Error("User not authenticated");

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('style-references')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('style-references')
        .getPublicUrl(fileName);

      setUploadedStyleImageUrl(publicUrl);
      setStyleReferenceUrls([publicUrl]);
      toast.success("Image de style uploadée !");
    } catch (error: any) {
      console.error("Error uploading style image:", error);
      toast.error(error.message || "Erreur lors de l'upload de l'image");
    } finally {
      setIsUploadingStyleImage(false);
    }
  };

  const processAudioFile = async (file: File) => {
    // Validate file type
    if (!file.type.startsWith('audio/')) {
      toast.error("Veuillez sélectionner un fichier audio");
      return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Le fichier audio ne doit pas dépasser 50MB");
      return;
    }

    setIsUploadingAudio(true);
    setAudioFile(file);
    toast.info("Upload du fichier audio en cours...");

    try {
      if (!user) throw new Error("User not authenticated");

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('audio-files')
        .getPublicUrl(fileName);

      setAudioUrl(publicUrl);
      toast.success("Fichier audio uploadé !");
    } catch (error: any) {
      console.error("Error uploading audio:", error);
      toast.error(error.message || "Erreur lors de l'upload du fichier audio");
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processAudioFile(file);
  };

  const handleAudioDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingAudio(true);
  };

  const handleAudioDragLeave = () => {
    setIsDraggingAudio(false);
  };

  const handleAudioDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingAudio(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      await processAudioFile(file);
    }
  };

  // Helper function to upload manual image
  const uploadManualImage = async (file: File, sceneIndex: number) => {
    try {
      addGeneratingImageIndex(sceneIndex);
      
      // Generate unique filename
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const filename = `${currentProjectId || 'temp'}/scene_${sceneIndex + 1}_${timestamp}.${fileExt}`;
      
      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(filename, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('generated-images')
        .getPublicUrl(filename);

      // Update the state
      setGeneratedPrompts(prev => {
        const updated = [...prev];
        updated[sceneIndex] = {
          ...updated[sceneIndex],
          imageUrl: publicUrl
        };
        return updated;
      });

      toast.success("Image importée avec succès");
    } catch (error: any) {
      console.error("Error uploading manual image:", error);
      toast.error(error.message || "Erreur lors de l'import de l'image");
    } finally {
      removeGeneratingImageIndex(sceneIndex);
    }
  };

  // Handler to open web image search modal
  const handleSearchWebImage = (sceneIndex: number, sceneText: string) => {
    setImageSearchSceneIndex(sceneIndex);
    setImageSearchSceneText(sceneText);
    
    // Get previous and next scenes for context (use scenes array which has the text)
    const previousScenes = scenes
      .slice(Math.max(0, sceneIndex - 3), sceneIndex)
      .map(s => s.text)
      .filter(t => t.trim().length > 0);
    
    const nextScenes = scenes
      .slice(sceneIndex + 1, Math.min(scenes.length, sceneIndex + 4))
      .map(s => s.text)
      .filter(t => t.trim().length > 0);
    
    // Store in state to pass to modal
    setImageSearchPreviousScenes(previousScenes);
    setImageSearchNextScenes(nextScenes);
    setImageSearchOpen(true);
  };

  // Handler to select an image from web search results
  const handleSelectWebImage = async (imageUrl: string) => {
    const sceneIndex = imageSearchSceneIndex;
    
    try {
      setGeneratingImageIndex(sceneIndex);
      
      // Use Edge Function to download image server-side (avoids CORS issues)
      const { data, error } = await supabase.functions.invoke('download-web-image', {
        body: {
          imageUrl,
          projectId: currentProjectId,
          sceneIndex
        }
      });

      if (error) {
        throw new Error(error.message || "Erreur lors du téléchargement");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      const publicUrl = data.imageUrl;

      // Update the state
      setGeneratedPrompts(prev => {
        const updated = [...prev];
        updated[sceneIndex] = {
          ...updated[sceneIndex],
          imageUrl: publicUrl
        };
        return updated;
      });

      // Persist to database if we have a project
      if (currentProjectId) {
        const updatedPrompts = [...generatedPrompts];
        updatedPrompts[sceneIndex] = {
          ...updatedPrompts[sceneIndex],
          imageUrl: publicUrl
        };
        
        await supabase
          .from('projects')
          .update({ prompts: updatedPrompts as any })
          .eq('id', currentProjectId);
      }

    } catch (error: any) {
      console.error("Error downloading web image:", error);
      toast.error(error.message || "Erreur lors du téléchargement de l'image");
    } finally {
      removeGeneratingImageIndex(sceneIndex);
    }
  };

  const handleEditPrompt = (index: number) => {
    const prompt = generatedPrompts[index];
    if (prompt) {
      setEditingPromptIndex(index);
      // Use regenerated_prompt if it exists, otherwise use original prompt
      setEditingPromptText(prompt.regenerated_prompt || prompt.prompt);
    }
  };

  const handleWritePrompt = async (index: number, text: string) => {
    if (!text.trim() || !currentProjectId) return;

    const updatedPrompts = [...generatedPrompts];
    const scene = scenes[index];
    updatedPrompts[index] = {
      ...updatedPrompts[index],
      prompt: text.trim(),
      text: scene?.text || '',
      startTime: scene?.startTime,
      endTime: scene?.endTime,
    };

    setGeneratedPrompts(updatedPrompts);

    try {
      const { error: jsonError } = await supabase
        .from("projects")
        .update({ prompts: updatedPrompts as any })
        .eq("id", currentProjectId);
      if (jsonError) throw jsonError;

      const { error: sceneError } = await supabase
        .from("project_scenes")
        .upsert({
          project_id: currentProjectId,
          scene_index: index,
          prompt: text.trim(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'project_id,scene_index' });
      if (sceneError) console.error("Error saving to project_scenes:", sceneError);

      toast.success("Prompt sauvegardé");
    } catch (error) {
      console.error("Error saving prompt:", error);
      toast.error("Erreur lors de la sauvegarde du prompt");
    }
  };

  const handleSaveEditedPrompt = async () => {
    if (editingPromptIndex === null) return;
    
    const updatedPrompts = [...generatedPrompts];
    updatedPrompts[editingPromptIndex] = {
      ...updatedPrompts[editingPromptIndex],
      prompt: editingPromptText,
      // Clear regenerated_prompt since user is now using a custom edited prompt
      regenerated_prompt: undefined
    };
    
    setGeneratedPrompts(updatedPrompts);
    
    // Persist to database - BOTH legacy JSON and project_scenes
    if (currentProjectId) {
      try {
        // Update legacy JSON (projects.prompts)
        const { error: jsonError } = await supabase
          .from("projects")
          .update({ prompts: updatedPrompts as any })
          .eq("id", currentProjectId);
        
        if (jsonError) throw jsonError;
        
        // Also update project_scenes (source of truth for polling)
        const { error: sceneError } = await supabase
          .from("project_scenes")
          .upsert({
            project_id: currentProjectId,
            scene_index: editingPromptIndex,
            prompt: editingPromptText,
            regenerated_prompt: null, // Clear regenerated_prompt
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'project_id,scene_index'
          });
        
        if (sceneError) {
          console.error("Error saving to project_scenes:", sceneError);
        }
        
        toast.success("Prompt modifié avec succès");
      } catch (error) {
        console.error("Error saving prompt:", error);
        toast.error("Erreur lors de la sauvegarde du prompt");
      }
    }
    
    setEditingPromptIndex(null);
    setEditingPromptText("");
  };

  // Update prompt from VideoPreview component
  const updatePromptFromPreview = async (sceneIndex: number, newPrompt: string) => {
    const updatedPrompts = [...generatedPrompts];
    updatedPrompts[sceneIndex] = {
      ...updatedPrompts[sceneIndex],
      prompt: newPrompt
    };
    
    setGeneratedPrompts(updatedPrompts);
    
    // Persist to database - BOTH legacy JSON and project_scenes
    if (currentProjectId) {
      try {
        // Update legacy JSON (projects.prompts)
        const { error: jsonError } = await supabase
          .from("projects")
          .update({ prompts: updatedPrompts as any })
          .eq("id", currentProjectId);
        
        if (jsonError) throw jsonError;
        
        // Also update project_scenes (source of truth for polling)
        const { error: sceneError } = await supabase
          .from("project_scenes")
          .upsert({
            project_id: currentProjectId,
            scene_index: sceneIndex,
            prompt: newPrompt,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'project_id,scene_index'
          });
        
        if (sceneError) {
          console.error("Error saving to project_scenes:", sceneError);
        }
        
        toast.success("Prompt sauvegardé");
      } catch (error) {
        console.error("Error saving prompt:", error);
        toast.error("Erreur lors de la sauvegarde du prompt");
      }
    }
  };

  const handleEditScene = (index: number) => {
    const prompt = generatedPrompts[index];
    if (prompt) {
      setEditingSceneIndex(index);
      setEditingSceneText(prompt.text);
    }
  };

  const handleSaveEditedScene = async () => {
    if (editingSceneIndex === null) return;
    
    const updatedPrompts = [...generatedPrompts];
    updatedPrompts[editingSceneIndex] = {
      ...updatedPrompts[editingSceneIndex],
      text: editingSceneText
    };
    
    setGeneratedPrompts(updatedPrompts);
    
    // Persist to database
    if (currentProjectId) {
      try {
        const { error } = await supabase
          .from("projects")
          .update({ prompts: updatedPrompts as any })
          .eq("id", currentProjectId);
        
        if (error) throw error;
        toast.success("Texte de la scène mis à jour");
      } catch (error) {
        console.error("Error saving scene text:", error);
        toast.error("Erreur lors de la sauvegarde");
      }
    }
    
    setEditingSceneIndex(null);
    setEditingSceneText("");
  };

  // Helper function to upload multiple images at once
  const uploadMultipleImages = async (files: FileList) => {
    try {
      setIsGeneratingImages(true);
      
      const fileArray = Array.from(files);
      
      // Parse filenames to extract scene numbers (e.g., clip_001.jpg -> 1)
      const fileMapping = fileArray.map(file => {
        const match = file.name.match(/clip_(\d+)/i);
        if (!match) return null;
        
        const sceneNumber = parseInt(match[1], 10);
        const sceneIndex = sceneNumber - 1; // Convert to 0-based index
        
        return { file, sceneIndex };
      }).filter((item): item is { file: File; sceneIndex: number } => 
        item !== null && item.sceneIndex >= 0 && item.sceneIndex < generatedPrompts.length
      );

      if (fileMapping.length === 0) {
        toast.error("Aucune image valide trouvée. Vérifiez le format des noms (clip_001.jpg, clip_002.jpg, etc.)");
        return;
      }

      let successCount = 0;
      const uploadPromises = fileMapping.map(async ({ file, sceneIndex }) => {
        try {
          // Generate unique filename
          const timestamp = Date.now();
          const fileExt = file.name.split('.').pop();
          const filename = `${currentProjectId || 'temp'}/scene_${sceneIndex + 1}_${timestamp}.${fileExt}`;
          
          // Upload to Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('generated-images')
            .upload(filename, file, {
              cacheControl: '3600',
              upsert: true
            });

          if (uploadError) throw uploadError;

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('generated-images')
            .getPublicUrl(filename);

          // Update the state
          setGeneratedPrompts(prev => {
            const updated = [...prev];
            updated[sceneIndex] = {
              ...updated[sceneIndex],
              imageUrl: publicUrl
            };
            return updated;
          });

          successCount++;
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error);
        }
      });

      await Promise.all(uploadPromises);

      if (successCount > 0) {
        toast.success(`${successCount} image${successCount > 1 ? 's' : ''} importée${successCount > 1 ? 's' : ''} avec succès`);
      } else {
        toast.error("Aucune image n'a pu être importée");
      }
    } catch (error: any) {
      console.error("Error uploading multiple images:", error);
      toast.error(error.message || "Erreur lors de l'import des images");
    } finally {
      setIsGeneratingImages(false);
    }
  };

  // Helper function to save image to Supabase Storage
  const saveImageToStorage = async (replicateUrl: string, sceneIndex: number): Promise<string> => {
    try {
      // Download image from Replicate
      const response = await fetch(replicateUrl);
      if (!response.ok) throw new Error("Failed to download image");
      
      const blob = await response.blob();
      
      // Generate unique filename
      const timestamp = Date.now();
      const filename = `${currentProjectId || 'temp'}/scene_${sceneIndex + 1}_${timestamp}.jpg`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(filename, blob, {
          contentType: 'image/jpeg',
          upsert: true
        });
      
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('generated-images')
        .getPublicUrl(filename);
      
      return publicUrl;
    } catch (error) {
      console.error("Error saving image to storage:", error);
      // Return original URL as fallback
      return replicateUrl;
    }
  };

  // Helper function to poll prediction status with timeout
  const pollPredictionStatus = async (
    predictionId: string, 
    maxWaitMs: number = 300000, // 5 minutes max
    pollIntervalMs: number = 2000
  ): Promise<string> => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const { data, error } = await supabase.functions.invoke('generate-image-seedream', {
        body: { predictionId }
      });
      
      if (error) throw error;
      
      console.log(`Prediction ${predictionId} status:`, data.status);
      
      if (data.status === 'succeeded') {
        const output = Array.isArray(data.output) ? data.output[0] : data.output;
        if (!output) throw new Error("No output in succeeded prediction");
        return output;
      }
      
      if (data.status === 'failed' || data.status === 'canceled') {
        throw new Error(`Prediction ${data.status}: ${data.error || 'Unknown error'}`);
      }
      
      // Still processing, wait and poll again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error("Image generation timed out after 5 minutes");
  };

  // Helper function to generate image with async polling
  const generateImageAsync = async (
    prompt: string,
    sceneIndex: number
  ): Promise<{ success: boolean; imageUrl?: string }> => {
    const requestBody: any = {
      prompt,
      width: imageWidth,
      height: imageHeight,
      model: imageModel,
      async: true // Enable async mode
    };

    // Add style references if provided
    if (styleReferenceUrls.length > 0) {
      requestBody.image_urls = styleReferenceUrls;
    }

    // Start the generation (returns immediately with predictionId)
    const { data: startData, error: startError } = await supabase.functions.invoke('generate-image-seedream', {
      body: requestBody
    });

    if (startError) throw startError;

    if (!startData.predictionId) {
      throw new Error("No prediction ID returned");
    }

    console.log(`Scene ${sceneIndex + 1}: Started prediction ${startData.predictionId}`);

    // Poll for completion
    const replicateUrl = await pollPredictionStatus(startData.predictionId);
    
    // Save to Supabase Storage
    const permanentUrl = await saveImageToStorage(replicateUrl, sceneIndex);
    
    return { success: true, imageUrl: permanentUrl };
  };

  const generateImage = async (index: number) => {
    const prompt = generatedPrompts[index];
    if (!prompt) {
      toast.error("Aucun prompt disponible pour cette scène");
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    addGeneratingImageIndex(index);
    
    // Mark this scene as regenerated in state
    setRegeneratedScenes(prev => new Set([...prev, index]));
    
    // Mark this scene as regenerated in database
    const updatedPrompts = [...generatedPrompts];
    updatedPrompts[index] = {
      ...updatedPrompts[index],
      manually_regenerated: true
    };
    setGeneratedPrompts(updatedPrompts);
    
    // Persist manually_regenerated flag to database
    // IMPORTANT: Don't overwrite entire prompts array - just update the specific scene
    try {
      // First, get current prompts from DB to avoid overwriting existing data
      const { data: currentProject } = await supabase
        .from('projects')
        .select('prompts')
        .eq('id', currentProjectId)
        .single();
      
      if (currentProject?.prompts) {
        const dbPrompts = currentProject.prompts as any[];
        if (dbPrompts[index]) {
          dbPrompts[index] = { ...dbPrompts[index], manually_regenerated: true };
          await supabase
            .from('projects')
            .update({ prompts: dbPrompts })
            .eq('id', currentProjectId);
        }
      }
    } catch (error) {
      console.error("Error saving manually_regenerated flag:", error);
    }
    
    // Start background job - use same flow as generateAllImages but for single scene
    console.log(`[generateImage] Starting images job for scene ${index + 1} (same flow as batch)...`);
    const result = await startJob('images', { 
      sceneIndices: [index],  // Only this scene
      skipExisting: false,    // Force regenerate even if image exists
      semiAutoMode: true,     // Enable QA, regen, upscale chaining
      qaPrompt: null
    });
    console.log(`[generateImage] startJob result:`, result);
    if (!result) {
      console.log(`[generateImage] Job failed to start, removing loading state`);
      removeGeneratingImageIndex(index);
    } else {
      console.log(`[generateImage] Job started successfully, jobId: ${result.jobId}`);
    }
  };

  const handleRegenerateWithQAPrompt = async (index: number) => {
    const prompt = generatedPrompts[index];
    if (!prompt) {
      toast.error("Aucun prompt disponible pour cette scène");
      return;
    }

    if (!prompt.qa_regeneration_prompt) {
      toast.error("Aucun prompt de régénération disponible");
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Replace the current prompt with the QA suggested prompt
    const updatedPrompts = [...generatedPrompts];
    updatedPrompts[index] = {
      ...updatedPrompts[index],
      prompt: prompt.qa_regeneration_prompt,
      manually_regenerated: true,
      qa_regeneration_prompt: undefined,
      qa_previous_rejection: prompt.qa_explication || updatedPrompts[index].qa_previous_rejection,
    };
    
    // Update state FIRST
    setGeneratedPrompts(updatedPrompts);
    
    // Mark as generating
    addGeneratingImageIndex(index);
    setRegeneratedScenes(prev => new Set([...prev, index]));

    // Save to database BEFORE starting job
    // IMPORTANT: Don't overwrite entire prompts array - just update the specific scene
    try {
      // First, get current prompts from DB to avoid overwriting existing data
      const { data: currentProject } = await supabase
        .from('projects')
        .select('prompts')
        .eq('id', currentProjectId)
        .single();
      
      if (currentProject?.prompts) {
        const dbPrompts = currentProject.prompts as any[];
        if (dbPrompts[index]) {
          dbPrompts[index] = { 
            ...dbPrompts[index], 
            prompt: prompt.qa_regeneration_prompt,
            manually_regenerated: true,
            qa_regeneration_prompt: undefined,
            qa_previous_rejection: prompt.qa_explication || dbPrompts[index].qa_previous_rejection,
          };
          await supabase
            .from('projects')
            .update({ prompts: dbPrompts })
            .eq('id', currentProjectId);
        }
      }
      
      // Also update project_scenes table
      await supabase
        .from('project_scenes')
        .update({ 
          prompt: prompt.qa_regeneration_prompt,
          was_regenerated: true
        })
        .eq('project_id', currentProjectId)
        .eq('scene_index', index);
      
      console.log('[handleRegenerateWithQAPrompt] Updated prompt in DB, new prompt:', prompt.qa_regeneration_prompt);
      
      toast.success("Prompt remplacé, régénération en cours...");
      
      // Start background job AFTER DB update - use same flow as manual regeneration
      const result = await startJob('images', { 
        sceneIndices: [index],
        skipExisting: false,
        semiAutoMode: true,
        qaPrompt: null
      });
      if (!result) {
        removeGeneratingImageIndex(index);
      }
    } catch (error) {
      console.error("Error saving new prompt:", error);
      toast.error("Erreur lors de la sauvegarde du nouveau prompt");
      removeGeneratingImageIndex(index);
    }
  };

  const animateScene = async (index: number) => {
    const prompt = generatedPrompts[index];
    if (!prompt) {
      toast.error("Aucun prompt disponible pour cette scène");
      return;
    }

    if (!prompt.imageUrl) {
      toast.error("Aucune image disponible pour animer cette scène");
      return;
    }

    if (!prompt.prompt) {
      toast.error("Aucun prompt disponible pour cette scène");
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    const scene = scenes[index];
    if (!scene) {
      toast.error("Scène introuvable");
      return;
    }

    const sceneDuration = scene.endTime - scene.startTime;

    setAnimatingSceneIndex(index);
    setConfirmAnimateScene(null);

    try {
      // The job will be created by the Edge Function and tracked automatically
      // Just show a toast that it's starting
      toast.info(`Animation de la scène ${index + 1} lancée. Suivi en cours...`);

      console.log('[handleAnimateScene] Animation started for scene', index + 1);
      
      console.log('[handleAnimateScene] Calling animate-scene with:', {
        projectId: currentProjectId,
        sceneIndex: index,
        hasImageUrl: !!prompt.imageUrl,
        hasPrompt: !!prompt.prompt,
        sceneDuration
      });

      const { data, error } = await supabase.functions.invoke('animate-scene', {
        body: {
          projectId: currentProjectId,
          sceneIndex: index,
          imageUrl: prompt.imageUrl,
          prompt: prompt.prompt,
          sceneDuration: sceneDuration
        }
      });

      console.log('[handleAnimateScene] animate-scene response:', { data, error });

      if (error) {
        console.error('[handleAnimateScene] Function error:', error);
        throw error;
      }

      if (data?.error) {
        console.error('[handleAnimateScene] Data error:', data.error);
        throw new Error(data.error);
      }

      if (!data?.taskId) {
        console.error('[handleAnimateScene] No taskId in response:', data);
        throw new Error('Réponse invalide: taskId manquant');
      }
      
      console.log('[handleAnimateScene] Task created successfully:', { taskId: data.taskId, jobId: data.jobId });
      
      if (!data?.jobId) {
        console.warn('[handleAnimateScene] No jobId in response - job tracking may have failed, but continuing with taskId:', data.taskId);
      }

      // Poll for completion - job is already tracked by useGenerationJobs
      const taskId = data.taskId;
      const jobId = data.jobId; // May be null if job creation failed
      let completed = false;
      let attempts = 0;
      const maxAttempts = 300; // 25 minutes max

      // Update job progress during polling (only if jobId exists)
      const updateJobProgress = async (progress: number, status?: string, errorMessage?: string) => {
        if (!jobId) {
          console.log(`[handleAnimateScene] Skipping job progress update (no jobId), progress: ${progress}%`);
          return;
        }
        try {
          const updateData: any = { progress };
          if (status) updateData.status = status;
          if (errorMessage) updateData.error_message = errorMessage;
          
          await supabase
            .from('generation_jobs')
            .update(updateData)
            .eq('id', jobId);
        } catch (err) {
          console.error('Error updating job progress:', err);
        }
      };

      // Wait a bit for the job to appear in the UI
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Start with 5% progress
      await updateJobProgress(5, 'processing');

      console.log(`%c[handleAnimateScene] Starting polling loop for taskId: ${taskId}`, 'background: green; color: white; padding: 2px 5px;');

      while (!completed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        attempts++;

        // Update progress: 5% to 90% over maxAttempts
        const progress = Math.min(90, 5 + Math.floor((attempts / maxAttempts) * 85));
        await updateJobProgress(progress);

        try {
          const { data: statusData, error: statusError } = await supabase.functions.invoke('check-animation-status', {
            body: {
              taskId,
              jobId: jobId || null, // Pass null if jobId doesn't exist
              projectId: currentProjectId,
              sceneIndex: index
            }
          });

          if (statusError) {
            console.error('%c[handleAnimateScene] Error checking status:', 'background: red; color: white;', statusError);
            continue;
          }
          
          if (!statusData) {
            console.error('%c[handleAnimateScene] No statusData returned', 'background: red; color: white;');
            continue;
          }

          console.log(`%c[handleAnimateScene] Poll attempt ${attempts}`, 'background: blue; color: white; padding: 2px 5px;', {
            status: statusData?.status,
            completed: statusData?.completed,
            videoUrl: statusData?.videoUrl,
            error: statusData?.error,
            success: statusData?.success,
            fullResponse: statusData
          });

          if (statusData?.completed) {
            completed = true;
            
            console.log(`[handleAnimateScene] Status data:`, JSON.stringify(statusData, null, 2));
            
            if (statusData.videoUrl) {
              console.log(`[handleAnimateScene] Animation completed with videoUrl:`, statusData.videoUrl);
              
              // Update state immediately with videoUrl
              setGeneratedPrompts(prev => {
                const updated = [...prev];
                if (updated[index]) {
                  updated[index] = {
                    ...updated[index],
                    videoUrl: statusData.videoUrl
                  };
                  console.log(`[handleAnimateScene] Updated state immediately, scene ${index} now has videoUrl:`, updated[index].videoUrl);
                }
                return updated;
              });
              
              // Mark as completed AFTER updating the project
              await updateJobProgress(100, 'completed');
              
              // Wait a bit for the project update to complete, then reload from DB as backup
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Reload prompts from database to ensure we have the latest data (backup)
              if (currentProjectId) {
                try {
                  const { data: projectData, error: projectError } = await supabase
                    .from('projects')
                    .select('prompts')
                    .eq('id', currentProjectId)
                    .single();
                  
                  if (projectError) {
                    console.error(`[handleAnimateScene] Error loading project:`, projectError);
                  } else if (projectData?.prompts) {
                    const validPrompts = ((projectData.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null);
                    console.log(`[handleAnimateScene] Reloaded prompts from DB, total: ${validPrompts.length}, scene ${index} videoUrl:`, validPrompts[index]?.videoUrl);
                    // Only update if the DB has the videoUrl (to avoid overwriting with stale data)
                    if (validPrompts[index]?.videoUrl) {
                      const promptsWithGroups = calculateGroupsIfMissing(validPrompts);
                      setGeneratedPrompts(promptsWithGroups);
                    }
                  }
                } catch (err) {
                  console.error(`[handleAnimateScene] Exception loading project:`, err);
                  // State was already updated above, so continue
                }
              }
              
              toast.success(`Animation terminée pour la scène ${index + 1} !`);
            } else if (statusData.error) {
              await updateJobProgress(0, 'failed', statusData.error);
              throw new Error(statusData.error);
            } else {
              // Completed but no videoUrl - mark as completed anyway
              console.warn(`[handleAnimateScene] Completed but no videoUrl in response`);
              await updateJobProgress(100, 'completed');
            }
          }
          // Still processing - progress already updated above
        } catch (pollError: any) {
          console.error('Error during polling:', pollError);
          // Continue polling despite errors
        }
      }

      if (!completed) {
        await updateJobProgress(0, 'failed', 'Animation timeout - la tâche prend plus de temps que prévu');
        throw new Error('Animation timeout - la tâche prend plus de temps que prévu');
      }
      
    } catch (error: any) {
      console.error("Error animating scene:", error);
      // Try to get more details from the error
      let errorMessage = error.message || 'Erreur inconnue';
      if (error.context?.body) {
        try {
          const body = JSON.parse(error.context.body);
          errorMessage = body.error || body.details || errorMessage;
          console.error("Error details:", body);
        } catch (e) {
          // body is not JSON
        }
      }
      toast.error(`Erreur lors de l'animation: ${errorMessage}`);
      setAnimatingSceneIndex(null);
    }
  };

  const generateAllImages = async (skipExisting: boolean = false) => {
    if (generatedPrompts.length === 0) {
      toast.error("Veuillez d'abord générer les prompts");
      return;
    }

    // Check for missing prompts (null entries)
    const missingPromptIndices = generatedPrompts
      .map((p, index) => ({ prompt: p, index }))
      .filter(item => !item.prompt || !item.prompt.prompt)
      .map(item => item.index + 1);
    
    if (missingPromptIndices.length > 0) {
      toast.error(
        `${missingPromptIndices.length} scène(s) sans prompt (${missingPromptIndices.slice(0, 5).join(", ")}${missingPromptIndices.length > 5 ? '...' : ''}). Régénérez les prompts d'abord.`,
        { duration: 8000 }
      );
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Check if already has active job
    if (hasActiveJob('images')) {
      toast.info("Une génération d'images est déjà en cours");
      return;
    }

    // Protection against rapid double-clicks
    if (isGeneratingImages) {
      console.log("[generateAllImages] Already generating, ignoring duplicate call");
      return;
    }

    // Mark as generating BEFORE async call to prevent double-clicks
    setIsGeneratingImages(true);

    // Start background job with semi-auto chaining enabled
    const result = await startJob('images', { 
      skipExisting,
      semiAutoMode: true, // Enable automatic chaining to QA, regen, and upscale
      qaPrompt: qaPrompt || null, // Pass QA prompt from current preset
      thumbnailPresetId: null // No thumbnails for standalone generation
    });
    if (!result) {
      // If job creation failed, reset the flag
      setIsGeneratingImages(false);
    }
  };

  const generateUpscale = async () => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Check if Z-Image 16:9
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const is16x9 = aspectRatio === '16:9';
    
    console.log(`[generateUpscale] Checking conditions: isZImage=${isZImage}, is16x9=${is16x9}`);
    
    if (!isZImage || !is16x9) {
      toast.error("L'upscaling automatique est uniquement disponible pour Z-Image en format 16:9");
      return;
    }

    // Check if images exist
    const imagesWithUrl = generatedPrompts.filter((p: any) => p && p.imageUrl).length;
    const imagesUpscaled = generatedPrompts.filter((p: any) => p && p.imageUrl && p.isUpscaled === true).length;
    const needsUpscale = imagesWithUrl - imagesUpscaled;
    
    console.log(`[generateUpscale] Images status: ${imagesWithUrl} total, ${imagesUpscaled} upscaled, ${needsUpscale} need upscaling`);
    
    if (imagesWithUrl === 0) {
      toast.error("Aucune image à upscaler. Générez d'abord les images.");
      return;
    }
    
    if (needsUpscale === 0) {
      toast.info("✅ Toutes les images sont déjà upscalées !");
      return;
    }

    // Check if already has active upscale job
    if (hasActiveJob('upscale')) {
      console.log(`[generateUpscale] Active upscale job already exists, skipping`);
      toast.info("Un upscaling est déjà en cours");
      return;
    }

    // Start background job
    console.log(`[generateUpscale] Starting upscale job for ${needsUpscale} images`);
    const result = await startJob('upscale', {});
    if (result) {
      toast.info(`Upscaling de ${needsUpscale} image(s) lancé en arrière-plan.`);
    }
  };
  
  const runManualQA = async () => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Check if images exist
    const imagesToCheck = generatedPrompts.filter((p: any) => p && p.imageUrl);
    
    if (imagesToCheck.length === 0) {
      toast.error("Aucune image à vérifier. Générez d'abord les images.");
      return;
    }

    // Check if already has active QA job
    if (hasActiveJob('qa')) {
      toast.info("Une vérification QA est déjà en cours");
      return;
    }

    // Check if QA has already been done
    const alreadyChecked = generatedPrompts.some((p: any) => p && p.qa_checked);
    if (alreadyChecked) {
      // Show confirmation dialog
      setShowQAConfirmDialog(true);
      return;
    }

    // Start background QA job
    console.log('[QA DEBUG] qaPrompt length:', qaPrompt.length || 0);
    console.log('[QA DEBUG] qaPrompt preview:', qaPrompt.substring(0, 200) || 'empty');
    console.log('[QA DEBUG] qaPrompt contains "SYMBOLES ICONOGRAPHIQUES":', qaPrompt.includes('SYMBOLES ICONOGRAPHIQUES'));
    const result = await startJob('qa', { qaPrompt });
    if (result) {
      toast.info(`Vérification qualité de ${imagesToCheck.length} image(s) lancée en arrière-plan.`);
    }
  };

  const confirmAndRunQA = async () => {
    setShowQAConfirmDialog(false);

    if (!currentProjectId) return;

    // Reset all QA flags in the database
    const updatedPrompts = generatedPrompts.map((p: any) => {
      if (!p) return p;
      return {
        ...p,
        qa_checked: false,
        qa_status: undefined,
        qa_explication: undefined,
        qa_regenerated: false
      };
    });

    try {
      await supabase
        .from('projects')
        .update({ prompts: updatedPrompts as any })
        .eq('id', currentProjectId);

      console.log('[confirmAndRunQA] Reset QA flags in database');

      // Update local state
      setGeneratedPrompts(updatedPrompts);

      // Start QA job
      const imagesToCheck = updatedPrompts.filter((p: any) => p && p.imageUrl);
      console.log('[QA DEBUG - confirmAndRunQA] qaPrompt length:', qaPrompt.length || 0);
      console.log('[QA DEBUG - confirmAndRunQA] qaPrompt preview:', qaPrompt.substring(0, 200) || 'empty');
      console.log('[QA DEBUG - confirmAndRunQA] qaPrompt contains "SYMBOLES ICONOGRAPHIQUES":', qaPrompt.includes('SYMBOLES ICONOGRAPHIQUES'));
      const result = await startJob('qa', { qaPrompt });
      if (result) {
        toast.info(`Vérification qualité de ${imagesToCheck.length} image(s) relancée en arrière-plan.`);
      }
    } catch (error) {
      console.error('[confirmAndRunQA] Error resetting QA flags:', error);
      toast.error("Erreur lors de la réinitialisation du QA");
    }
  };

  const forceUpscale = async () => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Check if Z-Image 16:9
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const is16x9 = aspectRatio === '16:9';
    
    if (!isZImage || !is16x9) {
      toast.error("L'upscaling automatique est uniquement disponible pour Z-Image en format 16:9");
      return;
    }

    // Count images to upscale
    const imagesWithUrl = generatedPrompts.filter((p: any) => p && p.imageUrl).length;
    const imagesUpscaled = generatedPrompts.filter((p: any) => p && p.imageUrl && p.isUpscaled === true).length;
    const needsUpscale = imagesWithUrl - imagesUpscaled;
    
    if (imagesWithUrl === 0) {
      toast.error("Aucune image à upscaler. Générez d'abord les images.");
      return;
    }
    
    console.log(`[forceUpscale] Forcing upscale for ${needsUpscale} images, canceling existing jobs`);

    try {
      // Cancel any existing upscale jobs
      const { data: existingJobs } = await supabase
        .from('generation_jobs')
        .select('id')
        .eq('project_id', currentProjectId)
        .eq('job_type', 'upscale')
        .in('status', ['pending', 'processing']);

      if (existingJobs && existingJobs.length > 0) {
        console.log(`[forceUpscale] Found ${existingJobs.length} existing upscale jobs, marking as failed`);
        
        for (const job of existingJobs) {
          await supabase
            .from('generation_jobs')
            .update({ 
              status: 'failed', 
              error_message: 'Cancelled by user (forced restart)',
              completed_at: new Date().toISOString()
            })
            .eq('id', job.id);
        }
        
        toast.info(`${existingJobs.length} job(s) existant(s) annulé(s)`);
      }

      // Start new upscale job
      const result = await startJob('upscale', {});
      if (result) {
        toast.success(`Upscaling forcé lancé pour ${needsUpscale} image(s) !`);
      }
    } catch (error) {
      console.error("[forceUpscale] Error:", error);
      toast.error("Erreur lors du forçage de l'upscaling");
    }
  };

  const exportSelectedScenes = async () => {
    if (selectedScenes.size === 0) {
      toast.error("Aucune scène sélectionnée");
      return;
    }

    const sortedIndices = Array.from(selectedScenes).sort((a, b) => a - b);
    const toastId = toast.loading(`Préparation du ZIP (0/${sortedIndices.length})...`);
    let successCount = 0;
    let errorCount = 0;

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (const index of sortedIndices) {
        const scene = generatedPrompts[index];
        if (!scene) continue;

        const baseName = `scene_${index + 1}`;

        try {
          if (scene.imageUrl) {
            const imageResponse = await fetch(scene.imageUrl);
            if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}`);
            const imageBlob = await imageResponse.blob();
            const ext = imageBlob.type.includes('png') ? 'png' : 'jpg';
            zip.file(`${baseName}.${ext}`, imageBlob);
          }

          if (scene.prompt) {
            zip.file(`${baseName}.txt`, scene.prompt);
          }

          successCount++;
          toast.loading(`Préparation du ZIP (${successCount}/${sortedIndices.length})...`, { id: toastId });
        } catch (error) {
          console.error(`Error adding scene ${index + 1} to zip:`, error);
          errorCount++;
        }
      }

      if (successCount === 0) {
        toast.error("Aucune scène n'a pu être exportée", { id: toastId });
        return;
      }

      toast.loading("Génération du ZIP...", { id: toastId });
      const blob = await zip.generateAsync({ type: 'blob' });
      const safeName = (projectName || 'scenes').replace(/[^a-zA-Z0-9_-]/g, '_');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName}_${selectedScenes.size}_scenes.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      if (errorCount > 0) {
        toast.warning(`${successCount} scène(s) exportée(s), ${errorCount} erreur(s)`, { id: toastId });
      } else {
        toast.success(`${successCount} scène(s) exportée(s) en ZIP !`, { id: toastId });
      }
    } catch (err) {
      console.error("ZIP export error:", err);
      toast.error("Erreur lors de la création du ZIP", { id: toastId });
    }
  };

  const handleExport = async () => {
    console.log("handleExport called");
    if (generatedPrompts.length === 0) {
      toast.error("Aucune donnée à exporter");
      return;
    }

    // Check for missing prompts and missing images
    const missingPrompts = generatedPrompts.filter(p => !p || !p.prompt);
    const missingImages = generatedPrompts.filter(p => p && p.prompt && !p.imageUrl);
    
    if (missingPrompts.length > 0) {
      toast.error(`${missingPrompts.length} scène(s) n'ont pas de prompt. Régénérez les prompts d'abord.`);
      return;
    }
    
    if (missingImages.length > 0) {
      if (exportMode === "with-images") {
        toast.error(`${missingImages.length} scène(s) n'ont pas d'images. Impossible d'exporter avec images. Changez le mode d'export ou générez les images manquantes.`);
        return;
      } else {
        // Show warning for URL mode too
        toast.warning(`Attention : ${missingImages.length} scène(s) n'ont pas d'images. L'export contiendra des URLs vides pour ces scènes.`);
      }
    }

    // Check for images that need upscaling (Z-Image 16:9 only) - warning only for export
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const is16x9 = aspectRatio === '16:9';
    if (isZImage && is16x9 && exportMode === "with-images") {
      const imagesNeedingUpscale = generatedPrompts.filter((p: any) => {
        if (!p || !p.imageUrl) return false;
        if (p.isUpscaled === true) return false;
        const imgWidth = p.imageWidth || 0;
        const imgHeight = p.imageHeight || 0;
        if (imgWidth >= 1920 && imgHeight >= 1080) return false;
        return true;
      });
      
      if (imagesNeedingUpscale.length > 0) {
        toast.warning(`⚠️ ${imagesNeedingUpscale.length} image(s) n'ont pas été upscalées. Les images seront en basse résolution (960x544).`, { duration: 6000 });
      }
    }

    setIsExporting(true);

    try {
      // Build basePath from user input - construct full path including project name folder
      const sanitizedProjectName = (projectName || "projet_sans_nom").replace(/[/\\?%*:|"<>]/g, '_');
      const fullBasePath = exportBasePath 
        ? `${exportBasePath.replace(/\/$/, '')}/${sanitizedProjectName}_premiere_with_images`
        : undefined;
      
      // Calculate effective dimensions for Z-Image Turbo models
      let effectiveWidth = imageWidth;
      let effectiveHeight = imageHeight;
      const isZImageTurbo = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
      if (isZImageTurbo && (imageWidth > 1440 || imageHeight > 1440)) {
        const MAX_DIM = 1440;
        const scale = Math.min(MAX_DIM / imageWidth, MAX_DIM / imageHeight);
        effectiveWidth = Math.floor(imageWidth * scale);
        effectiveHeight = Math.floor(imageHeight * scale);
        // Round to multiples of 16
        effectiveWidth = Math.ceil(effectiveWidth / 16) * 16;
        effectiveHeight = Math.ceil(effectiveHeight / 16) * 16;
      }
      
      const options = {
        format: exportFormat,
        mode: exportMode,
        projectName: projectName || "projet_sans_nom",
        framerate: exportFramerate,
        width: effectiveWidth,
        height: effectiveHeight,
        audioUrl: audioUrl || undefined,
        basePath: fullBasePath
      };

      console.log("Export options:", options);

      let content: string;
      let filename: string;
      
      switch (exportFormat) {
        case "premiere-xml":
          content = generatePremiereXML(generatedPrompts, options);
          filename = `${projectName || "export"}_premiere.xml`;
          break;
        case "edl":
          content = generateEDL(generatedPrompts, options);
          filename = `${projectName || "export"}.edl`;
          break;
        case "csv":
          content = generateCSV(generatedPrompts, options);
          filename = `${projectName || "export"}.csv`;
          break;
        default:
          toast.error("Format d'export non valide");
          return;
      }

      console.log("Content generated, length:", content?.length);
      console.log("Filename:", filename);

      if (exportMode === "with-images") {
        console.log("Starting ZIP download with images");
        toast.info("Préparation du ZIP avec les images...");
        await downloadImagesAsZip(generatedPrompts, content, filename, audioUrl || undefined);
        toast.success("Export ZIP téléchargé avec succès !");
        
        // Save export base path for future use
        if (exportBasePath) {
          await saveExportBasePath(exportBasePath);
        }
      } else {
        console.log("Starting file download");
        await downloadFile(content, filename);
        toast.success("Export téléchargé avec succès !");
      }

      setExportDialogOpen(false);
    } catch (error: any) {
      console.error("Error exporting:", error);
      toast.error(error.message || "Erreur lors de l'export");
    } finally {
      setIsExporting(false);
    }
  };

  const handleRenderVideo = async () => {
    if (!currentProjectId) {
      toast.error("Aucun projet sélectionné");
      return;
    }

    // Verify user is authenticated
    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !currentUser) {
      toast.error("Vous devez être connecté pour rendre une vidéo");
      return;
    }

    if (generatedPrompts.length === 0) {
      toast.error("Aucune scène à rendre");
      return;
    }

    // Check for missing images (skip in gameplay mode — no images needed)
    if (visualMode !== 'gameplay') {
      const missingImages = generatedPrompts.filter(p => p && p.prompt && !p.imageUrl);
      if (missingImages.length > 0) {
        toast.error(`${missingImages.length} scène(s) n'ont pas d'images. Générez les images manquantes d'abord.`);
        return;
      }
    }

    // Check for images that need upscaling (Z-Image 16:9 only, skip in gameplay mode)
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const is16x9 = aspectRatio === '16:9';
    if (visualMode !== 'gameplay' && isZImage && is16x9) {
      const imagesNeedingUpscale = generatedPrompts.filter((p: any) => {
        if (!p || !p.imageUrl) return false;
        if (p.isUpscaled === true) return false;
        const imgWidth = p.imageWidth || 0;
        const imgHeight = p.imageHeight || 0;
        if (imgWidth >= 1920 && imgHeight >= 1080) return false;
        return true;
      });
      
      if (imagesNeedingUpscale.length > 0) {
        toast.error(`${imagesNeedingUpscale.length} image(s) n'ont pas été upscalées. Cliquez sur "Vérifier upscale" puis upscalez les images avant le rendu.`);
        return;
      }
    }

    if (!audioUrl) {
      toast.error("Aucun fichier audio disponible. Uploadez un fichier audio d'abord.");
      return;
    }

    // Check if there are already active render jobs (across all projects to avoid rate limiting)
    const { data: activeRenderJobs, error: activeJobsError } = await supabase
      .from('video_render_jobs')
      .select('id, status, project_id, created_at')
      .in('status', ['pending', 'processing'])
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    
    if (activeRenderJobs && activeRenderJobs.length > 0) {
      const otherProjectJobs = activeRenderJobs.filter(j => j.project_id !== currentProjectId);
      if (otherProjectJobs.length > 0) {
        // Check if the most recent job was started less than 5 seconds ago (rate limiting protection)
        const mostRecentJob = otherProjectJobs[0];
        const jobAge = Date.now() - new Date(mostRecentJob.created_at).getTime();
        const minDelayMs = 5000; // 5 seconds minimum between render starts
        
        if (jobAge < minDelayMs) {
          const waitTime = Math.ceil((minDelayMs - jobAge) / 1000);
          toast.error(`Un rendu vient d'être lancé sur un autre projet. Veuillez attendre ${waitTime} seconde(s) avant de lancer un nouveau rendu pour éviter les erreurs de rate limiting.`);
          return;
        } else {
          // Show info toast but allow the render
          toast.info("Un autre rendu est en cours. Le nouveau rendu va démarrer dans quelques secondes...");
        }
      }
    }

    setIsRendering(true);

    try {
      // Fetch fresh project dimensions from DB (important after upscale)
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('image_width, image_height')
        .eq('id', currentProjectId)
        .single();
      
      // Use fresh dimensions from DB, fallback to state values
      const renderWidth = projectData?.image_width || imageWidth;
      const renderHeight = projectData?.image_height || imageHeight;
      
      console.log(`Rendering video with dimensions: ${renderWidth}x${renderHeight} (DB: ${projectData?.image_width}x${projectData?.image_height}, State: ${imageWidth}x${imageHeight})`);
      
      // Also update local state if dimensions changed
      if (projectData?.image_width && projectData.image_width !== imageWidth) {
        setImageWidth(projectData.image_width);
      }
      if (projectData?.image_height && projectData.image_height !== imageHeight) {
        setImageHeight(projectData.image_height);
      }

      const renderOptions: any = {
        projectId: currentProjectId!,
        framerate: exportFramerate,
        width: renderWidth,
        height: renderHeight,
        effectType: exportEffectType,
        renderMethod: exportRenderMethod,
        subtitleSettings: {
          enabled: false,
          fontSize: 18,
          fontFamily: 'Arial, sans-serif',
          color: '#ffffff',
          backgroundColor: '#000000',
          opacity: 0.8,
          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
          x: 50,
          y: 85
        },
      };

      if (visualMode === 'gameplay') {
        renderOptions.visualMode = 'gameplay';
        renderOptions.gameplayUrls = gameplayUrls;
        renderOptions.framerate = 30;
      }

      if (blackscreenUrl) {
        renderOptions.blackscreenUrl = blackscreenUrl;
        renderOptions.blackscreenOpacity = blackscreenOpacity;
      }
      
      // Use GPU rendering if toggle is enabled, otherwise use VPS
      const result = useGpuRendering 
        ? await renderVideoGpu(renderOptions)
        : await renderVideo(renderOptions);

      // VPS path returns statusUrl; GPU Pod path returns only jobId
      const isGpuPodJob = useGpuRendering && result.success && !!result.jobId && !result.statusUrl;
      const isVpsJob = !useGpuRendering && result.success && !!result.jobId && !!result.statusUrl;

      if (isVpsJob) {
        // Fallback: Create job in database if Edge Function didn't create it
        // (This can happen if there was an error during insertion)
        const { data: { user } } = await supabase.auth.getUser();
        if (user && currentProjectId) {
          const { data: existingJob } = await supabase
            .from('video_render_jobs')
            .select('id')
            .eq('job_id', result.jobId)
            .eq('project_id', currentProjectId)
            .single();

          if (!existingJob) {
            console.log('Creating video render job in database (fallback)...');
            const { data: newJob, error: insertError } = await supabase
              .from('video_render_jobs')
              .insert({
                project_id: currentProjectId,
                user_id: user.id,
                status: 'pending',
                progress: 0,
                job_id: result.jobId,
                status_url: result.statusUrl,
                steps: [],
                current_step: null,
                metadata: {
                  framerate: exportFramerate,
                  width: renderWidth,
                  height: renderHeight,
                },
              })
              .select()
              .single();

            if (insertError) {
              console.error('❌ Failed to create job in database (fallback):', insertError);
              console.error('Error code:', insertError.code);
              console.error('Error message:', insertError.message);
              console.error('Error details:', JSON.stringify(insertError, null, 2));
              toast.error(`Erreur lors de la création du job: ${insertError.message}`);
            } else {
              console.log('✅ Job created successfully (fallback):', newJob?.id);
              // Force a refresh of jobs to ensure it's picked up immediately
              setTimeout(() => refreshVideoRenderJobs(), 500);
              setTimeout(() => refreshVideoRenderJobs(), 2000);
            }
          } else {
            console.log('Job already exists in database:', existingJob.id);
          }
        }

        toast.success("Rendu vidéo démarré. Vous pouvez quitter cette page.");
        // Ensure the new render job appears without manual page refresh
        setTimeout(() => refreshVideoRenderJobs(), 500);
        setTimeout(() => refreshVideoRenderJobs(), 2000);
      } else if (isGpuPodJob) {
        toast.success("Rendu GPU (Pod) démarré. Vous pouvez quitter cette page.");
        // Ensure the new GPU render job appears without manual page refresh
        setTimeout(() => refreshGpuRenderJobs(), 500);
        setTimeout(() => refreshGpuRenderJobs(), 2000);
      } else {
        toast.error(result.error || "Erreur lors du démarrage du rendu vidéo");
      }
    } catch (error: any) {
      console.error("Error rendering video:", error);
      // Check if it's a rate limit error
      if (error.message?.includes('429') || error.message?.includes('Trop de requêtes') || error.message?.includes('rate limit')) {
        toast.error("Trop de requêtes simultanées. Veuillez attendre quelques secondes avant de relancer un rendu.");
      } else {
        toast.error(error.message || "Erreur lors du rendu vidéo");
      }
    } finally {
      setIsRendering(false);
    }
  };

  const handleLoadPreset = async (preset: {
    id: string;
    name: string;
    scene_duration_0to1: number;
    scene_duration_1to3: number;
    scene_duration_3plus: number;
    range_end_1: number;
    range_end_2: number;
    duration_ranges?: DurationRange[];
    example_prompts: string[];
    image_width: number;
    image_height: number;
    aspect_ratio: string;
    style_reference_url: string | null;
    image_model: string;
    prompt_system_message: string | null;
    lora_url?: string | null;
    lora_steps?: number;
    qa_prompt?: string | null;
  }) => {
    // Save preset_id to project for backend LoRA loading
    if (currentProjectId && preset.id) {
      await supabase
        .from('projects')
        .update({ preset_id: preset.id } as any)
        .eq('id', currentProjectId);
      console.log('[handleLoadPreset] Saved preset_id to project:', preset.id);
    }
    setCurrentPresetId(preset.id);
    // Use duration_ranges if available, otherwise build from legacy format
    if (preset.duration_ranges && preset.duration_ranges.length > 0) {
      setDurationRanges(preset.duration_ranges);
    } else {
      setDurationRanges(convertLegacyToRanges(
        preset.scene_duration_0to1,
        preset.scene_duration_1to3,
        preset.scene_duration_3plus,
        preset.range_end_1,
        preset.range_end_2
      ));
    }
    setExamplePrompts(preset.example_prompts);
    setImageWidth(preset.image_width);
    setImageHeight(preset.image_height);
    setAspectRatio(preset.aspect_ratio);
    setImageModel(preset.image_model);
    setLoraUrl(preset.lora_url || "");
    setLoraSteps(preset.lora_steps || 10);
    setQaEnabled((preset as any).qa_enabled === true);
    if ((preset as any).visual_mode) setVisualMode((preset as any).visual_mode);
    if ((preset as any).gameplay_urls && Array.isArray((preset as any).gameplay_urls)) {
      setGameplayUrls((preset as any).gameplay_urls);
    } else {
      setGameplayUrls([]);
    }
    setActivePresetName(preset.name);
    setPromptSystemMessage(preset.prompt_system_message || "");
    setQaPrompt(preset.qa_prompt || "");
    console.log('[handleLoadPreset] Loaded qaPrompt length:', (preset.qa_prompt || '').length);
    console.log('[handleLoadPreset] Loaded qaPrompt contains "SYMBOLES ICONOGRAPHIQUES":', (preset.qa_prompt || '').includes('SYMBOLES ICONOGRAPHIQUES'));
    const parsedUrls = parseStyleReferenceUrls(preset.style_reference_url);
    setStyleReferenceUrls(parsedUrls);
    if (parsedUrls.length > 0) {
      setUploadedStyleImageUrl(parsedUrls[0]);
    }
    // Clean up sessionStorage after auto-load (toast is handled by PresetManager)
    sessionStorage.removeItem("auto_load_project_preset_id");
  };

  const handleGenerateScenesClick = async () => {
    if (!transcriptData) {
      toast.error("Aucune transcription disponible");
      return;
    }
    
    // If scenes already exist, ask for confirmation
    if (scenes.length > 0) {
      const confirmed = window.confirm(
        `Des scènes existent déjà (${scenes.length}). Voulez-vous les regénérer ? Cela supprimera également les prompts et images existants.`
      );
      if (!confirmed) return;
      
      // Clear existing prompts and images
      setGeneratedPrompts([]);
    }
    
    setIsGeneratingScenes(true);
    try {
      const generatedScenes = parseTranscriptToScenes(
        transcriptData,
        durationRanges,
        undefined, undefined, undefined, undefined,
        preferSentenceBoundaries
      );
      
      setScenes(generatedScenes);
      toast.success(`${generatedScenes.length} scènes générées !`);
    } catch (error: any) {
      console.error("Error generating scenes:", error);
      toast.error("Erreur lors de la génération des scènes");
    } finally {
      setIsGeneratingScenes(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show loading state while project is being loaded
  if (currentProjectId && !loadAttemptDoneRef.current) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
        <AppHeader />
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Chargement du projet...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <AppHeader>
        {currentProjectId && projectName && (
          <>
            <span className="text-muted-foreground hidden sm:inline">/</span>
            {isEditingProjectName ? (
              <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
                <Input
                  value={editingProjectNameValue}
                  onChange={(e) => setEditingProjectNameValue(sanitizeProjectName(e.target.value))}
                  className="h-8 w-full sm:w-64 min-w-0"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveProjectName();
                    }
                    if (e.key === "Escape") {
                      setIsEditingProjectName(false);
                      setEditingProjectNameValue("");
                    }
                  }}
                />
                <Button size="sm" onClick={handleSaveProjectName} className="flex-shrink-0 hidden sm:inline-flex">Enregistrer</Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  setIsEditingProjectName(false);
                  setEditingProjectNameValue("");
                }} className="flex-shrink-0 hidden sm:inline-flex">Annuler</Button>
                <Button size="icon" onClick={handleSaveProjectName} className="flex-shrink-0 sm:hidden h-8 w-8">
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => {
                  setIsEditingProjectName(false);
                  setEditingProjectNameValue("");
                }} className="flex-shrink-0 sm:hidden h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="group min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm sm:text-lg font-semibold truncate">{projectName}</h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => {
                      setEditingProjectNameValue(projectName);
                      setIsEditingProjectName(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {(calendarDate || calendarChannelName || calendarStatus) && (
                  <div className="flex items-center gap-3 text-xs mt-0.5">
                    {calendarDate && (
                      <div className="flex items-center gap-1.5 text-primary">
                        <Calendar className="h-3 w-3" />
                        <span>
                          Prévu le {new Date(calendarDate).toLocaleDateString("fr-FR", {
                            day: "numeric",
                            month: "short",
                            year: "numeric"
                          })}
                        </span>
                      </div>
                    )}
                    {calendarChannelName && (
                      <span 
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: calendarChannelColor || '#6b7280' }}
                      >
                        📺 {calendarChannelName}
                      </span>
                    )}
                    {calendarStatus && (
                      <span 
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          calendarStatus === 'completed' ? 'bg-green-100 text-green-800' :
                          calendarStatus === 'thumbnail' ? 'bg-blue-100 text-blue-800' :
                          calendarStatus === 'generating' ? 'bg-purple-100 text-purple-800' :
                          calendarStatus === 'audio_ready' ? 'bg-yellow-100 text-yellow-800' :
                          calendarStatus === 'scripted' ? 'bg-orange-100 text-orange-800' :
                          calendarStatus === 'planned' ? 'bg-gray-100 text-gray-800' :
                          'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {calendarStatus === 'completed' && '✅'}
                        {calendarStatus === 'thumbnail' && '🖼️'}
                        {calendarStatus === 'generating' && '⚙️'}
                        {calendarStatus === 'audio_ready' && '🎵'}
                        {calendarStatus === 'scripted' && '📝'}
                        {calendarStatus === 'planned' && '📋'}
                        {' '}
                        {calendarStatus === 'completed' ? 'Terminé' :
                         calendarStatus === 'thumbnail' ? 'Miniature' :
                         calendarStatus === 'generating' ? 'Génération' :
                         calendarStatus === 'audio_ready' ? 'Audio prêt' :
                         calendarStatus === 'scripted' ? 'Scripté' :
                         calendarStatus === 'planned' ? 'Planifié' :
                         calendarStatus}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </AppHeader>

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {!currentProjectId ? (
          <Card className="p-12 text-center">
            <Sparkles className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-2">Sélectionnez un projet</h2>
            <p className="text-muted-foreground mb-6">
              Cliquez sur "Mes projets" pour sélectionner ou créer un projet
            </p>
            <Button asChild>
              <Link to="/projects">
                <FolderOpen className="h-4 w-4 mr-2" />
                Voir mes projets
              </Link>
            </Button>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
            <div className="border-b -mx-2 sm:mx-0 px-2 sm:px-0 overflow-x-auto">
              <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
                <TabsTrigger value="video" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Video className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Vidéo</span>
                </TabsTrigger>
                <TabsTrigger value="thumbnails" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <ImageIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Miniatures</span>
                </TabsTrigger>
                <TabsTrigger value="thumbnails-v2" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <ImageIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Miniature V2</span>
                </TabsTrigger>
                <TabsTrigger value="youtube" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">YouTube</span>
                </TabsTrigger>
                <TabsTrigger value="transcript" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Type className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Script</span>
                </TabsTrigger>
                <TabsTrigger value="audio" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Play className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Audio</span>
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Play className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Aperçu</span>
                </TabsTrigger>
                <TabsTrigger value="renders" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Video className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden md:inline">Rendu final</span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Banner fixe pour les jobs actifs - sticky sous le header */}
            {(() => {
              // Check if there are any non-dismissed completed jobs (VPS)
              const hasNonDismissedCompleted = allVideoRenderJobs.some(j => {
                if (j.status === 'completed') {
                  if (typeof window !== 'undefined') {
                    const dismissedKey = `video-render-dismissed-${j.id}`;
                    return localStorage.getItem(dismissedKey) !== 'true';
                  }
                  return true;
                }
                return false;
              });

              // Check if there are any non-dismissed completed GPU jobs
              const hasNonDismissedGpuCompleted = allGpuRenderJobs.some(j => {
                if (j.status === 'completed') {
                  if (typeof window !== 'undefined') {
                    const dismissedKey = `gpu-render-dismissed-${j.id}`;
                    return localStorage.getItem(dismissedKey) !== 'true';
                  }
                  return true;
                }
                return false;
              });
              
              const shouldShowBanner = activeJobs.length > 0 || activeVideoRenderJobs.length > 0 || activeGpuRenderJobs.length > 0 || hasNonDismissedCompleted || hasNonDismissedGpuCompleted;
              
              if (!shouldShowBanner) return null;
              
              return (
                <div className="sticky top-[88px] z-30 bg-background border rounded-lg p-3 mb-4 shadow-md space-y-2">
                  {activeJobs.length > 0 && (
                    <ActiveJobsBanner 
                      jobs={activeJobs} 
                      onCancel={cancelJob}
                    />
                  )}
                  {(activeVideoRenderJobs.length > 0 || hasNonDismissedCompleted) && (
                    <ActiveVideoRenderJobsBanner 
                      jobs={allVideoRenderJobs}
                      onCancel={async (jobId) => {
                        try {
                          // Get job details to find status_url
                          const job = allVideoRenderJobs.find(j => j.id === jobId);
                          if (!job) {
                            toast.error('Job introuvable');
                            return;
                          }

                          // Cancel on VPS if status_url exists
                          if (job.status_url && job.job_id) {
                            try {
                              // Extract base URL from status_url (e.g., http://51.91.158.233:3000/status/xxx -> http://51.91.158.233:3000)
                              const statusUrlObj = new URL(job.status_url);
                              const baseUrl = `${statusUrlObj.protocol}//${statusUrlObj.host}`;
                              const cancelUrl = `${baseUrl}/cancel/${job.job_id}`;
                              
                              const response = await fetch(cancelUrl, {
                                method: 'DELETE',
                              });
                              
                              if (!response.ok) {
                                console.error('Failed to cancel job on VPS:', response.statusText);
                                // Continue anyway to update database
                              } else {
                                console.log('Job cancelled on VPS');
                              }
                            } catch (error) {
                              console.error('Error calling VPS cancel endpoint:', error);
                              // Continue anyway to update database
                            }
                          }

                          // Update database status
                          const { error } = await supabase
                            .from('video_render_jobs')
                            .update({ status: 'cancelled' })
                            .eq('id', jobId);
                          
                          if (error) {
                            console.error('Error cancelling video render job:', error);
                            toast.error('Erreur lors de l\'annulation du rendu');
                          } else {
                            toast.success('Rendu arrêté sur le serveur');
                            // Force immediate refresh to remove cancelled job from UI
                            setTimeout(() => {
                              refreshVideoRenderJobs();
                            }, 100);
                          }
                        } catch (error) {
                          console.error('Error cancelling job:', error);
                          toast.error('Erreur lors de l\'annulation du rendu');
                        }
                      }}
                    />
                  )}
                  {(activeGpuRenderJobs.length > 0 || hasNonDismissedGpuCompleted) && (
                    <ActiveGpuRenderJobsBanner 
                      jobs={allGpuRenderJobs}
                      onCancel={async (jobId) => {
                        try {
                          // Update database status to cancelled
                          const { error } = await supabase
                            .from('gpu_render_jobs')
                            .update({ status: 'cancelled' })
                            .eq('id', jobId);
                          
                          if (error) {
                            toast.error('Erreur lors de l\'annulation du rendu GPU');
                          } else {
                            toast.success('Rendu GPU annulé');
                            // Refresh to update UI
                            setTimeout(() => {
                              refreshGpuRenderJobs();
                            }, 100);
                          }
                        } catch (error) {
                          console.error('[GPU] Error cancelling job:', error);
                          toast.error('Erreur lors de l\'annulation du rendu GPU');
                        }
                      }}
                    />
                  )}
                </div>
              );
            })()}

            <TabsContent value="video" className="space-y-6 m-0">
                {transcriptData ? (
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="font-medium">Transcription chargée</span>
                      {audioUrl && (
                        <>
                          <span className="text-muted-foreground hidden sm:inline">•</span>
                          <span className="text-muted-foreground">Audio chargé</span>
                        </>
                      )}
                      {examplePrompts.some(p => p.trim()) && (
                        <>
                          <span className="text-muted-foreground hidden sm:inline">•</span>
                          <span className="text-muted-foreground">Prompts configurés</span>
                        </>
                      )}
                      {scenes.length > 0 && (
                        <>
                          <span className="text-muted-foreground hidden sm:inline">•</span>
                          <span className="text-muted-foreground">{scenes.length} scènes</span>
                        </>
                      )}
                      {transcriptData.segments && transcriptData.segments.length > 0 && (
                        <>
                          <span className="text-muted-foreground hidden sm:inline">•</span>
                          <span className="text-muted-foreground">
                            {transcriptData.segments.map(s => s.text).join(' ').split(/\s+/).filter(w => w).length} mots
                          </span>
                          <span className="text-muted-foreground hidden sm:inline">•</span>
                          <span className="text-muted-foreground">
                            {Math.floor(transcriptData.segments[transcriptData.segments.length - 1].end_time / 60)}:{String(Math.floor(transcriptData.segments[transcriptData.segments.length - 1].end_time % 60)).padStart(2, '0')}
                          </span>
                        </>
                      )}
                    </div>
                  </Card>
                ) : currentProjectId && audioUrl ? (
                  <Card className="p-4 bg-amber-500/10 border-amber-500/30">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        <span className="text-muted-foreground">Audio chargé mais pas de transcription.</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/projects?from_scratch=true&project=${currentProjectId}&needs_transcription=true`)}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          Lancer la transcription
                        </Button>
                      </div>
                    </div>
                  </Card>
                ) : currentProjectId ? (
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 text-primary flex-shrink-0 animate-spin" />
                      <span className="text-muted-foreground">Chargement de la transcription...</span>
                    </div>
                  </Card>
                ) : null}

                {/* Transcription en cours en arrière-plan */}
                {!transcriptData && hasActiveJob('transcription') && (
                  <Card className="p-6 bg-primary/5 border-primary/30">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div className="relative">
                        <Cloud className="h-12 w-12 text-primary animate-pulse" />
                        <Loader2 className="h-6 w-6 text-primary animate-spin absolute -bottom-1 -right-1" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold mb-1">Transcription en cours...</h3>
                        <p className="text-sm text-muted-foreground">
                          La transcription de votre audio est en cours de traitement en arrière-plan.
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Vous pouvez quitter cette page, la transcription continuera.
                        </p>
                      </div>
                      {getJobByType('transcription') && (
                        <div className="w-full max-w-md space-y-2">
                          <Progress 
                            value={
                              getJobByType('transcription')!.total > 0
                                ? (getJobByType('transcription')!.progress / getJobByType('transcription')!.total) * 100
                                : 0
                            } 
                            className="h-2"
                          />
                          <p className="text-xs text-muted-foreground">
                            Traitement en cours...
                          </p>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const job = getJobByType('transcription');
                          if (job) cancelJob(job.id);
                        }}
                      >
                        Annuler la transcription
                      </Button>
                    </div>
                  </Card>
                )}

                {!transcriptData && !hasActiveJob('transcription') && (
                  <>
                    <Card className="p-6">
                      <h2 className="text-lg font-semibold mb-4">1. Importer la transcription</h2>
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="transcript-upload" className="cursor-pointer">
                            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                              <p className="text-sm font-medium mb-1">
                                {transcriptFile ? transcriptFile.name : "Cliquez pour importer un fichier JSON"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Format: JSON de transcription
                              </p>
                            </div>
                            <input
                              id="transcript-upload"
                              type="file"
                              accept=".json"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <h2 className="text-lg font-semibold mb-4">1b. Importer l'audio (optionnel)</h2>
                      <div className="space-y-4">
                        <div>
                          <div
                            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                              isDraggingAudio ? 'border-primary bg-primary/10' : 'border-muted-foreground/25 hover:border-primary/50'
                            }`}
                            onDragOver={handleAudioDragOver}
                            onDragLeave={handleAudioDragLeave}
                            onDrop={handleAudioDrop}
                            onClick={() => document.getElementById('audio-upload')?.click()}
                          >
                            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm font-medium mb-1">
                              {audioFile ? audioFile.name : audioUrl ? "Audio chargé" : "Glissez-déposez ou cliquez pour importer"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Format: MP3, WAV, M4A, etc.
                            </p>
                            {isUploadingAudio && (
                              <div className="mt-4 flex flex-col items-center gap-2">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                <p className="text-sm font-medium text-primary">Upload en cours...</p>
                              </div>
                            )}
                            <input
                              id="audio-upload"
                              type="file"
                              accept="audio/*"
                              onChange={handleAudioUpload}
                              className="hidden"
                              disabled={isUploadingAudio}
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
                  </>
                )}

                <PresetManager
                  currentConfig={{
                    durationRanges,
                    examplePrompts,
                    imageWidth,
                    imageHeight,
                    aspectRatio,
                    styleReferenceUrls,
                    imageModel,
                    promptSystemMessage,
                    loraUrl,
                    loraSteps,
                    qaPrompt,
                    visualMode,
                    gameplayUrls,
                  }}
                  onLoadPreset={handleLoadPreset}
                  currentPresetId={currentPresetId || undefined}
                />

                {activePresetName && (
                  <Card className="p-3 bg-primary/10 border-primary/30 mb-4">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        Preset actif : <span className="text-primary">{activePresetName}</span>
                      </span>
                    </div>
                  </Card>
                )}

                {/* CTA when transcription is done but no scenes AND no prompts yet */}
                {transcriptData && scenes.length === 0 && generatedPrompts.length === 0 && !isAnimatorChannel && (
                  <Card className="p-6 border-2 border-primary/50 bg-primary/5 mb-6">
                    <div className="flex items-start gap-4">
                      <div className="rounded-full bg-primary/10 p-3">
                        <Sparkles className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">Transcription prête !</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Configurez les paramètres puis générez vos scènes pour continuer.
                        </p>
                        <Button onClick={() => setShowConfigurationModal(true)} size="lg">
                          <Settings className="mr-2 h-4 w-4" />
                          Configurer et générer les scènes
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* CTA for Remotion Animator channels — no scenes yet → configure first */}
                {transcriptData && isAnimatorChannel && scenes.length === 0 && !animatorVideoUrl && !isAnimatorGenerating && (
                  <Card className="p-6 border-2 border-purple-500/50 bg-purple-500/5 mb-6">
                    <div className="flex items-start gap-4">
                      <div className="rounded-full bg-purple-500/10 p-3">
                        <Sparkles className="h-6 w-6 text-purple-500" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">Transcription prête — Mode Remotion Animator</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Configurez les durées de scènes puis lancez la génération Remotion via Claude.
                        </p>
                        <Button
                          size="lg"
                          className="bg-purple-600 hover:bg-purple-700"
                          onClick={() => setShowConfigurationModal(true)}
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          Configurer les scènes
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* CTA for Remotion Animator channels — scenes exist → launch animator */}
                {transcriptData && isAnimatorChannel && scenes.length > 0 && !isAnimatorGenerating && (() => {
                  const allScenesCompleted = animatorSceneStatuses.length > 0 && animatorSceneStatuses.every(s => s.animator_code_status === 'completed');
                  const failedScenes = animatorSceneStatuses.filter(s => s.animator_code_status === 'failed');
                  const hasAnySceneCode = animatorSceneStatuses.length > 0;

                  return (
                    <Card className="p-6 border-2 border-purple-500/50 bg-purple-500/5 mb-6">
                      <div className="flex items-start gap-4">
                        <div className="rounded-full bg-purple-500/10 p-3">
                          <Sparkles className="h-6 w-6 text-purple-500" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1">
                            {allScenesCompleted
                              ? `${animatorSceneStatuses.length} scènes générées — Prêt pour le rendu`
                              : failedScenes.length > 0
                                ? `${failedScenes.length} scène(s) en erreur — Corrigez avant le rendu`
                                : `${scenes.length} scènes prêtes — Mode Remotion Animator`
                            }
                          </h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            {allScenesCompleted
                              ? "Toutes les scènes ont été générées. Lancez le rendu pour assembler la vidéo."
                              : failedScenes.length > 0
                                ? "Régénérez les scènes en erreur ci-dessous, puis lancez le rendu."
                                : "Les scènes seront envoyées à Claude une par une pour générer l'animation."
                            }
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            {allScenesCompleted && (
                              <Button
                                size="lg"
                                className="bg-green-600 hover:bg-green-700"
                                onClick={async () => {
                                  if (!currentProjectId) return;
                                  setIsAnimatorGenerating(true);
                                  try {
                                    const { data: calEntry } = await supabase
                                      .from("content_calendar")
                                      .select("id, channel_id")
                                      .eq("project_id", currentProjectId)
                                      .not("channel_id", "is", null)
                                      .limit(1)
                                      .single();
                                    const userId = (await supabase.auth.getUser()).data.user?.id;
                                    const { error } = await (supabase.from("auto_pipelines" as any) as any).insert({
                                      project_id: currentProjectId,
                                      user_id: userId,
                                      channel_id: calEntry?.channel_id || null,
                                      calendar_entry_id: calEntry?.id || null,
                                      step_status: "pending",
                                      current_step: "animator_render",
                                      metadata: {},
                                    });
                                    if (error) throw error;
                                    toast.success("Rendu Animator lancé !");
                                  } catch (e: any) {
                                    toast.error("Erreur: " + e.message);
                                  } finally {
                                    setIsAnimatorGenerating(false);
                                  }
                                }}
                              >
                                <Video className="mr-2 h-4 w-4" />
                                Lancer le rendu
                              </Button>
                            )}
                            {!allScenesCompleted && (
                              <Button
                                size="lg"
                                className="bg-purple-600 hover:bg-purple-700"
                                disabled={isAnimatorGenerating}
                                onClick={async () => {
                                  if (!currentProjectId) return;
                                  setIsAnimatorGenerating(true);
                                  try {
                                    await startJob('animator_scenes' as any);
                                  } catch (e: any) {
                                    toast.error("Erreur: " + e.message);
                                    setIsAnimatorGenerating(false);
                                  }
                                }}
                              >
                                <Sparkles className="mr-2 h-4 w-4" />
                                Lancer l'Animator
                              </Button>
                            )}
                            {hasAnySceneCode && (
                              <Button
                                variant="outline"
                                size="lg"
                                disabled={isAnimatorGenerating}
                                onClick={async () => {
                                  if (!currentProjectId) return;
                                  const confirmed = window.confirm("Supprimer toutes les scènes générées et tout régénérer ?");
                                  if (!confirmed) return;
                                  setIsAnimatorGenerating(true);
                                  try {
                                    await supabase
                                      .from('project_scenes')
                                      .update({ animator_code: null, animator_code_status: null })
                                      .eq('project_id', currentProjectId);
                                    await supabase
                                      .from('projects')
                                      .update({ animator_video_url: null, animator_tokens: null, animator_cost_usd: null })
                                      .eq('id', currentProjectId);
                                    setAnimatorVideoUrl(null);
                                    setAnimatorTokens(null);
                                    setAnimatorCostUsd(null);
                                    setAnimatorSceneStatuses([]);
                                    await startJob('animator_scenes' as any);
                                  } catch (e: any) {
                                    toast.error("Erreur: " + e.message);
                                    setIsAnimatorGenerating(false);
                                  }
                                }}
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Tout régénérer
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="lg"
                              onClick={() => setShowConfigurationModal(true)}
                            >
                              <Settings className="mr-2 h-4 w-4" />
                              Reconfigurer les scènes
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })()}


                {isAnimatorChannel && isAnimatorGenerating && (() => {
                  const animatorJob = getJobByType('animator_scenes' as any);
                  const scenesDone = animatorSceneStatuses.filter(s => s.animator_code_status === 'completed').length;
                  const scenesFailed = animatorSceneStatuses.filter(s => s.animator_code_status === 'failed').length;
                  const scenesTotal = animatorJob?.total || animatorSceneStatuses.length || scenes.length;
                  const pct = scenesTotal > 0 ? Math.round(((scenesDone + scenesFailed) / scenesTotal) * 100) : 0;
                  return (
                    <Card className="p-4 border-2 border-purple-500/30 bg-purple-500/5 mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                          <span className="text-sm font-medium">Génération Animator en cours</span>
                        </div>
                        {animatorJob && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-red-500"
                            onClick={() => animatorJob && cancelJob(animatorJob.id)}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Annuler
                          </Button>
                        )}
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5 mb-1">
                        <div className="bg-purple-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {scenesDone}/{scenesTotal} scènes générées{scenesFailed > 0 ? ` (${scenesFailed} échouée${scenesFailed > 1 ? 's' : ''})` : ''}
                      </p>
                    </Card>
                  );
                })()}

                {isAnimatorChannel && !isAnimatorGenerating && animatorPipelineStatus && ['animator_render', 'wait_animator_render'].includes(animatorPipelineStatus.current_step) && animatorPipelineStatus.step_status !== 'failed' && (
                  <Card className="p-4 border-2 border-green-500/30 bg-green-500/5 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="h-4 w-4 animate-spin text-green-500" />
                      <span className="text-sm font-medium">Rendu Animator en cours...</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div className="bg-green-500 h-1.5 rounded-full transition-all animate-pulse" style={{ width: '60%' }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Assemblage et rendu Remotion en cours</p>
                  </Card>
                )}

                {isAnimatorChannel && animatorPipelineStatus?.step_status === 'failed' && (
                  <Card className="p-4 border-2 border-red-500/30 bg-red-500/5 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <X className="h-4 w-4 text-red-500" />
                      <span className="text-sm font-medium text-red-500">Rendu Animator échoué</span>
                    </div>
                    <p className="text-xs text-muted-foreground break-all">{(animatorPipelineStatus as any)?.error?.slice(0, 300) || 'Erreur inconnue'}</p>
                  </Card>
                )}

                <div className={`grid gap-4 md:gap-6 ${isAnimatorChannel ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'}`}>
                  {/* Configuration des scènes */}
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Scènes configurées</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSceneSettingsOpen(true)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {durationRanges.map((range, index) => {
                        const prevEnd = index > 0 ? durationRanges[index - 1].endSeconds : 0;
                        const label = range.endSeconds === null 
                          ? `${prevEnd}s+` 
                          : index === 0 
                            ? `0-${range.endSeconds}s`
                            : `${prevEnd}-${range.endSeconds}s`;
                        return (
                          <div key={index}>{label}: {range.sceneDuration}s par scène</div>
                        );
                      })}
                    </div>
                    {!scenes.length && generatedPrompts.length === 0 && (
                      <Button
                        onClick={handleGenerateScenesClick}
                        disabled={!transcriptData || isGeneratingScenes}
                        className="w-full mt-3"
                        size="sm"
                      >
                        {isGeneratingScenes ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Génération...
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Générer les scènes
                          </>
                        )}
                      </Button>
                    )}
                  </Card>

                  {!isAnimatorChannel && (
                  <>
                  {/* Configuration des prompts */}
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Prompts configurés</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPromptSettingsOpen(true)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {examplePrompts.filter(p => p.trim()).length}/3 exemples définis
                    </div>
                  </Card>

                  {/* Configuration des images */}
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Images configurées</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setImageSettingsOpen(true)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>
                        {(() => {
                          const isZImageTurbo = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
                          if (isZImageTurbo && (imageWidth > 1440 || imageHeight > 1440)) {
                            const MAX_DIM = 1440;
                            const scale = Math.min(MAX_DIM / imageWidth, MAX_DIM / imageHeight);
                            let effectiveWidth = Math.floor(imageWidth * scale);
                            let effectiveHeight = Math.floor(imageHeight * scale);
                            effectiveWidth = Math.ceil(effectiveWidth / 16) * 16;
                            effectiveHeight = Math.ceil(effectiveHeight / 16) * 16;
                            return `${effectiveWidth}x${effectiveHeight} (${aspectRatio})`;
                          }
                          return `${imageWidth}x${imageHeight} (${aspectRatio})`;
                        })()}
                      </div>
                      <div>{styleReferenceUrls.length > 0 ? `${styleReferenceUrls.length} image(s) de référence` : "Pas de référence"}</div>
                    </div>
                  </Card>
                  </>
                  )}
                </div>

                {!isAnimatorChannel && (scenes.length > 0 || generatedPrompts.length > 0) && (
                  <Card className="p-6">
                    <div className="space-y-4">
                      {/* Header avec titre et boutons */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <h2 className="text-lg font-semibold">
                              Scènes générées ({scenes.length > 0 ? scenes.length : generatedPrompts.length})
                              {generatedPrompts.length > 0 && ` - ${generatedPrompts.length} prompts`}
                            </h2>
                            {selectedScenes.size > 0 && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                                {selectedScenes.size} sélectionnée{selectedScenes.size > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {generatedPrompts.filter(p => p && p.imageUrl).length > 0 && (
                              <>
                                <Button
                                  onClick={() => setExportDialogOpen(true)}
                                  variant="outline"
                                  size="sm"
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  Exporter pour montage
                                </Button>
                                {generatedPrompts.filter(p => p && p.imageUrl).length > 0 && (
                                  <>
                                    <Select
                                      value={currentRenderPresetId || "_none"}
                                      onValueChange={(v) => applyRenderPreset(v === "_none" ? null : v)}
                                    >
                                      <SelectTrigger className="w-[160px] h-9">
                                        <SelectValue placeholder="Preset rendu" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="_none">Sans preset</SelectItem>
                                        {renderPresets.map((rp: any) => (
                                          <SelectItem key={rp.id} value={rp.id}>{rp.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Select 
                                      value={exportFramerate.toString()} 
                                      onValueChange={(value) => setExportFramerate(Number(value))}
                                      disabled={!audioUrl}
                                    >
                                      <SelectTrigger className="w-[140px] h-9">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="1">1 fps</SelectItem>
                                        <SelectItem value="5">5 fps</SelectItem>
                                        <SelectItem value="10">10 fps</SelectItem>
                                        <SelectItem value="15">15 fps</SelectItem>
                                        <SelectItem value="23.976">23.976 fps</SelectItem>
                                        <SelectItem value="24">24 fps</SelectItem>
                                        <SelectItem value="25">25 fps</SelectItem>
                                        <SelectItem value="29.97">29.97 fps</SelectItem>
                                        <SelectItem value="30">30 fps</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Select 
                                      value={exportEffectType} 
                                      onValueChange={(value) => setExportEffectType(value as 'opencv_zoom' | 'pan' | 'none')}
                                      disabled={!audioUrl}
                                    >
                                      <SelectTrigger className="w-[180px] h-9">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">Aucun effet</SelectItem>
                                        <SelectItem value="pan">Pan (Vitesse constante)</SelectItem>
                                        <SelectItem value="opencv_zoom">Zoom GPU</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-md">
                                      <Switch
                                        id="gpu-mode"
                                        checked={useGpuRendering}
                                        onCheckedChange={setUseGpuRendering}
                                        disabled={!audioUrl}
                                      />
                                      <Label htmlFor="gpu-mode" className="text-xs font-medium cursor-pointer">
                                        GPU
                                      </Label>
                                    </div>
                                    {blackscreenUrl && (
                                      <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 rounded-md" title={`Particles ${Math.round(blackscreenOpacity * 100)}%`}>
                                        <span className="text-xs">✨ {Math.round(blackscreenOpacity * 100)}%</span>
                                      </div>
                                    )}
                                    <Button
                                      onClick={handleRenderVideo}
                                      size="sm"
                                    >
                                      <Video className="mr-2 h-4 w-4" />
                                      Rendu vidéo
                                    </Button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        

                        {/* Boutons d'action - organisés en groupes */}
                        <div className="flex flex-col gap-3">
                          {visualMode === 'gameplay' && (
                            <div className="flex items-center gap-2 justify-between p-2 bg-muted/50 rounded-md">
                              <div className="flex items-center gap-2">
                                <Video className="h-4 w-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Mode Gameplay — {gameplayUrls.length} vidéo(s) configurée(s)</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">30 fps</span>
                                <Button
                                  onClick={handleRenderVideo}
                                  size="sm"
                                  disabled={!audioUrl || gameplayUrls.length === 0}
                                >
                                  <Video className="mr-2 h-4 w-4" />
                                  Rendu vidéo
                                </Button>
                              </div>
                            </div>
                          )}
                          {/* Ligne 1: Prompts */}
                          {visualMode !== 'gameplay' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground w-16">Prompts</span>
                            <div className="flex items-center gap-2">
                              <Button
                                onClick={() => handleGeneratePrompts(false)}
                                disabled={isGeneratingPrompts}
                                size="sm"
                              >
                                {isGeneratingPrompts ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Génération...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    Générer prompts
                                  </>
                                )}
                              </Button>
                              {generatedPrompts.length > 0 && (
                                <Button
                                  onClick={() => {
                                    const missingPromptIndices = generatedPrompts
                                      .map((p, index) => ({ prompt: p, index }))
                                      .filter(item => !item.prompt || !item.prompt.prompt)
                                      .map(item => item.index + 1);
                                    
                                    const presentCount = generatedPrompts.filter(p => p && p.prompt).length;
                                    
                                    if (missingPromptIndices.length > 0) {
                                      toast.error(
                                        `⚠️ ${missingPromptIndices.length} scène(s) sans prompt : ${missingPromptIndices.slice(0, 10).join(", ")}${missingPromptIndices.length > 10 ? '...' : ''}`,
                                        { duration: 10000 }
                                      );
                                    } else {
                                      toast.success(`✅ Tous les prompts sont présents (${presentCount}/${scenes.length})`);
                                    }
                                  }}
                                  variant="outline"
                                  size="sm"
                                  title="Vérifier si tous les prompts sont générés"
                                >
                                  <Check className="mr-2 h-4 w-4" />
                                  Vérifier
                                </Button>
                              )}
                              {isGeneratingPrompts && getJobByType('prompts') && (
                                <Button
                                  onClick={() => {
                                    const job = getJobByType('prompts');
                                    if (job) cancelJob(job.id);
                                  }}
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                >
                                  <X className="mr-1 h-4 w-4" />
                                  Annuler
                                </Button>
                              )}
                            </div>
                          </div>
                          )}
                          
                          {/* Ligne 2: Images */}
                          {visualMode !== 'gameplay' && generatedPrompts.length > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground w-16">Images</span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  onClick={() => generateAllImages(true)}
                                  disabled={
                                    isGeneratingImages || 
                                    generatedPrompts.length < scenes.length
                                  }
                                  title={
                                    generatedPrompts.length < scenes.length
                                      ? "Veuillez d'abord générer tous les prompts"
                                      : ""
                                  }
                                  size="sm"
                                >
                                  {isGeneratingImages ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      En cours...
                                    </>
                                  ) : (
                                    <>
                                      <ImageIcon className="mr-2 h-4 w-4" />
                                      Générer images
                                    </>
                                  )}
                                </Button>
                                {!isGeneratingImages && (
                                  <Button
                                    onClick={() => {
                                      const missingPromptIndices = generatedPrompts
                                        .map((p, index) => ({ prompt: p, index }))
                                        .filter(item => !item.prompt || !item.prompt.prompt)
                                        .map(item => item.index + 1);
                                      
                                      const missingImageIndices = generatedPrompts
                                        .map((p, index) => ({ prompt: p, index }))
                                        .filter(item => item.prompt && item.prompt.prompt && !item.prompt.imageUrl)
                                        .map(item => item.index + 1);
                                      
                                      if (missingPromptIndices.length > 0) {
                                        toast.error(
                                          `⚠️ ${missingPromptIndices.length} scène(s) sans prompt : ${missingPromptIndices.join(", ")}. Régénérez les prompts d'abord.`,
                                          { duration: 10000 }
                                        );
                                        setMissingImagesInfo({
                                          count: missingPromptIndices.length + missingImageIndices.length,
                                          indices: [...missingPromptIndices, ...missingImageIndices]
                                        });
                                      } else if (missingImageIndices.length === 0) {
                                        setMissingImagesInfo(null);
                                        toast.success("✅ Toutes les images ont été générées !");
                                      } else {
                                        setMissingImagesInfo({
                                          count: missingImageIndices.length,
                                          indices: missingImageIndices
                                        });
                                        toast.warning(
                                          `⚠️ ${missingImageIndices.length} scène(s) sans image : ${missingImageIndices.join(", ")}`,
                                          { duration: 8000 }
                                        );
                                      }
                                    }}
                                    variant="outline"
                                    size="sm"
                                  >
                                    <Check className="mr-2 h-4 w-4" />
                                    Vérifier
                                  </Button>
                                )}
                                {!isGeneratingImages && generatedPrompts.some((p: any) => p && p.imageUrl) && (
                                  <Button
                                    onClick={runManualQA}
                                    title="Vérifier la qualité des images (détection d'artefacts et erreurs)"
                                    size="sm"
                                    variant="outline"
                                  >
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    QA
                                  </Button>
                                )}
                                {(() => {
                                  const withQA = generatedPrompts.filter((p: any) => p?.qa_checked);
                                  const ok = withQA.filter((p: any) => p?.qa_status === 'OK').length;
                                  const rejected = withQA.filter((p: any) => p?.qa_status === 'REJECT').length;
                                  const regen = generatedPrompts.filter((p: any) => p?.was_regenerated).length;
                                  if (withQA.length === 0 && regen === 0) return null;
                                  return (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1.5 ml-1">
                                      {withQA.length > 0 && (
                                        <>
                                          <span className="text-green-500 font-medium">{ok}✓</span>
                                          <span className="text-red-500 font-medium">{rejected}✗</span>
                                        </>
                                      )}
                                      {regen > 0 && (
                                        <span className="text-blue-500 font-medium">{regen} regen</span>
                                      )}
                                    </span>
                                  );
                                })()}
                                {isGeneratingImages && getJobByType('images') && (
                                  <Button
                                    onClick={() => {
                                      const job = getJobByType('images');
                                      if (job) cancelJob(job.id);
                                    }}
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <X className="mr-1 h-4 w-4" />
                                    Annuler
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Ligne 3: Upscale (si applicable) */}
                          {visualMode !== 'gameplay' && generatedPrompts.length > 0 && !isGeneratingImages && (imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora') && aspectRatio === '16:9' && generatedPrompts.some((p: any) => p && p.imageUrl) && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground w-16">Upscale</span>
                              <div className="flex items-center gap-2">
                                <Button
                                  onClick={generateUpscale}
                                  disabled={hasActiveJob('upscale')}
                                  title="Upscaler toutes les images en 1920x1088"
                                  size="sm"
                                >
                                  {hasActiveJob('upscale') ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      En cours...
                                    </>
                                  ) : (
                                    <>
                                      <Maximize2 className="mr-2 h-4 w-4" />
                                      Lancer (1920x1088)
                                    </>
                                  )}
                                </Button>
                                <Button
                                  onClick={async () => {
                                    if (currentProjectId) {
                                      try {
                                        console.log("[Vérifier upscale] Checking for stuck upscale jobs...");
                                        const response = await supabase.functions.invoke('check-stuck-jobs', {
                                          body: { projectId: currentProjectId }
                                        });
                                        
                                        if (response.data?.results) {
                                          const stuckResults = response.data.results.filter((r: any) => 
                                            r.action === 'completed' || r.action === 'marked_failed' || r.action === 'upscale_chunk_continued'
                                          );
                                          if (stuckResults.length > 0) {
                                            console.log("[Vérifier upscale] Resolved stuck jobs:", stuckResults);
                                            toast.info(`${stuckResults.length} job(s) bloqué(s) résolu(s)`);
                                          }
                                        }
                                      } catch (error) {
                                        console.error("[Vérifier upscale] Error checking stuck jobs:", error);
                                      }
                                    }
                                    
                                    const imagesWithUrl = generatedPrompts.filter((p: any) => p && p.imageUrl);
                                    
                                    let needsUpscale = 0;
                                    let alreadyUpscaled = 0;
                                    let highRes = 0;
                                    const needsUpscaleIndices: number[] = [];
                                    
                                    imagesWithUrl.forEach((p: any, idx: number) => {
                                      const originalIndex = generatedPrompts.findIndex((gp: any) => gp === p);
                                      
                                      if (p.isUpscaled === true) {
                                        alreadyUpscaled++;
                                        return;
                                      }
                                      
                                      const imgWidth = p.imageWidth || 0;
                                      const imgHeight = p.imageHeight || 0;
                                      if (imgWidth >= 1920 && imgHeight >= 1080) {
                                        highRes++;
                                        return;
                                      }
                                      
                                      needsUpscale++;
                                      needsUpscaleIndices.push(originalIndex + 1);
                                    });
                                    
                                    setUpscaleInfo({
                                      needsUpscale,
                                      alreadyUpscaled,
                                      highRes,
                                      indices: needsUpscaleIndices
                                    });
                                    
                                    if (needsUpscale === 0) {
                                      const total = alreadyUpscaled + highRes;
                                      toast.success(`✅ Toutes les ${total} images sont en haute résolution !`);
                                    } else {
                                      const done = alreadyUpscaled + highRes;
                                      const total = done + needsUpscale;
                                      toast.warning(
                                        `⚠️ ${needsUpscale}/${total} image(s) à upscaler (scènes ${needsUpscaleIndices.join(", ")})`,
                                        { duration: 8000 }
                                      );
                                    }
                                  }}
                                  variant="outline"
                                  size="sm"
                                >
                                  <Check className="mr-2 h-4 w-4" />
                                  Vérifier upscale
                                </Button>
                              </div>
                            </div>
                          )}
                          
                          {/* Ligne 4: Actions (export, supprimer) */}
                          <div className="flex items-center gap-2 pt-2 border-t">
                            <span className="text-xs font-medium text-muted-foreground w-16">Actions</span>
                            <div className="flex items-center gap-2">
                              {generatedPrompts.length > 0 && selectedScenes.size > 0 && (
                                <Button
                                  onClick={exportSelectedScenes}
                                  variant="outline"
                                  size="sm"
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  Exporter ({selectedScenes.size})
                                </Button>
                              )}
                              {/* Delete dropdown for images/prompts */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50 hover:bg-destructive/10">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Supprimer
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      if (!currentProjectId || !user) return;
                                      if (!confirm("Voulez-vous vraiment réinitialiser toutes les images et vidéos de ce projet ? Les prompts seront conservés.")) return;
                                      
                                      try {
                                        const clearedPrompts = generatedPrompts.map(p => ({
                                          scene: p.scene,
                                          text: p.text,
                                          prompt: p.prompt,
                                          startTime: p.startTime,
                                          endTime: p.endTime,
                                          duration: p.duration,
                                          continuityGroupId: p.continuityGroupId
                                        }));

                                        const { error: projectError } = await supabase
                                          .from('projects')
                                          .update({ prompts: clearedPrompts as any })
                                          .eq('id', currentProjectId);
                                        if (projectError) throw projectError;

                                        const { error: scenesError } = await supabase
                                          .from('project_scenes')
                                          .update({ 
                                            image_url: null,
                                            image_width: null,
                                            image_height: null,
                                            upscaled_url: null,
                                            is_upscaled: false,
                                            qa_checked: false,
                                            qa_status: null,
                                            qa_explication: null,
                                            qa_regeneration_prompt: null,
                                            video_url: null
                                          })
                                          .eq('project_id', currentProjectId);
                                        if (scenesError) throw scenesError;

                                        await supabase
                                          .from('pending_predictions')
                                          .delete()
                                          .eq('project_id', currentProjectId);

                                        await supabase
                                          .from('generation_jobs')
                                          .update({ status: 'cancelled' })
                                          .eq('project_id', currentProjectId)
                                          .in('status', ['pending', 'processing']);

                                        setGeneratedPrompts(clearedPrompts as any);
                                        toast.success("Projet réinitialisé (prompts conservés)");
                                      } catch (error) {
                                        console.error('Error resetting project:', error);
                                        toast.error("Erreur lors de la réinitialisation");
                                      }
                                    }}
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    Reset complet (Garder prompts)
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      if (!currentProjectId || !user) return;
                                      try {
                                        const clearedPrompts = generatedPrompts.map(p => {
                                          const { imageUrl, ...rest } = p;
                                          return { ...rest, imageUrl: null };
                                        });
                                        
                                        const { error: projectError } = await supabase
                                          .from('projects')
                                          .update({ prompts: clearedPrompts as any })
                                          .eq('id', currentProjectId);
                                        if (projectError) throw projectError;

                                        const { error: scenesError } = await supabase
                                          .from('project_scenes')
                                          .update({ 
                                            image_url: null,
                                            image_width: null,
                                            image_height: null,
                                            upscaled_url: null,
                                            is_upscaled: false,
                                            qa_checked: false,
                                            qa_status: null,
                                            video_url: null
                                          })
                                          .eq('project_id', currentProjectId);
                                        if (scenesError) throw scenesError;

                                        await supabase
                                          .from('pending_predictions')
                                          .delete()
                                          .eq('project_id', currentProjectId)
                                          .eq('prediction_type', 'scene_image');

                                        setGeneratedPrompts(clearedPrompts.map(p => ({ ...p, imageUrl: undefined })));
                                        toast.success("Toutes les images ont été supprimées");
                                      } catch (error) {
                                        console.error('Error deleting images:', error);
                                        toast.error("Erreur lors de la suppression des images");
                                      }
                                    }}
                                  >
                                    <ImageIcon className="mr-2 h-4 w-4" />
                                    Supprimer les images
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      if (!currentProjectId || !user) return;
                                      try {
                                        const { error: projectError } = await supabase
                                          .from('projects')
                                          .update({ prompts: [] })
                                          .eq('id', currentProjectId);
                                        if (projectError) throw projectError;

                                        const { error: scenesError } = await supabase
                                          .from('project_scenes')
                                          .delete()
                                          .eq('project_id', currentProjectId);
                                        if (scenesError) throw scenesError;

                                        await supabase
                                          .from('pending_predictions')
                                          .delete()
                                          .eq('project_id', currentProjectId);

                                        await supabase
                                          .from('generation_jobs')
                                          .update({ status: 'cancelled' })
                                          .eq('project_id', currentProjectId)
                                          .in('status', ['pending', 'processing']);

                                        setGeneratedPrompts([]);
                                        toast.success("Tous les prompts ont été supprimés de la base de données");
                                      } catch (error) {
                                        console.error('Error deleting prompts:', error);
                                        toast.error("Erreur lors de la suppression des prompts");
                                      }
                                    }}
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    Supprimer les prompts
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Cards d'état */}
                      {missingImagesInfo && missingImagesInfo.count > 0 && !isGeneratingImages && (
                        <Card className="p-4 bg-destructive/10 border-destructive/20">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                                <span className="font-medium text-destructive">
                                  {missingImagesInfo.count} image(s) manquante(s)
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setMissingImagesInfo(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Scènes concernées : {missingImagesInfo.indices.join(", ")}
                            </p>
                            <Button
                              onClick={async () => {
                                if (!currentProjectId) return;
                                
                                // First try to repair from pending_predictions
                                toast.info("Tentative de récupération des images déjà générées...");
                                try {
                                  const { data, error } = await supabase.functions.invoke('repair-missing-images', {
                                    body: { projectId: currentProjectId }
                                  });
                                  
                                  if (error) throw error;
                                  
                                  if (data.repaired > 0) {
                                    toast.success(`${data.repaired} image(s) récupérée(s) depuis les générations précédentes`);
                                    // Refresh project data
                                    const { data: project } = await supabase
                                      .from('projects')
                                      .select('prompts')
                                      .eq('id', currentProjectId)
                                      .single();
                                    if (project?.prompts) {
                                      const validPrompts = ((project.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null);
                                      const promptsWithGroups = calculateGroupsIfMissing(validPrompts);
                                      setGeneratedPrompts(promptsWithGroups);
                                    }
                                  }
                                  
                                  // If still missing images, regenerate
                                  if (data.stillMissing > 0) {
                                    toast.info(`${data.stillMissing} image(s) à regénérer...`);
                                    setMissingImagesInfo(null);
                                    generateAllImages(true);
                                  } else {
                                    setMissingImagesInfo(null);
                                  }
                                } catch (err) {
                                  console.error('Error repairing images:', err);
                                  // Fallback to regeneration
                                  setMissingImagesInfo(null);
                                  generateAllImages(true);
                                }
                              }}
                              className="w-full"
                              variant="destructive"
                              size="sm"
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Récupérer / Regénérer les images manquantes
                            </Button>
                          </div>
                        </Card>
                      )}
                      
                      {/* Card statut upscale */}
                      {upscaleInfo && upscaleInfo.needsUpscale > 0 && !hasActiveJob('upscale') && (
                        <Card className="p-4 bg-amber-500/10 border-amber-500/20">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Maximize2 className="h-5 w-5 text-amber-600 flex-shrink-0" />
                                <span className="font-medium text-amber-600">
                                  {upscaleInfo.needsUpscale} image(s) à upscaler
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUpscaleInfo(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Scènes concernées : {upscaleInfo.indices.join(", ")}
                              {upscaleInfo.alreadyUpscaled > 0 && ` • ${upscaleInfo.alreadyUpscaled} déjà upscalée(s)`}
                              {upscaleInfo.highRes > 0 && ` • ${upscaleInfo.highRes} haute-résolution`}
                            </p>
                            <Button
                              onClick={async () => {
                                // Convert 1-based scene numbers to 0-based indices
                                const sceneIndices = upscaleInfo.indices.map(i => i - 1);
                                setUpscaleInfo(null);
                                console.log(`[Upscale] Starting upscale for scenes: ${sceneIndices.join(', ')}`);
                                const result = await startJob('upscale', { sceneIndices });
                                if (result) {
                                  toast.info(`Upscaling de ${sceneIndices.length} image(s) lancé en arrière-plan.`);
                                }
                              }}
                              className="w-full"
                              variant="default"
                              size="sm"
                            >
                              <Maximize2 className="mr-2 h-4 w-4" />
                              Upscaler les {upscaleInfo.needsUpscale} image(s) manquante(s)
                            </Button>
                          </div>
                        </Card>
                      )}
                      
                      {isGeneratingImages && imageGenerationTotal > 0 && (
                        <Card className="p-4 bg-muted/30 border-primary/20">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">Génération en cours...</span>
                              <span className="text-muted-foreground">
                                {imageGenerationProgress} / {imageGenerationTotal} images
                              </span>
                            </div>
                            <Progress 
                              value={(imageGenerationProgress / imageGenerationTotal) * 100} 
                              className="h-2"
                            />
                          </div>
                        </Card>
                      )}

                    </div>
                    <SceneGrid
                      scenes={scenes}
                      generatedPrompts={generatedPrompts}
                      formatTimecode={formatTimecode}
                      editingSceneIndex={editingSceneIndex}
                      editingPromptIndex={editingPromptIndex}
                      regeneratingPromptIndex={regeneratingPromptIndex}
                      generatingPromptIndex={generatingPromptIndex}
                      generatingImageIndices={generatingImageIndices}
                      regeneratedScenes={regeneratedScenes}
                      copiedIndex={copiedIndex}
                      handleEditScene={handleEditScene}
                      handleEditPrompt={handleEditPrompt}
                      handleWritePrompt={handleWritePrompt}
                      setConfirmRegeneratePrompt={setConfirmRegeneratePrompt}
                      setConfirmRegenerateImage={setConfirmRegenerateImage}
                      generateSinglePrompt={generateSinglePrompt}
                      generateImage={generateImage}
                      handleRegenerateWithQAPrompt={handleRegenerateWithQAPrompt}
                      uploadManualImage={uploadManualImage}
                      copyToClipboard={copyToClipboard}
                      setImagePreviewUrl={setImagePreviewUrl}
                      selectedScenes={selectedScenes}
                      animatingSceneIndex={animatingSceneIndex}
                      onToggleSceneSelection={(index) => {
                        setSelectedScenes(prev => {
                          const next = new Set(prev);
                          if (next.has(index)) {
                            next.delete(index);
                          } else {
                            next.add(index);
                          }
                          return next;
                        });
                      }}
                      onSearchWeb={handleSearchWebImage}
                      onAnimateScene={(index) => setConfirmAnimateScene(index)}
                      visualContinuityEnabled={visualContinuityEnabled}
                    />
                  </Card>
                )}

                {/* Per-scene animator code status — at bottom like SceneGrid */}
                {isAnimatorChannel && scenes.length > 0 && (
                  <Card className="p-4 border border-purple-500/20 bg-purple-500/5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        <Sparkles className="h-4 w-4 text-purple-500" />
                        Scènes Animator
                        {animatorSceneStatuses.length > 0 && (
                          <span className="text-muted-foreground font-normal">
                            — {animatorSceneStatuses.filter(s => s.animator_code_status === 'completed').length}/{scenes.length} générées
                          </span>
                        )}
                        {(animatorTokens || animatorCostUsd != null) && (
                          <span className="text-[11px] text-muted-foreground font-normal flex items-center gap-2 ml-1">
                            {animatorTokens && (
                              <>
                                <span>In: <strong className="text-foreground/70">{animatorTokens.input?.toLocaleString()}</strong></span>
                                <span>Out: <strong className="text-foreground/70">{animatorTokens.output?.toLocaleString()}</strong></span>
                                {animatorTokens.cacheCreated > 0 && <span>Cache W: <strong className="text-foreground/70">{animatorTokens.cacheCreated?.toLocaleString()}</strong></span>}
                                {animatorTokens.cacheRead > 0 && <span>Cache R: <strong className="text-foreground/70">{animatorTokens.cacheRead?.toLocaleString()}</strong></span>}
                              </>
                            )}
                            {animatorCostUsd != null && (
                              <span className="font-medium text-purple-400">≈ ${animatorCostUsd.toFixed(4)}</span>
                            )}
                          </span>
                        )}
                      </h3>
                      <div className="flex items-center gap-1">
                        {!isAnimatorGenerating && animatorSceneStatuses.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => {
                              const completed = animatorSceneStatuses.filter(s => s.animator_code_status === 'completed');
                              const failed = animatorSceneStatuses.filter(s => s.animator_code_status === 'failed');
                              const pending = scenes.length - completed.length - failed.length;
                              if (failed.length > 0) {
                                const failedIndices = failed.map(s => s.scene_index + 1);
                                toast.error(
                                  `⚠️ ${failed.length} scène(s) en erreur : ${failedIndices.slice(0, 15).join(", ")}${failedIndices.length > 15 ? '...' : ''}`,
                                  { duration: 10000 }
                                );
                              } else if (pending > 0) {
                                const missingIndices = scenes
                                  .map((_, i) => i)
                                  .filter(i => !animatorSceneStatuses.find(s => s.scene_index === i && s.animator_code_status === 'completed'))
                                  .map(i => i + 1);
                                toast.warning(
                                  `⏳ ${missingIndices.length} scène(s) non terminée(s) : ${missingIndices.slice(0, 15).join(", ")}${missingIndices.length > 15 ? '...' : ''}`,
                                  { duration: 8000 }
                                );
                              } else {
                                toast.success(`✅ Toutes les ${completed.length} scènes Animator sont générées !`);
                              }
                            }}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Vérifier
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-muted-foreground"
                          onClick={() => {
                            if (expandedAnimatorScenes.size === scenes.length) {
                              setExpandedAnimatorScenes(new Set());
                            } else {
                              setExpandedAnimatorScenes(new Set(scenes.map((_, i) => i)));
                            }
                          }}
                        >
                          {expandedAnimatorScenes.size === scenes.length ? 'Tout replier' : 'Tout déplier'}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {scenes.map((scene, index) => {
                        const sceneStatus = animatorSceneStatuses.find(s => s.scene_index === index);
                        const status = sceneStatus?.animator_code_status || null;
                        const isFailed = status === 'failed';
                        const isCompleted = status === 'completed';
                        const isGenerating = status === 'generating' || status === 'pending';
                        const hasCode = !!sceneStatus?.animator_code;
                        const isRetrying = isRetryingScene === index;
                        const isExpanded = expandedAnimatorScenes.has(index);
                        const duration = (scene.endTime - scene.startTime).toFixed(1);

                        return (
                          <div
                            key={index}
                            className={`rounded-lg border overflow-hidden ${
                              isCompleted ? 'border-green-500/20' :
                              isFailed ? 'border-red-500/20' :
                              isGenerating ? 'border-purple-500/20' :
                              'border-muted'
                            }`}
                          >
                            <div
                              className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors ${
                                isCompleted ? 'bg-green-500/5' :
                                isFailed ? 'bg-red-500/5' :
                                isGenerating ? 'bg-purple-500/5' :
                                'bg-muted/10'
                              }`}
                              onClick={() => {
                                setExpandedAnimatorScenes(prev => {
                                  const next = new Set(prev);
                                  if (next.has(index)) next.delete(index);
                                  else next.add(index);
                                  return next;
                                });
                              }}
                            >
                              <div className="flex-shrink-0 w-4">
                                {isRetrying && <Loader2 className="h-4 w-4 animate-spin text-purple-500" />}
                                {!isRetrying && isCompleted && <Check className="h-4 w-4 text-green-500" />}
                                {!isRetrying && isFailed && <X className="h-4 w-4 text-red-500" />}
                                {!isRetrying && isGenerating && <Loader2 className="h-4 w-4 animate-spin text-purple-500" />}
                              </div>
                              <span className="font-bold text-sm text-primary w-8">#{index + 1}</span>
                              <span className="text-xs text-muted-foreground font-mono w-24 flex-shrink-0">
                                {formatTimecode(scene.startTime)} → {formatTimecode(scene.endTime)}
                              </span>
                              <span className="text-xs text-muted-foreground w-10 flex-shrink-0">{duration}s</span>
                              <span className="text-xs text-foreground/80 truncate flex-1 min-w-0">
                                {scene.text || '—'}
                              </span>
                              <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                {isFailed && !isRetrying && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                    onClick={async () => {
                                      if (!currentProjectId) return;
                                      setIsRetryingScene(index);
                                      try {
                                        await startJob('animator_scene' as any, {
                                          sceneIndex: index,
                                          segment: { start: scene.startTime, end: scene.endTime, text: scene.text },
                                        });
                                      } catch (e: any) {
                                        toast.error(`Erreur: ${e.message}`);
                                      } finally {
                                        setIsRetryingScene(null);
                                      }
                                    }}
                                  >
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Retry
                                  </Button>
                                )}
                                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="border-t border-inherit">
                                <div className="px-3 py-2 bg-muted/5 border-b border-inherit">
                                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Texte</span>
                                  <p className="text-sm mt-1 text-foreground/90 leading-relaxed">{scene.text}</p>
                                </div>
                                {hasCode && (
                                  <div className="px-3 py-2">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                        {isCompleted ? 'Code Remotion' : 'Erreur'}
                                      </span>
                                      {isCompleted && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-5 px-1.5 text-[10px]"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText(sceneStatus?.animator_code || '');
                                            toast.success('Code copié');
                                          }}
                                        >
                                          <Copy className="h-3 w-3 mr-1" />
                                          Copier
                                        </Button>
                                      )}
                                    </div>
                                    <pre className={`text-xs font-mono p-3 rounded-md overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all ${
                                      isFailed ? 'bg-red-500/5 text-red-400' : 'bg-zinc-950 text-zinc-300'
                                    }`}>
                                      {sceneStatus?.animator_code}
                                    </pre>
                                  </div>
                                )}
                                {!hasCode && isGenerating && (
                                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                                    Génération en cours...
                                  </div>
                                )}
                                {!hasCode && !isGenerating && !status && (
                                  <div className="px-3 py-3 text-center text-xs text-muted-foreground italic">
                                    Pas encore généré
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </TabsContent>

            <TabsContent value="audio" className="space-y-6 m-0">
              <Card className="p-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <h2 className="text-lg font-semibold">Audio du projet</h2>
                  {audioUrl && (
                    <Button asChild variant="outline">
                      <a href={audioUrl} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-4 w-4 mr-2" />
                        Télécharger
                      </a>
                    </Button>
                  )}
                </div>

                <div className="mt-4">
                  {!audioUrl ? (
                    <p className="text-sm text-muted-foreground">
                      Aucun audio disponible pour ce projet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <audio controls className="w-full">
                        <source src={audioUrl} />
                        Votre navigateur ne supporte pas l'audio.
                      </audio>
                      <p className="text-xs text-muted-foreground break-all">
                        {audioUrl}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </TabsContent>

              <TabsContent value="thumbnails" className="m-0">
                <div className="max-w-5xl mx-auto">
                  {channelThumbnailVersion === 'v2' && calendarChannelName && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-100 px-4 py-3 text-sm text-black cursor-pointer hover:bg-amber-200 transition-colors" onClick={() => setActiveTab('thumbnails-v2')}>
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>La chaîne <strong>{calendarChannelName}</strong> utilise un preset <strong>Miniature V2</strong>. Cliquez ici pour y accéder.</span>
                    </div>
                  )}
                  <ThumbnailGenerator
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                    videoTitle={projectName}
                  />
                </div>
              </TabsContent>

              <TabsContent value="thumbnails-v2" className="m-0">
                <div className="max-w-5xl mx-auto">
                  {channelThumbnailVersion === 'v1' && calendarChannelName && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-100 px-4 py-3 text-sm text-black cursor-pointer hover:bg-amber-200 transition-colors" onClick={() => setActiveTab('thumbnails')}>
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>La chaîne <strong>{calendarChannelName}</strong> utilise un preset <strong>Miniatures V1</strong>. Cliquez ici pour y accéder.</span>
                    </div>
                  )}
                  <ThumbnailGeneratorV2
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                    videoTitle={projectName}
                  />
                </div>
              </TabsContent>

              <TabsContent value="youtube" className="m-0">
                <div className="max-w-5xl mx-auto">
                  <YouTubeMetadataTab
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                    videoTitle={projectName}
                    scenes={scenes.map(s => ({
                      text: s.text,
                      startTime: s.startTime,
                      endTime: s.endTime
                    }))}
                  />
                </div>
              </TabsContent>

              <TabsContent value="transcript" className="m-0">
                <div className="h-[calc(100vh-250px)] max-h-[800px] p-4">
                  {scriptGenerationPrompt ? (
                    <ResizablePanelGroup direction="horizontal" className="h-full">
                      {/* Script/Transcription Panel */}
                      <ResizablePanel defaultSize={50} minSize={20} maxSize={80}>
                        <Collapsible open={!isScriptCollapsed} onOpenChange={setIsScriptCollapsed} className="h-full flex flex-col">
                          <div className="flex items-center justify-between mb-2 pb-2 border-b">
                            <h2 className="text-lg font-semibold">Script / Transcription</h2>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                {isScriptCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          </div>
                          <CollapsibleContent className="flex-1 overflow-hidden min-h-0">
                            <ScrollArea className="h-full">
                              {transcriptData && (transcriptData as { segments?: Array<{ text: string }> }).segments ? (
                                <div className="bg-card rounded-lg border p-3">
                                  <p className="text-foreground leading-relaxed whitespace-pre-wrap text-xs">
                                    {((transcriptData as { segments?: Array<{ text: string }> }).segments || []).map(s => s.text).join(' ')}
                                  </p>
                                </div>
                              ) : projectSummary ? (
                                <div className="bg-card rounded-lg border p-3">
                                  <p className="text-foreground leading-relaxed whitespace-pre-wrap text-xs">
                                    {projectSummary}
                                  </p>
                                </div>
                              ) : (
                                <div className="bg-muted/30 rounded-lg border p-3">
                                  <p className="text-muted-foreground text-center text-xs">Aucune transcription disponible</p>
                                </div>
                              )}
                            </ScrollArea>
                          </CollapsibleContent>
                        </Collapsible>
                      </ResizablePanel>
                      
                      <ResizableHandle withHandle />
                      
                      {/* Prompt Panel */}
                      <ResizablePanel defaultSize={50} minSize={20} maxSize={80}>
                        <Collapsible open={!isPromptCollapsed} onOpenChange={setIsPromptCollapsed} className="h-full flex flex-col">
                          <div className="flex items-center justify-between mb-2 pb-2 border-b">
                            <h2 className="text-lg font-semibold">Prompt de génération</h2>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                {isPromptCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          </div>
                          <CollapsibleContent className="flex-1 overflow-hidden min-h-0">
                            <ScrollArea className="h-full">
                              <div className="bg-primary/5 rounded-lg border border-primary/20 p-3">
                                <p className="text-foreground leading-relaxed whitespace-pre-wrap text-xs font-medium">
                                  {scriptGenerationPrompt}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground italic mt-2">
                                Ce prompt a été utilisé pour générer le script de la vidéo via Claude.
                              </p>
                            </ScrollArea>
                          </CollapsibleContent>
                        </Collapsible>
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  ) : (
                    <div className="h-full flex flex-col">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b">
                        <h2 className="text-lg font-semibold">Script / Transcription</h2>
                      </div>
                      <ScrollArea className="flex-1 min-h-0 space-y-4">
                        {projectScript && (
                          <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-1">Script original</h3>
                            <div className="bg-card rounded-lg border p-3">
                              <p className="text-foreground leading-relaxed whitespace-pre-wrap text-xs">
                                {projectScript}
                              </p>
                            </div>
                          </div>
                        )}
                        {projectSummary && (
                          <div className="mt-4">
                            <h3 className="text-sm font-medium text-muted-foreground mb-1">Résumé</h3>
                            <div className="bg-card rounded-lg border p-3">
                              <p className="text-foreground leading-relaxed whitespace-pre-wrap text-xs">
                                {projectSummary}
                              </p>
                            </div>
                          </div>
                        )}
                        {transcriptData && (transcriptData as { segments?: Array<{ text: string }> }).segments && (
                          <div className="mt-4">
                            <h3 className="text-sm font-medium text-muted-foreground mb-1">Transcription audio</h3>
                            <div className="bg-card rounded-lg border p-3">
                              <p className="text-foreground leading-relaxed whitespace-pre-wrap text-xs">
                                {((transcriptData as { segments?: Array<{ text: string }> }).segments || []).map(s => s.text).join(' ')}
                              </p>
                            </div>
                          </div>
                        )}
                        {!projectScript && !projectSummary && !(transcriptData && (transcriptData as { segments?: Array<{ text: string }> }).segments) && (
                          <div className="bg-muted/30 rounded-lg border p-3">
                            <p className="text-muted-foreground text-center text-xs">Aucun script ou transcription disponible</p>
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="preview" className="m-0">
                <div className="max-w-6xl mx-auto">
                  {isAnimatorChannel ? (
                    <AnimatorPreview
                      projectId={currentProjectId || ""}
                      hasCompletedScenes={animatorSceneStatuses.some(s => s.animator_code_status === 'completed')}
                    />
                  ) : audioUrl && generatedPrompts.length > 0 ? (
                    <VideoPreview
                      audioUrl={audioUrl}
                      prompts={generatedPrompts}
                      autoPlay={false}
                      onRegeneratePrompt={generateSinglePrompt}
                      onRegenerateImage={generateImage}
                      onUpdatePrompt={updatePromptFromPreview}
                      regeneratingPromptIndex={generatingPromptIndex}
                      regeneratingImageIndices={generatingImageIndices}
                    />
                  ) : (
                    <Card className="p-12 text-center">
                      <p className="text-muted-foreground mb-4">
                        {!audioUrl && "Aucun fichier audio disponible"}
                        {audioUrl && generatedPrompts.length === 0 && "Aucun prompt généré. Veuillez générer les prompts dans l'onglet Vidéo."}
                      </p>
                    </Card>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="renders" className="m-0">
                <div className="max-w-6xl mx-auto space-y-4">
                  <Card className="p-6">
                    <h2 className="text-lg font-semibold mb-4">Historique des rendus</h2>
                    {(() => {
                      // Merge VPS and GPU jobs, add type marker, and sort by date
                      const hasAnimatorInJobs = allVideoRenderJobs.some(j => j.metadata && typeof j.metadata === 'object' && (j.metadata as any).type === 'animator');
                      const allJobs: Array<any> = [
                        ...allVideoRenderJobs.map(j => ({ ...j, type: 'vps' as const })),
                        ...allGpuRenderJobs.map(j => ({ ...j, type: 'gpu' as const })),
                        // Show existing animator video as virtual entry if no video_render_jobs row exists yet
                        ...(!hasAnimatorInJobs && animatorVideoUrl ? [{
                          id: 'animator-legacy',
                          type: 'vps' as const,
                          status: 'completed',
                          progress: 100,
                          video_url: animatorVideoUrl,
                          created_at: new Date().toISOString(),
                          metadata: { type: 'animator' },
                        }] : []),
                      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                      if (allJobs.length === 0) {
                        return (
                          <p className="text-muted-foreground text-center py-8">
                            Aucun rendu vidéo pour ce projet.
                          </p>
                        );
                      }

                      return (
                        <div className="space-y-4">
                          {allJobs.map((job) => (
                          <Card key={`${job.type}-${job.id}`} className="p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {job.status === 'completed' && (
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                  )}
                                  {job.status === 'processing' && (
                                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                                  )}
                                  {job.status === 'failed' && (
                                    <AlertCircle className="h-5 w-5 text-destructive" />
                                  )}
                                  {job.status === 'pending' && (
                                    <Clock className="h-5 w-5 text-muted-foreground" />
                                  )}
                                  <span className="font-medium">
                                    Rendu du {new Date(job.created_at).toLocaleString('fr-FR')}
                                  </span>
                                  {job.type === 'gpu' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                                      <Zap className="h-3 w-3" />
                                      GPU
                                    </span>
                                  )}
                                  {job.type === 'vps' && 'metadata' in job && (job as any).metadata?.type === 'animator' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                                      <Sparkles className="h-3 w-3" />
                                      Animator
                                    </span>
                                  )}
                                </div>
                                
                                {job.status === 'processing' && (
                                  <>
                                    <Progress value={job.progress || 0} className="h-2" />
                                    {job.type === 'vps' && 'current_step' in job && job.current_step && (
                                      <p className="text-sm text-muted-foreground">
                                        {job.current_step}
                                      </p>
                                    )}
                                    {job.type === 'gpu' && 'current_step' in job && job.current_step && (
                                      <p className="text-sm text-muted-foreground">
                                        {job.current_step}
                                      </p>
                                    )}
                                    {job.type === 'gpu' && 'worker_id' in job && job.worker_id && (
                                      <p className="text-sm text-muted-foreground">
                                        Worker: {job.worker_id}
                                      </p>
                                    )}
                                  </>
                                )}
                                
                                {job.status === 'completed' && job.video_url && (
                                  <div className="space-y-2">
                                    <div className="flex gap-2">
                                      <Button
                                        onClick={() => window.open(job.video_url!, '_blank')}
                                        size="sm"
                                        variant="outline"
                                      >
                                        <MonitorPlay className="mr-2 h-4 w-4" />
                                        Voir la vidéo
                                      </Button>
                                      <Button
                                        onClick={() => {
                                          // Le fichier a déjà le bon nom sur le VPS (format: YYYYMMDD_projet.mp4)
                                          // Télécharge directement
                                          window.open(job.video_url!, '_blank');
                                        }}
                                        size="sm"
                                        variant="outline"
                                      >
                                        <Download className="mr-2 h-4 w-4" />
                                        Télécharger
                                      </Button>
                                    </div>
                                    {job.type === 'vps' && 'file_size_mb' in job && job.file_size_mb && (
                                      <p className="text-xs text-muted-foreground">
                                        Taille: {job.file_size_mb.toFixed(2)} MB
                                        {'duration_seconds' in job && job.duration_seconds && ` • Durée: ${Math.round(job.duration_seconds)}s`}
                                      </p>
                                    )}
                                    {job.type === 'gpu' && 'metadata' in job && job.metadata && typeof job.metadata === 'object' && (
                                      <p className="text-xs text-muted-foreground">
                                        {(job.metadata as any).fileSizeMB && `Taille: ${(job.metadata as any).fileSizeMB.toFixed(2)} MB`}
                                        {(job.metadata as any).duration && ` • Rendu en ${Math.round((job.metadata as any).duration)}s`}
                                        {(job.metadata as any).resolution && ` • ${(job.metadata as any).resolution}`}
                                      </p>
                                    )}
                                  </div>
                                )}
                                
                                {job.status === 'failed' && job.error_message && (
                                  <p className="text-sm text-destructive">
                                    {job.error_message}
                                  </p>
                                )}
                              </div>
                            </div>
                          </Card>
                          ))}
                        </div>
                      );
                    })()}
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          )}

        {/* Confirmation dialogs */}
        <AlertDialog open={confirmRegeneratePrompt !== null} onOpenChange={(open) => !open && setConfirmRegeneratePrompt(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Régénérer le prompt ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action va régénérer le prompt de la scène {confirmRegeneratePrompt !== null ? confirmRegeneratePrompt + 1 : ''}. Le prompt actuel sera remplacé.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (confirmRegeneratePrompt !== null) {
                  regenerateSinglePrompt(confirmRegeneratePrompt);
                  setConfirmRegeneratePrompt(null);
                }
              }}>
                Régénérer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmRegenerateImage !== null} onOpenChange={(open) => !open && setConfirmRegenerateImage(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Régénérer l'image ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action va régénérer l'image de la scène {confirmRegenerateImage !== null ? confirmRegenerateImage + 1 : ''}. L'image actuelle sera remplacée.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (confirmRegenerateImage !== null) {
                  generateImage(confirmRegenerateImage);
                  setConfirmRegenerateImage(null);
                }
              }}>
                Régénérer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmAnimateScene !== null} onOpenChange={(open) => !open && setConfirmAnimateScene(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Animer la scène ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action va animer l'image de la scène {confirmAnimateScene !== null ? confirmAnimateScene + 1 : ''} avec Seedance 1.5 Pro (Kie.ai). 
                La vidéo animée remplacera l'image statique dans le rendu final. 
                <br /><br />
                <strong>Attention :</strong> Cette opération peut prendre plusieurs minutes. La génération se fait en arrière-plan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (confirmAnimateScene !== null) {
                  animateScene(confirmAnimateScene);
                }
              }}>
                Animer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* QA confirmation dialog */}
        <AlertDialog open={showQAConfirmDialog} onOpenChange={setShowQAConfirmDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Vérification déjà effectuée</AlertDialogTitle>
              <AlertDialogDescription>
                Une vérification qualité a déjà été effectuée sur ce projet. 
                <br /><br />
                Voulez-vous la relancer ? Les résultats précédents seront écrasés et les badges QA actuels seront réinitialisés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={confirmAndRunQA}>
                Relancer la vérification
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Image preview dialog */}
        <Dialog open={imagePreviewUrl !== null} onOpenChange={(open) => !open && setImagePreviewUrl(null)}>
          <DialogContent className="max-w-4xl max-h-[85vh] p-4">
            {imagePreviewUrl && (
              <img
                src={imagePreviewUrl}
                alt="Aperçu"
                className="w-full h-auto max-h-[75vh] object-contain rounded-lg"
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Web image search modal */}
        <ImageSearchModal
          open={imageSearchOpen}
          onOpenChange={setImageSearchOpen}
          sceneIndex={imageSearchSceneIndex}
          sceneText={imageSearchSceneText}
          previousScenes={imageSearchPreviousScenes}
          nextScenes={imageSearchNextScenes}
          summary={projectSummary}
          projectName={projectName}
          customSearchPrompt={imageSearchPromptSystem || null}
          onSelectImage={handleSelectWebImage}
        />

        {/* Scene settings dialog */}
        <Dialog open={sceneSettingsOpen} onOpenChange={async (open) => {
          setSceneSettingsOpen(open);
          // Save changes when modal is closed
          if (!open && currentProjectId) {
            await saveProjectData();
          }
        }}>
          <DialogContent className="max-w-2xl flex flex-col max-h-[95vh]">
            <div className="overflow-y-auto flex-1 min-h-0 space-y-4 pr-2">
              <div>
                <h3 className="text-lg font-semibold mb-2">Configuration des scènes</h3>
                <p className="text-sm text-muted-foreground">
                  Définissez les durées de scènes selon le contenu
                </p>
              </div>

              {/* Preset selector */}
              <div className="rounded-lg border p-3 bg-primary/5 border-primary/20">
                <div className="flex items-center gap-2 mb-2">
                  <Download className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Charger un preset (optionnel)</h3>
                </div>
                <PresetManager
                  currentConfig={{
                    durationRanges,
                    examplePrompts,
                    imageWidth,
                    imageHeight,
                    aspectRatio,
                    styleReferenceUrls,
                    imageModel,
                    promptSystemMessage,
                    loraUrl,
                    loraSteps,
                    qaPrompt,
                    visualMode,
                    gameplayUrls,
                  }}
                  autoLoadPresetId={sessionStorage.getItem("auto_load_project_preset_id") || undefined}
                  onLoadPreset={handleLoadPreset}
                  currentPresetId={currentPresetId || undefined}
                />
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Format de contenu</label>
                  <RadioGroup value={sceneFormat} onValueChange={async (value) => {
                    const newFormat = value as "long" | "short";
                    setSceneFormat(newFormat);
                    // Update duration ranges based on format
                    if (newFormat === "short") {
                      setDurationRanges(SHORT_FORM_DURATION_RANGES);
                    } else {
                      setDurationRanges(DEFAULT_DURATION_RANGES);
                    }
                    // Save immediately when format changes
                    if (currentProjectId) {
                      await saveProjectData();
                    }
                  }}>
                    <div className="flex gap-4">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="long" id="format-long" />
                        <Label htmlFor="format-long" className="font-normal cursor-pointer">Long form</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="short" id="format-short" />
                        <Label htmlFor="format-short" className="font-normal cursor-pointer">Short form</Label>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                <div className="p-3 border rounded-lg bg-muted/30">
                  <DurationRangesEditor
                    ranges={durationRanges}
                    onChange={setDurationRanges}
                    maxEndValue={sceneFormat === "long" ? 600 : 60}
                  />
                </div>
              </div>

              {/* Sentence boundary option */}
              <div className="flex items-start space-x-2 p-3 border rounded-lg bg-muted/30">
                <input
                  type="checkbox"
                  id="strict-cutting"
                  checked={!preferSentenceBoundaries}
                  onChange={(e) => setPreferSentenceBoundaries(!e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <div className="space-y-1">
                  <Label htmlFor="strict-cutting" className="cursor-pointer font-medium">
                    Découpage strict par durée
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Coupe les scènes exactement à la durée configurée, même en milieu de phrase.
                    <span className="text-muted-foreground/80"> Par défaut, les scènes sont coupées à la fin des phrases (peut augmenter la durée jusqu'à 50%).</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-2 border-t mt-2 flex-shrink-0">
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!transcriptData) {
                      toast.error("Aucune transcription disponible pour régénérer les scènes");
                      return;
                    }
                    
                    const confirmRegenerate = window.confirm(
                      "Attention : la régénération des scènes va effacer tous les prompts et images existants. Êtes-vous sûr de vouloir continuer ?"
                    );
                    
                    if (!confirmRegenerate) return;
                    
                    const newScenes = parseTranscriptToScenes(
                      transcriptData,
                      durationRanges,
                      undefined, undefined, undefined, undefined,
                      preferSentenceBoundaries
                    );
                    
                    setScenes(newScenes);
                    setGeneratedPrompts([]);
                    
                    // Save to database
                    if (currentProjectId) {
                      await supabase
                        .from("projects")
                        .update({ 
                          scenes: newScenes as any,
                          prompts: [] as any
                        })
                        .eq("id", currentProjectId);
                    }
                    
                    toast.success(`${newScenes.length} scènes régénérées !`);
                    setSceneSettingsOpen(false);
                  }}
                  disabled={!transcriptData}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regénérer les scènes
                </Button>
                <Button variant="outline" onClick={() => setSceneSettingsOpen(false)}>
                  Fermer
                </Button>
                <Button onClick={async () => {
                  if (currentProjectId) {
                    await saveProjectData();
                    toast.success("Configuration sauvegardée");
                  }
                  setSceneSettingsOpen(false);
                }}>
                  Sauvegarder
                </Button>
              </div>
          </DialogContent>
        </Dialog>

        {/* Prompt settings dialog */}
        <Dialog open={promptSettingsOpen} onOpenChange={setPromptSettingsOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] sm:w-full p-6 flex flex-col overflow-hidden">
            <DialogHeader className="flex-shrink-0 mb-4">
              <DialogTitle>Paramètres de prompts</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-2" style={{ maxHeight: 'calc(90vh - 150px)' }}>
              {/* Section 1: Prompts d'images */}
              <div className="space-y-4 border-b pb-6">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  Génération de prompts d'images
                </h3>
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Prompt système personnalisé
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Personnalisez les instructions données à l'IA pour générer les prompts d'images.
                  </p>
                  <Textarea
                    placeholder="Entrez votre prompt système personnalisé..."
                    value={promptSystemMessage}
                    onChange={(e) => setPromptSystemMessage(e.target.value)}
                    rows={8}
                    className="resize-none font-mono text-xs"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPromptSystemMessage(`You are an expert at generating prompts for AI image creation (like Midjourney, Stable Diffusion, DALL-E).

STRICT RULES FOR GENERATING CONSISTENT PROMPTS:
1. Follow EXACTLY the structure and style of the examples below
2. Use the same tone, vocabulary, and format
3. Respect the same approximate length (50-100 words)
4. Include the same types of elements: main subject, visual style, composition, lighting, mood
5. NEVER deviate from the format established by the examples
6. Generate prompts in ENGLISH only
7. NEVER use the word "dead" in the prompt (rephrase with other words instead)

CONTENT SAFETY - STRICTLY FORBIDDEN:
- No nudity, partial nudity, or suggestive/intimate content
- No violence, gore, blood, weapons pointed at people, or graphic injuries
- No sexual or romantic physical contact
- No drug use or drug paraphernalia
- No hate symbols, extremist imagery, or discriminatory content
- No realistic depictions of real public figures or celebrities
- Instead of violent scenes, describe tension through expressions, postures, and atmosphere
- Instead of intimate scenes, describe emotional connection through eye contact and gestures

Your role is to create ONE detailed visual prompt for a specific scene from a video/audio.

For this scene, you must:
1. Identify key visual elements from the text
2. Create a descriptive and detailed prompt
3. Include style, mood, composition, lighting
4. Optimize for high-quality image generation
5. Think about visual coherence with the global story context

Return ONLY the prompt text, no JSON, no title, just the optimized prompt in ENGLISH.`)}
                    >
                      Charger prompt par défaut
                    </Button>
                    {promptSystemMessage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPromptSystemMessage("")}
                      >
                        Effacer
                      </Button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Exemples de prompts (2-3 recommandés pour la consistance)
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Entrez 2-3 exemples de prompts que vous avez déjà créés pour montrer le style et la structure désirée
                  </p>
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="mb-3">
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {index === 0 ? "Exemple 1 (recommandé)" : `Exemple ${index + 1} (optionnel)`}
                      </label>
                      <Textarea
                        placeholder={`Exemple de prompt ${index + 1}...`}
                        value={examplePrompts[index] || ""}
                        onChange={(e) => {
                          const newPrompts = [...examplePrompts];
                          newPrompts[index] = e.target.value;
                          setExamplePrompts(newPrompts);
                        }}
                        rows={3}
                        className="resize-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2: Recherche d'images */}
              <div className="space-y-4">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  Recherche d'images (Brave Search)
                </h3>
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Prompt système pour la recherche d'images
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Personnalisez les instructions données à l'IA pour générer les requêtes de recherche d'images sur le web.
                  </p>
                  <Textarea
                    placeholder="Entrez votre prompt système personnalisé pour la recherche d'images..."
                    value={imageSearchPromptSystem}
                    onChange={(e) => setImageSearchPromptSystem(e.target.value)}
                    rows={10}
                    className="resize-none font-mono text-xs"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const defaultPrompt = `You are an expert at generating image search queries for video production. Analyze the scene text WITHIN ITS TEMPORAL CONTEXT to understand what is happening, then generate a precise search query.

Use video topic in all you search:

Example: keywords + full video topic.
Example: Paris road - Fashion week 2025

If scene is too specific, use video topic overall illustration.

CRITICAL: Use the TEMPORAL CONTEXT (previous and next scenes) to understand:
- What topic/subject is being discussed in this part of the video
- What specific event or concept is being described in THIS scene
- How this scene relates to what came before and what comes after

ANALYSIS PROCESS:
1. Read the PREVIOUS SCENES to understand the topic being discussed
2. Read the CURRENT SCENE TEXT carefully - what specific event/concept is described?
3. Read the NEXT SCENES to see where the story is going

CRITICAL RULES:
- Output ONLY the search query, nothing else
- Use English keywords only
- Be PRECISE to what is described in the CURRENT scene
- Use temporal context to understand the topic, but focus on the CURRENT scene's specific event
- If there's drama (fire, accident, tragedy), include those keywords related
- Think: "What image would best show what's happening in THIS specific scene?"

Remember: Use temporal context to understand the topic, but the query must be PRECISE to the topic.`;
                        setImageSearchPromptSystem(defaultPrompt);
                      }}
                    >
                      Charger prompt par défaut
                    </Button>
                    {imageSearchPromptSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setImageSearchPromptSystem("")}
                      >
                        Effacer
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-shrink-0 mt-4">
              <Button variant="outline" onClick={() => setPromptSettingsOpen(false)}>
                Fermer
              </Button>
              <Button onClick={async () => {
                if (currentProjectId) {
                  await saveProjectData();
                  toast.success("Paramètres de prompts sauvegardés");
                }
                setPromptSettingsOpen(false);
              }}>
                Sauvegarder
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Image settings dialog */}
        <Dialog open={imageSettingsOpen} onOpenChange={setImageSettingsOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] sm:w-full flex flex-col p-6">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>Paramètres d'image</DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 min-h-0 space-y-6 pr-2 -mr-2">

              {/* Visual mode toggle */}
              <div className="space-y-2">
                <label className="text-sm font-medium block">Mode visuel</label>
                <Select value={visualMode} onValueChange={(v: "images" | "gameplay") => setVisualMode(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="images">Images IA</SelectItem>
                    <SelectItem value="gameplay">Gameplay (vidéos)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {visualMode === "gameplay" ? (
                <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                  {/* Upload zone */}
                  <div>
                    <label className="text-sm font-medium block mb-1">Uploader des vidéos gameplay</label>
                    {gameplayUploading && gameplayUploadProgress ? (
                      <div className="p-3 border rounded-md space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium truncate flex-1 mr-2">{gameplayUploadProgress.filename}</span>
                          <span className="text-muted-foreground shrink-0">{gameplayUploadProgress.speed}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                          <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${gameplayUploadProgress.percent}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{(gameplayUploadProgress.loaded / (1024 * 1024)).toFixed(1)} / {(gameplayUploadProgress.total / (1024 * 1024)).toFixed(1)} MB</span>
                          <span>{gameplayUploadProgress.percent}%</span>
                        </div>
                      </div>
                    ) : (
                    <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-md cursor-pointer hover:border-primary hover:bg-muted/30 transition-colors">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Cliquer pour sélectionner des MP4</span>
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        multiple
                        className="hidden"
                        disabled={gameplayUploading}
                        onChange={async (e) => {
                          if (!e.target.files || e.target.files.length === 0) return;
                          setGameplayUploading(true);
                          const files = Array.from(e.target.files);
                          try {
                            const { data: { session } } = await supabase.auth.getSession();
                            if (!session) { toast.error("Non authentifié"); return; }
                            for (const file of files) {
                              await new Promise<void>((resolve, reject) => {
                                const formData = new FormData();
                                formData.append("video", file);
                                const xhr = new XMLHttpRequest();
                                let startTime = Date.now();
                                xhr.upload.addEventListener("progress", (ev) => {
                                  if (!ev.lengthComputable) return;
                                  const percent = Math.round((ev.loaded / ev.total) * 100);
                                  const elapsed = (Date.now() - startTime) / 1000;
                                  const bytesPerSec = elapsed > 0 ? ev.loaded / elapsed : 0;
                                  let speed = "";
                                  if (bytesPerSec > 1024 * 1024) speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
                                  else speed = `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
                                  setGameplayUploadProgress({ filename: file.name, percent, speed, loaded: ev.loaded, total: ev.total });
                                });
                                xhr.addEventListener("load", () => {
                                  if (xhr.status >= 200 && xhr.status < 300) {
                                    try {
                                      const result = JSON.parse(xhr.responseText);
                                      toast.success(`${file.name} uploadé (${result.sizeMB} MB)`);
                                      setGameplayUrls(prev => [...prev, result.url]);
                                      setGameplayServerFiles(prev => [...prev, { filename: result.filename, url: result.url, sizeMB: result.sizeMB }]);
                                    } catch {} 
                                    resolve();
                                  } else {
                                    toast.error(`Erreur upload ${file.name}: HTTP ${xhr.status}`);
                                    resolve();
                                  }
                                });
                                xhr.addEventListener("error", () => { toast.error(`Erreur réseau: ${file.name}`); resolve(); });
                                xhr.open("POST", "/api/upload-gameplay");
                                xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
                                xhr.send(formData);
                              });
                            }
                          } catch (err: any) {
                            toast.error(`Erreur: ${err.message}`);
                          } finally {
                            setGameplayUploading(false);
                            setGameplayUploadProgress(null);
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                    )}
                  </div>

                  {/* Server files */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Vidéos sur le serveur</label>
                      <Button variant="ghost" size="sm" onClick={async () => {
                        setGameplayLoadingFiles(true);
                        try {
                          const { data: { session } } = await supabase.auth.getSession();
                          if (!session) return;
                          const resp = await fetch("/api/list-gameplay", { headers: { Authorization: `Bearer ${session.access_token}` } });
                          if (resp.ok) {
                            const { files } = await resp.json();
                            setGameplayServerFiles(files || []);
                          }
                        } catch {} finally { setGameplayLoadingFiles(false); }
                      }} disabled={gameplayLoadingFiles}>
                        {gameplayLoadingFiles ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
                        <span className="text-xs ml-1">Charger</span>
                      </Button>
                    </div>
                    {gameplayServerFiles.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto border rounded-md divide-y">
                        {gameplayServerFiles.map((f) => (
                          <div key={f.filename} className="flex items-center justify-between px-2 py-1.5 text-xs">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Video className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{f.filename}</span>
                              <span className="text-muted-foreground shrink-0">{f.sizeMB} MB</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!gameplayUrls.includes(f.url) && (
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setGameplayUrls(prev => [...prev, f.url])}>
                                  <Plus className="h-3 w-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={async () => {
                                try {
                                  const { data: { session } } = await supabase.auth.getSession();
                                  if (!session) return;
                                  await fetch(`/api/delete-gameplay/${encodeURIComponent(f.filename)}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } });
                                  setGameplayServerFiles(prev => prev.filter(x => x.filename !== f.filename));
                                  setGameplayUrls(prev => prev.filter(u => u !== f.url));
                                  toast.success(`${f.filename} supprimé`);
                                } catch (err: any) { toast.error(`Erreur: ${err.message}`); }
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Active URLs */}
                  <div>
                    <label className="text-sm font-medium">URLs actives ({gameplayUrls.length})</label>
                    {gameplayUrls.length > 0 ? (
                      <div className="mt-1 max-h-32 overflow-y-auto border rounded-md divide-y">
                        {gameplayUrls.map((url, i) => (
                          <div key={i} className="flex items-center justify-between px-2 py-1 text-xs">
                            <span className="truncate font-mono flex-1 mr-2">{url.split("/").pop()}</span>
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive hover:text-destructive shrink-0" onClick={() => setGameplayUrls(prev => prev.filter((_, j) => j !== i))}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">Aucune vidéo sélectionnée.</p>
                    )}
                  </div>
                </div>
              ) : (
              <>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Image de référence de style (optionnel)
                </label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleStyleImageUpload}
                      disabled={isUploadingStyleImage}
                      className="flex-1"
                    />
                    {isUploadingStyleImage && (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    )}
                  </div>
                  <div className="text-xs text-center text-muted-foreground">ou</div>
                  <Input
                    type="url"
                    placeholder="https://exemple.com/image.jpg"
                    value={styleReferenceUrls[0] || ""}
                    onChange={(e) => setStyleReferenceUrls(e.target.value ? [e.target.value] : [])}
                    className="w-full"
                  />
                  {uploadedStyleImageUrl && (
                    <div className="mt-2 relative inline-block">
                      <img 
                        src={uploadedStyleImageUrl} 
                        alt="Style reference" 
                        className="w-32 h-32 object-cover rounded border"
                      />
                      <button
                        type="button"
                        onClick={() => { setStyleReferenceUrls([]); setUploadedStyleImageUrl(""); }}
                        className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow hover:bg-destructive/90"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Uploadez ou collez l'URL d'une image pour guider le style de génération
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Modèle de génération</label>
                  <Select value={imageModel} onValueChange={handleModelChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seedream-4.5">SeedDream 4.5 (Recommandé)</SelectItem>
                      <SelectItem value="ai33-seedream-4.5">SeedDream 4.5 via AI33 Pro</SelectItem>
                      <SelectItem value="seedream-5-lite">SeedDream 5.0 Lite</SelectItem>
                      <SelectItem value="seedream-4">SeedDream 4.0</SelectItem>
                      <SelectItem value="z-image-turbo">Z-Image Turbo (Rapide, max 720p)</SelectItem>
                      <SelectItem value="z-image-turbo-lora">Z-Image Turbo LoRA</SelectItem>
                      <SelectItem value="grok-imagine">Grok Imagine (xAI)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {imageModel === 'z-image-turbo' 
                      ? "Z-Image Turbo est très rapide mais ne supporte pas les images de référence" 
                      : imageModel === 'z-image-turbo-lora'
                      ? "Z-Image Turbo avec LoRA personnalisé"
                      : "SeedDream 4.5 offre une meilleure qualité mais nécessite des images plus grandes"
                    }
                  </p>
                </div>

                {/* Visual continuity option for Seedream models with image_input support */}
                {(imageModel === 'seedream-4.5' || imageModel === 'seedream-5-lite') && (
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="visual-continuity" 
                      checked={visualContinuityEnabled}
                      onCheckedChange={async (checked) => {
                        const newValue = checked as boolean;
                        setVisualContinuityEnabled(newValue);
                        // Sauvegarder dans le projet
                        if (currentProjectId) {
                          try {
                            const { error } = await supabase
                              .from('projects')
                              .update({ visual_continuity_enabled: newValue })
                              .eq('id', currentProjectId);
                            
                            if (error) {
                              console.error('Error saving visual_continuity_enabled:', error);
                              toast.error(`Erreur lors de la sauvegarde: ${error.message}`);
                              // Revert the checkbox state on error
                              setVisualContinuityEnabled(!newValue);
                            } else {
                              console.log('Successfully saved visual_continuity_enabled:', newValue);
                            }
                          } catch (err: any) {
                            console.error('Exception saving visual_continuity_enabled:', err);
                            toast.error(`Erreur: ${err.message || 'Erreur inconnue'}`);
                            // Revert the checkbox state on error
                            setVisualContinuityEnabled(!newValue);
                          }
                        }
                      }}
                    />
                    <Label htmlFor="visual-continuity" className="text-sm cursor-pointer">
                      Continuité visuelle (utilise l'image précédente comme référence si même sujet)
                    </Label>
                  </div>
                )}

                {/* LoRA configuration for z-image-turbo-lora */}
                {imageModel === "z-image-turbo-lora" && (
                  <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                    <h4 className="font-medium text-sm">Configuration LoRA</h4>
                    <div className="space-y-2">
                      <label className="text-sm font-medium block">URL du LoRA (HuggingFace .safetensors)</label>
                      <Input
                        value={loraUrl}
                        onChange={(e) => setLoraUrl(e.target.value)}
                        placeholder="https://huggingface.co/.../resolve/main/model.safetensors"
                      />
                      <p className="text-xs text-muted-foreground">
                        URL publique vers votre fichier .safetensors sur HuggingFace
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium block">Nombre de steps</label>
                      <Input
                        type="number"
                        value={loraSteps}
                        onChange={(e) => setLoraSteps(parseInt(e.target.value) || 10)}
                        min={4}
                        max={50}
                      />
                      <p className="text-xs text-muted-foreground">
                        Plus de steps = meilleure qualité mais plus lent (recommandé: 10)
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium mb-2 block">Format</label>
                  <Select value={aspectRatio} onValueChange={handleAspectRatioChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="16:9">16:9 (Paysage)</SelectItem>
                      <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                      <SelectItem value="1:1">1:1 (Carré)</SelectItem>
                      <SelectItem value="4:3">4:3 (Classique)</SelectItem>
                      <SelectItem value="custom">Personnalisé</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Largeur (px)</label>
                    <Input
                      type="number"
                      min="512"
                      max="4096"
                      step="64"
                      value={imageWidth}
                      onChange={(e) => {
                        setImageWidth(parseInt(e.target.value) || 1920);
                        setAspectRatio("custom");
                      }}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">Hauteur (px)</label>
                    <Input
                      type="number"
                      min="512"
                      max="4096"
                      step="64"
                      value={imageHeight}
                      onChange={(e) => {
                        setImageHeight(parseInt(e.target.value) || 1080);
                        setAspectRatio("custom");
                      }}
                    />
                  </div>
                </div>
              </div>
              </>
              )}

              {/* QA toggle */}
              <div className="flex items-start gap-3 p-4 border rounded-lg">
                <input
                  type="checkbox"
                  id="image-settings-qa-enabled"
                  checked={qaEnabled}
                  onChange={(e) => setQaEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <label htmlFor="image-settings-qa-enabled" className="font-medium cursor-pointer block">
                    Activer le QA (vérification qualité Gemini)
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vérifie automatiquement la qualité des images générées via Gemini et régénère celles qui ne passent pas le contrôle.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-shrink-0 mt-4">
              <Button variant="outline" onClick={() => setImageSettingsOpen(false)}>
                Fermer
              </Button>
              <Button onClick={async () => {
                if (currentProjectId) {
                  await saveProjectData();
                  toast.success("Paramètres d'image sauvegardés");
                }
                setImageSettingsOpen(false);
              }}>
                Sauvegarder
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm generate images dialog */}
        <AlertDialog open={confirmGenerateImages} onOpenChange={setConfirmGenerateImages}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmer la génération des images</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                {(() => {
                  const existingImagesCount = generatedPrompts.filter(p => p && p.imageUrl).length;
                  const missingImagesCount = generatedPrompts.length - existingImagesCount;
                  
                  return (
                    <>
                      {existingImagesCount > 0 && (
                        <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-md">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                            ⚠️ {existingImagesCount} image{existingImagesCount > 1 ? 's' : ''} déjà générée{existingImagesCount > 1 ? 's' : ''}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {missingImagesCount > 0 
                              ? `${missingImagesCount} image${missingImagesCount > 1 ? 's' : ''} restante${missingImagesCount > 1 ? 's' : ''} à générer`
                              : "Toutes les images ont déjà été générées"}
                          </p>
                        </div>
                      )}
                      
                      <p>Paramètres de génération :</p>
                      <div className="bg-muted p-3 rounded-md space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">Résolution :</span>
                          <span>{imageWidth}x{imageHeight} px</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-medium">Format :</span>
                          <span>{aspectRatio === "custom" ? "Personnalisé" : aspectRatio}</span>
                        </div>
                        {styleReferenceUrls.length > 0 && (
                          <div className="flex justify-between">
                            <span className="font-medium">Référence de style :</span>
                            <span className="text-xs text-primary">{styleReferenceUrls.length} image(s)</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs">Cette opération peut prendre plusieurs minutes.</p>
                    </>
                  );
                })()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              {generatedPrompts.filter(p => p && p.imageUrl).length > 0 && (
                <AlertDialogAction
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => {
                    setConfirmGenerateImages(false);
                    generateAllImages(true);
                  }}
                >
                  Générer uniquement les manquantes
                </AlertDialogAction>
              )}
              <AlertDialogAction onClick={() => {
                setConfirmGenerateImages(false);
                generateAllImages(false);
              }}>
                {generatedPrompts.filter(p => p && p.imageUrl).length > 0 ? "Tout régénérer" : "Générer"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Export Dialog */}
        <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Exporter pour montage vidéo</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground">
                  Exportez vos scènes et images dans un format compatible avec votre logiciel de montage.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Format d'export</Label>
                  <RadioGroup value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}>
                    <div className="flex items-start space-x-3 space-y-0">
                      <RadioGroupItem value="premiere-xml" id="format-xml" />
                      <div className="space-y-1 leading-none">
                        <Label htmlFor="format-xml" className="cursor-pointer font-medium">
                          Premiere Pro XML
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Compatible avec Adobe Premiere Pro, Final Cut Pro, DaVinci Resolve
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 space-y-0">
                      <RadioGroupItem value="edl" id="format-edl" />
                      <div className="space-y-1 leading-none">
                        <Label htmlFor="format-edl" className="cursor-pointer font-medium">
                          EDL (Edit Decision List)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Format universel, compatible avec la plupart des logiciels de montage
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 space-y-0">
                      <RadioGroupItem value="csv" id="format-csv" />
                      <div className="space-y-1 leading-none">
                        <Label htmlFor="format-csv" className="cursor-pointer font-medium">
                          CSV
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Tableur pour vérification ou import manuel
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3 pt-2 border-t">
                  <Label className="text-base font-semibold">Mode d'export</Label>
                  <RadioGroup value={exportMode} onValueChange={(value) => setExportMode(value as ExportMode)}>
                    <div className="flex items-start space-x-3 space-y-0">
                      <RadioGroupItem value="with-images" id="mode-zip" />
                      <div className="space-y-1 leading-none">
                        <Label htmlFor="mode-zip" className="cursor-pointer font-medium">
                          ZIP avec images (recommandé)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Télécharge un ZIP contenant le fichier d'export + toutes les images
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 space-y-0">
                      <RadioGroupItem value="urls-only" id="mode-urls" />
                      <div className="space-y-1 leading-none">
                        <Label htmlFor="mode-urls" className="cursor-pointer font-medium">
                          Fichier seul avec URLs
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Plus léger, mais nécessite une connexion internet lors de l'import
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3 pt-2 border-t">
                  <Label className="text-base font-semibold">Cadence de la timeline (images/seconde)</Label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Choisissez la même cadence que votre timeline dans DaVinci Resolve / Premiere Pro
                  </p>
                  <Select value={exportFramerate.toString()} onValueChange={(value) => setExportFramerate(Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="23.976">23.976 fps (Film)</SelectItem>
                      <SelectItem value="24">24 fps (Cinéma)</SelectItem>
                      <SelectItem value="25">25 fps (PAL)</SelectItem>
                      <SelectItem value="29.97">29.97 fps (NTSC)</SelectItem>
                      <SelectItem value="30">30 fps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {exportMode === "with-images" && (
                  <div className="space-y-3 pt-2 border-t">
                    <Label className="text-base font-semibold">Chemin du dossier de destination</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Sélectionnez un preset ou entrez le chemin absolu où vous allez extraire le ZIP.
                    </p>
                    <ExportPathPresetManager
                      currentPath={exportBasePath}
                      onPathChange={setExportBasePath}
                    />
                    {exportBasePath && (
                      <p className="text-xs text-muted-foreground">
                        Chemin final: <code className="px-1 py-0.5 bg-background rounded">{exportBasePath.replace(/\/$/, '')}/{(projectName || "projet_sans_nom").replace(/[/\\?%*:|"<>]/g, '_')}_premiere_with_images/</code>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
                  Annuler
                </Button>
                <Button onClick={handleExport} disabled={isExporting}>
                  {isExporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Export en cours...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Exporter
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>


        {/* Edit Prompt Dialog */}
        <Dialog open={editingPromptIndex !== null} onOpenChange={(open) => !open && setEditingPromptIndex(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifier le prompt</DialogTitle>
              <DialogDescription>
                Modifiez le texte du prompt pour la scène {editingPromptIndex !== null ? editingPromptIndex + 1 : ''}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={editingPromptText}
              onChange={(e) => setEditingPromptText(e.target.value)}
              rows={6}
              className="w-full"
              placeholder="Entrez le nouveau prompt..."
            />
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setEditingPromptIndex(null)}>
                Annuler
              </Button>
              <Button onClick={handleSaveEditedPrompt}>
                Enregistrer
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Scene Text Dialog */}
        <Dialog open={editingSceneIndex !== null} onOpenChange={(open) => !open && setEditingSceneIndex(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifier le texte de la scène</DialogTitle>
              <DialogDescription>
                Modifiez le texte pour la scène {editingSceneIndex !== null ? editingSceneIndex + 1 : ''}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={editingSceneText}
              onChange={(e) => setEditingSceneText(e.target.value)}
              rows={6}
              className="w-full"
              placeholder="Entrez le nouveau texte..."
            />
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setEditingSceneIndex(null)}>
                Annuler
              </Button>
              <Button onClick={handleSaveEditedScene}>
                Enregistrer
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Thumbnail Generator Dialog */}
        <Dialog open={thumbnailDialogOpen} onOpenChange={setThumbnailDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Générateur de Miniatures YouTube</DialogTitle>
            </DialogHeader>
            <ThumbnailGenerator
              projectId={currentProjectId || ""}
              videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
              videoTitle={projectName}
            />
          </DialogContent>
        </Dialog>

        {/* Generation Statistics Dialog */}
        <Dialog open={generationStatsDialog} onOpenChange={setGenerationStatsDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Génération terminée
              </DialogTitle>
            </DialogHeader>
            
            {generationStats && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-3 gap-4">
                  {/* Generated */}
                  <Card className="p-4 bg-green-500/10 border-green-500/20">
                    <div className="text-center">
                      <Check className="h-6 w-6 text-green-500 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {generationStats.generated}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Générées
                      </div>
                    </div>
                  </Card>

                  {/* Skipped */}
                  <Card className="p-4 bg-blue-500/10 border-blue-500/20">
                    <div className="text-center">
                      <Copy className="h-6 w-6 text-blue-500 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {generationStats.skipped}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Conservées
                      </div>
                    </div>
                  </Card>

                  {/* Failed */}
                  <Card className="p-4 bg-red-500/10 border-red-500/20">
                    <div className="text-center">
                      <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {generationStats.failed}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Manquantes
                      </div>
                    </div>
                  </Card>
                </div>

                {generationStats.failed > 0 && (
                  <div className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="text-muted-foreground">
                      Utilisez le bouton "Vérifier les images manquantes" pour identifier et régénérer les images qui ont échoué.
                    </p>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={() => setGenerationStatsDialog(false)}>
                    Fermer
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Configuration Modal after transcription */}
        <Dialog open={showConfigurationModal} onOpenChange={setShowConfigurationModal}>
          <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] sm:w-full flex flex-col p-6">
            <div className="overflow-y-auto flex-1 min-h-0">
            {transcriptData && currentProjectId && (
              <ProjectConfigurationModal
                transcriptData={transcriptData}
                currentProjectId={currentProjectId}
                isAnimatorChannel={isAnimatorChannel}
                onComplete={async (semiAutoMode: boolean) => {
                  setShowConfigurationModal(false);
                  
                  // Fetch fresh config from database and generate scenes
                  const { data, error } = await supabase
                    .from("projects")
                    .select("*")
                    .eq("id", currentProjectId)
                    .single();
                  
                  if (error || !data) {
                    toast.error("Erreur lors du chargement de la configuration");
                    return;
                  }
                  
                  // Update local state with fresh data from duration_ranges or legacy format
                  const projectData = data as any;
                  let rangesToUse: DurationRange[];
                  if (projectData.duration_ranges && Array.isArray(projectData.duration_ranges) && projectData.duration_ranges.length > 0) {
                    rangesToUse = projectData.duration_ranges;
                    setDurationRanges(projectData.duration_ranges);
                  } else {
                    rangesToUse = convertLegacyToRanges(
                      data.scene_duration_0to1 || 4,
                      data.scene_duration_1to3 || 6,
                      data.scene_duration_3plus || 8,
                      projectData.range_end_1 || 60,
                      projectData.range_end_2 || 180
                    );
                    setDurationRanges(rangesToUse);
                  }
                  
                  if (data.example_prompts) {
                    setExamplePrompts(data.example_prompts as string[]);
                  }
                  if (data.image_width) setImageWidth(data.image_width);
                  if (data.image_height) setImageHeight(data.image_height);
                  if (data.aspect_ratio) setAspectRatio(data.aspect_ratio);
                  if (data.image_model) setImageModel(data.image_model);
                  if ((data as any).lora_url) setLoraUrl((data as any).lora_url);
                  if ((data as any).lora_steps) setLoraSteps((data as any).lora_steps);
                  setQaEnabled((data as any).qa_enabled === true);
                  if (data.style_reference_url) {
                    setStyleReferenceUrls(parseStyleReferenceUrls(data.style_reference_url));
                  }
                  
                  // Store thumbnail preset ID from database
                  if ((data as any).thumbnail_preset_id) {
                    thumbnailPresetIdRef.current = (data as any).thumbnail_preset_id;
                  }
                  
                  // Generate scenes with fresh configuration
                  if (transcriptData) {
                    const generatedScenes = parseTranscriptToScenes(
                      transcriptData,
                      rangesToUse, // Use the ranges we just computed, not the stale state
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      preferSentenceBoundaries
                    );
                    setScenes(generatedScenes);
                    
                    // Save scenes to database first
                    const { error: scenesError } = await supabase
                      .from("projects")
                      .update({ scenes: generatedScenes as any })
                      .eq("id", currentProjectId);
                    
                    if (scenesError) {
                      console.error("Error saving scenes:", scenesError);
                      toast.error("Erreur lors de la sauvegarde des scènes");
                      return;
                    }
                    
                    // Verify scenes were saved by fetching the project again
                    const { data: verifyProject, error: verifyError } = await supabase
                      .from("projects")
                      .select("scenes")
                      .eq("id", currentProjectId)
                      .single();
                    
                    if (verifyError || !verifyProject || !verifyProject.scenes || (verifyProject.scenes as any[]).length === 0) {
                      console.error("Scenes not found after save:", verifyError);
                      toast.error("Erreur: les scènes n'ont pas été sauvegardées correctement");
                      return;
                    }
                    
                    toast.success(`${generatedScenes.length} scènes générées !`);
                    
                    // If semi-auto mode (not for animator channels), start automatic generation pipeline
                    if (semiAutoMode && !isAnimatorChannel) {
                      console.log("Semi-auto mode: Starting prompts generation...");
                      console.log("Scenes count:", generatedScenes.length);
                      console.log("Verified scenes in DB:", (verifyProject.scenes as any[]).length);
                      console.log("Current project ID:", currentProjectId);
                      
                      // Reset all manually_regenerated flags for full regeneration
                      setRegeneratedScenes(new Set());
                      
                      toast.info("Mode semi-automatique activé. Génération des prompts en cours...");
                      
                      // Start prompts job - images will be triggered after prompts complete
                      try {
                        const result = await startJob('prompts', { 
                          regenerate: false,
                          semiAutoMode: true,
                          // Only pass thumbnailPresetId if auto-chaining is enabled
                          thumbnailPresetId: thumbnailChainEnabledRef.current ? thumbnailPresetIdRef.current : null
                        });
                        
                        if (result) {
                          console.log("Prompts job started successfully:", result.jobId);
                          setIsGeneratingPrompts(true);
                        } else {
                          console.error("Failed to start prompts job - no result returned");
                          toast.error("Erreur lors du démarrage de la génération des prompts");
                        }
                      } catch (error) {
                        console.error("Error starting prompts job:", error);
                        toast.error(`Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
                      }
                    }
                  }
                }}
                onCancel={() => setShowConfigurationModal(false)}
              />
            )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Scroll to top button */}
        {showScrollTop && (
          <Button
            variant="secondary"
            size="icon"
            className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg animate-fade-in h-12 w-12"
            onClick={scrollToTop}
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default Index;
