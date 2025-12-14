import { useState, useEffect, useRef, useCallback } from "react";
import { parseStyleReferenceUrls, serializeStyleReferenceUrls } from "@/lib/styleReferenceHelpers";
import { parseTranscriptToScenes, TranscriptData, TranscriptSegment, Scene } from "@/lib/sceneParser";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, Loader2, Image as ImageIcon, RefreshCw, Settings, Download, User as UserIcon, Video, Type, Sparkles, Check, Copy, FolderOpen, Pencil, AlertCircle, FileText, ArrowUp, MonitorPlay, Cloud, Trash2, Hash } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { VideoPreview } from "@/components/VideoPreview";
import { PresetManager } from "@/components/PresetManager";
import { ThumbnailGenerator } from "@/components/ThumbnailGenerator";
import { TitleGenerator } from "@/components/TitleGenerator";
import { DescriptionGenerator } from "@/components/DescriptionGenerator";
import { TagGenerator } from "@/components/TagGenerator";
import { YouTubeTester } from "@/components/YouTubeTester";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { ActiveJobsBanner } from "@/components/JobProgressIndicator";

// TranscriptSegment, TranscriptData, and Scene are imported from @/lib/sceneParser

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

const Index = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([]);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [sceneDuration0to1, setSceneDuration0to1] = useState(4);
  const [sceneDuration1to3, setSceneDuration1to3] = useState(6);
  const [sceneDuration3plus, setSceneDuration3plus] = useState(8);
  const [sceneFormat, setSceneFormat] = useState<"long" | "short">("long");
  
  // Scene range boundaries (in seconds)
  const [range1End, setRange1End] = useState(60);      // Default: 0-60s (0-1 min)
  const [range2End, setRange2End] = useState(180);     // Default: 60-180s (1-3 min)
  // range3 is 180+ (3+ min)
  const [preferSentenceBoundaries, setPreferSentenceBoundaries] = useState(true);
  const [promptSystemMessage, setPromptSystemMessage] = useState<string>("");
  const cancelGenerationRef = useRef(false);
  const cancelImageGenerationRef = useRef(false);
  const [imageWidth, setImageWidth] = useState<number>(1920);
  const [imageHeight, setImageHeight] = useState<number>(1080);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [imageModel, setImageModel] = useState<string>("seedream-4.5");
  const [loraUrl, setLoraUrl] = useState<string>("");
  const [loraSteps, setLoraSteps] = useState<number>(10);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
  const [generatingPromptIndex, setGeneratingPromptIndex] = useState<number | null>(null);
  const [styleReferenceUrls, setStyleReferenceUrls] = useState<string[]>([]);
  const [uploadedStyleImageUrl, setUploadedStyleImageUrl] = useState<string>("");
  const [isUploadingStyleImage, setIsUploadingStyleImage] = useState(false);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [regeneratingPromptIndex, setRegeneratingPromptIndex] = useState<number | null>(null);
  const [confirmRegeneratePrompt, setConfirmRegeneratePrompt] = useState<number | null>(null);
  const [confirmRegenerateImage, setConfirmRegenerateImage] = useState<number | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  const [confirmGenerateImages, setConfirmGenerateImages] = useState(false);
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState<string>("");
  const [editingSceneIndex, setEditingSceneIndex] = useState<number | null>(null);
  const [editingSceneText, setEditingSceneText] = useState<string>("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("premiere-xml");
  const [exportMode, setExportMode] = useState<ExportMode>("with-images");
  const [exportFramerate, setExportFramerate] = useState<number>(25);
  const [exportBasePath, setExportBasePath] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [hasTestedFirstTwo, setHasTestedFirstTwo] = useState(false);
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
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectNameValue, setEditingProjectNameValue] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showConfigurationModal, setShowConfigurationModal] = useState(false);

  // Ref to store thumbnail preset ID for semi-auto mode
  const thumbnailPresetIdRef = useRef<string | null>(null);

  // Use ref for currentProjectId to avoid stale closures in callbacks
  const currentProjectIdRef = useRef(currentProjectId);
  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  // Ref for startJob to use in callbacks without circular dependency
  const startJobRef = useRef<((jobType: any, metadata?: any) => Promise<any>) | null>(null);

  // Background job management
  const handleJobComplete = useCallback((job: GenerationJob) => {
    const messages: Record<string, string> = {
      'transcription': 'Transcription terminée !',
      'prompts': 'Prompts générés en arrière-plan !',
      'images': 'Images générées en arrière-plan !',
      'thumbnails': 'Miniatures générées en arrière-plan !',
      'test_images': 'Test des 2 premières scènes terminé !',
      'single_prompt': 'Prompt généré !',
      'single_image': 'Image générée !'
    };
    toast.success(messages[job.job_type] || 'Génération terminée !');
    
    // Check if semi-auto mode is enabled and chain next job
    const metadata = job.metadata as { semiAutoMode?: boolean; thumbnailPresetId?: string } | null;
    const isSemiAuto = metadata?.semiAutoMode === true;
    const thumbnailPresetId = metadata?.thumbnailPresetId || thumbnailPresetIdRef.current;
    
    // Reset generating states
    if (job.job_type === 'prompts') {
      setIsGeneratingPrompts(false);
      
      // Semi-auto: backend already chains to images job, just update UI state
      if (isSemiAuto) {
        toast.info("Génération des images en cours...");
        setIsGeneratingImages(true);
      }
    } else if (job.job_type === 'images') {
      setIsGeneratingImages(false);
      
      // Semi-auto: backend already chains to thumbnails job if preset is set
      if (isSemiAuto && thumbnailPresetId) {
        toast.info("Génération des miniatures en cours...");
      } else if (isSemiAuto && !thumbnailPresetId) {
        toast.success("🎉 Génération semi-automatique terminée (sans miniatures - aucun preset sélectionné) !");
      }
    } else if (job.job_type === 'thumbnails') {
      // Semi-auto complete!
      if (isSemiAuto) {
        toast.success("🎉 Génération semi-automatique terminée !");
      }
    } else if (job.job_type === 'test_images') {
      setIsGeneratingPrompts(false);
      setIsGeneratingImages(false);
      setHasTestedFirstTwo(true);
    } else if (job.job_type === 'single_prompt') {
      setGeneratingPromptIndex(null);
      setRegeneratingPromptIndex(null);
    } else if (job.job_type === 'single_image') {
      setGeneratingImageIndex(null);
    }
    
    // Reload project data to get updated data - use ref to get current value
    const projectId = currentProjectIdRef.current;
    if (projectId) {
      // Fetch fresh data from database
      supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single()
        .then(({ data, error }) => {
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
          
          // Update prompts
          const validPrompts = ((data.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null);
          setGeneratedPrompts(validPrompts);
          
          // Update audio URL
          if (data.audio_url) {
            setAudioUrl(data.audio_url);
          }
          
          // If transcription just completed and no scenes yet, show configuration modal
          if (job.job_type === 'transcription' && data.transcript_json && existingScenes.length === 0) {
            setShowConfigurationModal(true);
          }
        });
    }
  }, []);

  const handleJobFailed = useCallback((job: GenerationJob) => {
    toast.error(`Erreur: ${job.error_message || 'Génération échouée'}`);
    // Reset generating states
    if (job.job_type === 'prompts') {
      setIsGeneratingPrompts(false);
    } else if (job.job_type === 'images') {
      setIsGeneratingImages(false);
    } else if (job.job_type === 'test_images') {
      setIsGeneratingPrompts(false);
      setIsGeneratingImages(false);
    } else if (job.job_type === 'single_prompt') {
      setGeneratingPromptIndex(null);
      setRegeneratingPromptIndex(null);
    } else if (job.job_type === 'single_image') {
      setGeneratingImageIndex(null);
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

  // Keep startJobRef updated so handleJobComplete can use it
  useEffect(() => {
    startJobRef.current = startJob;
  }, [startJob]);

  // Sync generating states with active jobs
  useEffect(() => {
    setIsGeneratingPrompts(hasActiveJob('prompts') || hasActiveJob('test_images'));
    setIsGeneratingImages(hasActiveJob('images') || hasActiveJob('test_images'));
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
      loadProjectData(currentProjectId);
    }
  }, [currentProjectId]);

  // Poll for project updates to refresh images in real-time during generation
  useEffect(() => {
    if (!currentProjectId) return;

    let lastPromptsHash = JSON.stringify(generatedPrompts.map(p => p?.imageUrl || null));

    const pollInterval = setInterval(async () => {
      try {
        const { data: projectData } = await supabase
          .from('projects')
          .select('prompts')
          .eq('id', currentProjectId)
          .single();

        if (projectData?.prompts) {
          const newPrompts = projectData.prompts as unknown as GeneratedPrompt[];
          // Filter out null/undefined entries and safely access imageUrl
          const newHash = JSON.stringify(newPrompts.map(p => p?.imageUrl || null));
          
          if (newHash !== lastPromptsHash) {
            console.log('Images updated, refreshing UI');
            setGeneratedPrompts(newPrompts);
            lastPromptsHash = newHash;
          }
        }
      } catch (error) {
        console.error('Error polling for images:', error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [currentProjectId]);

  // Auto-save project data when it changes
  // Note: prompts are NOT included here because they are managed by the backend job queue
  useEffect(() => {
    if (currentProjectId) {
      const timeoutId = setTimeout(() => {
        saveProjectData();
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [currentProjectId, transcriptData, examplePrompts, scenes, sceneDuration0to1, sceneDuration1to3, sceneDuration3plus, styleReferenceUrls, audioUrl, imageWidth, imageHeight, aspectRatio, imageModel, loraUrl, loraSteps, promptSystemMessage]);

  // Track if we've already shown the config modal for this session
  const hasShownConfigModalRef = useRef(false);
  // Track if project data has been loaded at least once
  const projectDataLoadedRef = useRef(false);
  
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
    
    // Only show modal after project data has been loaded at least once
    if (!projectDataLoadedRef.current) return;
    
    // Don't show if prompts already exist - project is already complete
    if (generatedPrompts.length > 0) {
      return;
    }
    
    if (transcriptData && scenes.length === 0 && currentProjectId && !hasActiveJob('transcription') && !hasShownConfigModalRef.current) {
      // Small delay to allow UI to settle
      const timer = setTimeout(() => {
        setShowConfigurationModal(true);
        hasShownConfigModalRef.current = true;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [transcriptData, scenes, generatedPrompts, currentProjectId, hasActiveJob, searchParams]);
  
  // Reset the flag when project changes
  useEffect(() => {
    hasShownConfigModalRef.current = false;
    projectDataLoadedRef.current = false;
  }, [currentProjectId]);

  const loadProjectData = async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;

      // Check if this is a "from scratch" project that needs to continue the workflow
      const hasScript = data.summary && data.summary.length > 100;
      const hasAudio = !!data.audio_url;
      const hasTranscript = data.transcript_json && Object.keys(data.transcript_json).length > 0;
      
      if (hasScript && !hasAudio && !hasTranscript) {
        // This is an incomplete "from scratch" project without audio - redirect to continue
        navigate(`/create-from-scratch?continue=${projectId}`);
        return;
      }
      
      // If project has audio but no transcript, it needs transcription first
      if (hasAudio && !hasTranscript) {
        toast.info("Ce projet nécessite une transcription. Lancement automatique...");
        navigate(`/projects?from_scratch=true&project=${projectId}&needs_transcription=true`);
        return;
      }

      setProjectName(data.name || "");
      
      // Load transcript data
      if (data.transcript_json) {
        setTranscriptData(data.transcript_json as unknown as TranscriptData);
      }
      
      const prompts = (data.example_prompts as string[]) || ["", "", ""];
      setExamplePrompts(Array.isArray(prompts) ? prompts : ["", "", ""]);
      
      // Load scene durations
      setSceneDuration0to1(data.scene_duration_0to1 || 4);
      setSceneDuration1to3(data.scene_duration_1to3 || 6);
      setSceneDuration3plus(data.scene_duration_3plus || 8);
      
      // Load existing scenes - don't auto-generate, let user configure first
      const existingScenes = (data.scenes as unknown as Scene[]) || [];
      setScenes(existingScenes);
      
      // Filter out any null values from prompts array
      const validPrompts = ((data.prompts as unknown as GeneratedPrompt[]) || []).filter(p => p !== null && p !== undefined);
      setGeneratedPrompts(validPrompts);
      
      // Check if test has already been done (at least 2 scenes with images)
      const firstTwoWithImages = validPrompts.slice(0, 2).filter(p => p && p.imageUrl).length;
      if (firstTwoWithImages >= 2) {
        setHasTestedFirstTwo(true);
      }
      
      // Load image dimensions and aspect ratio
      const projectData = data as any;
      if (projectData.image_width) setImageWidth(projectData.image_width);
      if (projectData.image_height) setImageHeight(projectData.image_height);
      if (projectData.aspect_ratio) setAspectRatio(projectData.aspect_ratio);
      if (projectData.image_model) setImageModel(projectData.image_model);
      if (projectData.lora_url) setLoraUrl(projectData.lora_url);
      if (projectData.lora_steps) setLoraSteps(projectData.lora_steps);
      if (projectData.prompt_system_message) setPromptSystemMessage(projectData.prompt_system_message);
      
      const parsedUrls = parseStyleReferenceUrls(data.style_reference_url);
      setStyleReferenceUrls(parsedUrls);
      if (parsedUrls.length > 0) {
        setUploadedStyleImageUrl(parsedUrls[0]);
      }
      if (data.audio_url) {
        setAudioUrl(data.audio_url);
      }
      
      // Load user's saved export base path
      loadExportBasePath();
      
      // Load thumbnail preset ID for semi-auto mode
      if (projectData.thumbnail_preset_id) {
        thumbnailPresetIdRef.current = projectData.thumbnail_preset_id;
      }
      
      // Mark that project data has been loaded
      projectDataLoadedRef.current = true;
    } catch (error: any) {
      console.error("Error loading project:", error);
      toast.error("Erreur lors du chargement du projet");
    }
  };

  const saveProjectData = async () => {
    if (!currentProjectId) return;

    try {
      // Note: prompts are NOT saved here - they are managed by the backend job queue
      const { error } = await supabase
        .from("projects")
        .update({
          transcript_json: transcriptData as any,
          example_prompts: examplePrompts as any,
          scenes: scenes as any,
          scene_duration_0to1: sceneDuration0to1,
          scene_duration_1to3: sceneDuration1to3,
          scene_duration_3plus: sceneDuration3plus,
          image_width: imageWidth,
          image_height: imageHeight,
          aspect_ratio: aspectRatio,
          image_model: imageModel,
          lora_url: loraUrl || null,
          lora_steps: loraSteps,
          style_reference_url: serializeStyleReferenceUrls(styleReferenceUrls),
          audio_url: audioUrl || null,
          prompt_system_message: promptSystemMessage || null,
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
      const { error } = await supabase
        .from("projects")
        .update({ name: editingProjectNameValue.trim() })
        .eq("id", currentProjectId);

      if (error) throw error;
      
      setProjectName(editingProjectNameValue.trim());
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
        sceneDuration0to1,
        sceneDuration1to3,
        sceneDuration3plus,
        range1End,
        range2End,
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
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    toast.success("Prompt copié !");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleAspectRatioChange = (ratio: string) => {
    setAspectRatio(ratio);
    // Use lower resolutions for z-image-turbo and z-image-turbo-lora (max 1440px)
    const isZImageTurbo = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    switch (ratio) {
      case "16:9":
        setImageWidth(isZImageTurbo ? 1280 : 1920);
        setImageHeight(isZImageTurbo ? 720 : 1080);
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
    if (model === 'z-image-turbo' || model === 'z-image-turbo-lora') {
      const MAX_DIM = 1440;
      if (imageWidth > MAX_DIM || imageHeight > MAX_DIM) {
        const scale = Math.min(MAX_DIM / imageWidth, MAX_DIM / imageHeight);
        setImageWidth(Math.floor(imageWidth * scale));
        setImageHeight(Math.floor(imageHeight * scale));
        toast.info("Dimensions ajustées pour Z-Image Turbo (max 1440px)");
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
      setGeneratingImageIndex(sceneIndex);
      
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
      setGeneratingImageIndex(null);
    }
  };

  const handleEditPrompt = (index: number) => {
    const prompt = generatedPrompts[index];
    if (prompt) {
      setEditingPromptIndex(index);
      setEditingPromptText(prompt.prompt);
    }
  };

  const handleSaveEditedPrompt = async () => {
    if (editingPromptIndex === null) return;
    
    const updatedPrompts = [...generatedPrompts];
    updatedPrompts[editingPromptIndex] = {
      ...updatedPrompts[editingPromptIndex],
      prompt: editingPromptText
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
        toast.success("Prompt modifié avec succès");
      } catch (error) {
        console.error("Error saving prompt:", error);
        toast.error("Erreur lors de la sauvegarde du prompt");
      }
    }
    
    setEditingPromptIndex(null);
    setEditingPromptText("");
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

    setGeneratingImageIndex(index);
    
    // Start background job
    const result = await startJob('single_image', { sceneIndex: index });
    if (!result) {
      setGeneratingImageIndex(null);
    }
  };

  const handleTestFirstTwo = async () => {
    if (scenes.length === 0) {
      toast.error("Veuillez d'abord générer les scènes");
      return;
    }

    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    // Check if already has active job
    if (hasActiveJob('test_images')) {
      toast.info("Un test est déjà en cours");
      return;
    }

    // Start background job
    const result = await startJob('test_images');
    if (result) {
      setIsGeneratingPrompts(true);
      setIsGeneratingImages(true);
      setGeneratedPrompts([]); // Clear prompts to show fresh results
      toast.info("Test des 2 premières scènes lancé en arrière-plan. Vous pouvez quitter cette page.");
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

    // Start background job
    const result = await startJob('images', { skipExisting });
    if (result) {
      setIsGeneratingImages(true);
      toast.info("Génération des images lancée en arrière-plan. Vous pouvez quitter cette page.");
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

    setIsExporting(true);

    try {
      // Build basePath from user input - construct full path including project name folder
      const sanitizedProjectName = (projectName || "projet_sans_nom").replace(/[/\\?%*:|"<>]/g, '_');
      const fullBasePath = exportBasePath 
        ? `${exportBasePath.replace(/\/$/, '')}/${sanitizedProjectName}_premiere_with_images`
        : undefined;
      
      const options = {
        format: exportFormat,
        mode: exportMode,
        projectName: projectName || "projet_sans_nom",
        framerate: exportFramerate,
        width: imageWidth,
        height: imageHeight,
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

  const handleLoadPreset = async (preset: {
    name: string;
    scene_duration_0to1: number;
    scene_duration_1to3: number;
    scene_duration_3plus: number;
    example_prompts: string[];
    image_width: number;
    image_height: number;
    aspect_ratio: string;
    style_reference_url: string | null;
    image_model: string;
    prompt_system_message: string | null;
    lora_url?: string | null;
    lora_steps?: number;
  }) => {
    setSceneDuration0to1(preset.scene_duration_0to1);
    setSceneDuration1to3(preset.scene_duration_1to3);
    setSceneDuration3plus(preset.scene_duration_3plus);
    setExamplePrompts(preset.example_prompts);
    setImageWidth(preset.image_width);
    setImageHeight(preset.image_height);
    setAspectRatio(preset.aspect_ratio);
    setImageModel(preset.image_model);
    setLoraUrl(preset.lora_url || "");
    setLoraSteps(preset.lora_steps || 10);
    setActivePresetName(preset.name);
    setPromptSystemMessage(preset.prompt_system_message || "");
    const parsedUrls = parseStyleReferenceUrls(preset.style_reference_url);
    setStyleReferenceUrls(parsedUrls);
    if (parsedUrls.length > 0) {
      setUploadedStyleImageUrl(parsedUrls[0]);
    }
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
        sceneDuration0to1,
        sceneDuration1to3,
        sceneDuration3plus,
        range1End,
        range2End,
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <div className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-2 sm:px-4 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0">
                <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
                  <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
                </div>
                <span className="text-lg sm:text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent hidden xs:inline">
                  VidéoFlow
                </span>
              </Link>
              {currentProjectId && projectName && (
                <>
                  <span className="text-muted-foreground hidden sm:inline">/</span>
                  {isEditingProjectName ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Input
                        value={editingProjectNameValue}
                        onChange={(e) => setEditingProjectNameValue(e.target.value)}
                        className="h-8 w-full sm:w-64"
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
                      <Button size="sm" onClick={handleSaveProjectName} className="flex-shrink-0">Enregistrer</Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setIsEditingProjectName(false);
                        setEditingProjectNameValue("");
                      }} className="flex-shrink-0">Annuler</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group min-w-0">
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
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              <Button variant="outline" size="sm" asChild className="text-xs sm:text-sm">
                <Link to="/projects">
                  <FolderOpen className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Mes projets</span>
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="text-xs sm:text-sm">
                <Link to="/profile">
                  <UserIcon className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Profil</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

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
                  <span className="hidden xs:inline">Vidéo</span>
                </TabsTrigger>
                <TabsTrigger value="thumbnails" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <ImageIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Miniatures</span>
                </TabsTrigger>
                <TabsTrigger value="titles" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Type className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Titres</span>
                </TabsTrigger>
                <TabsTrigger value="descriptions" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Desc.</span>
                </TabsTrigger>
                <TabsTrigger value="test" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <MonitorPlay className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Test</span>
                </TabsTrigger>
                <TabsTrigger value="tags" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Hash className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Tags</span>
                </TabsTrigger>
                <TabsTrigger value="transcript" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3">
                  <Type className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Script</span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Banner fixe pour les jobs actifs - sticky sous le header */}
            {activeJobs.length > 0 && (
              <div className="sticky top-20 z-30 bg-background border rounded-lg p-3 mb-4 shadow-md">
                <ActiveJobsBanner 
                  jobs={activeJobs} 
                  onCancel={cancelJob}
                />
              </div>
            )}

            <TabsContent value="video" className="space-y-6 m-0">
                {transcriptData && (
                  <Card className="p-4 bg-muted/30 border-primary/20">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="font-medium">Transcription chargée</span>
                      {audioUrl && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">Audio chargé</span>
                        </>
                      )}
                      {scenes.length > 0 && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">{scenes.length} scènes</span>
                        </>
                      )}
                      {examplePrompts.some(p => p.trim()) && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">Prompts configurés</span>
                        </>
                      )}
                    </div>
                  </Card>
                )}

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
                    sceneDuration0to1,
                    sceneDuration1to3,
                    sceneDuration3plus,
                    examplePrompts,
                    imageWidth,
                    imageHeight,
                    aspectRatio,
                    styleReferenceUrls,
                    imageModel,
                    promptSystemMessage,
                    loraUrl,
                    loraSteps,
                  }}
                  onLoadPreset={handleLoadPreset}
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
                {transcriptData && scenes.length === 0 && generatedPrompts.length === 0 && (
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

                <div className="grid grid-cols-3 gap-6">
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
                      <div>0-{range1End}s: {sceneDuration0to1}s par scène</div>
                      <div>{range1End}-{range2End}s: {sceneDuration1to3}s par scène</div>
                      <div>{range2End}s+: {sceneDuration3plus}s par scène</div>
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
                          // Calculate effective dimensions for Z-Image Turbo models
                          const isZImageTurbo = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
                          if (isZImageTurbo && (imageWidth > 1440 || imageHeight > 1440)) {
                            const MAX_DIM = 1440;
                            const scale = Math.min(MAX_DIM / imageWidth, MAX_DIM / imageHeight);
                            let effectiveWidth = Math.floor(imageWidth * scale);
                            let effectiveHeight = Math.floor(imageHeight * scale);
                            // Round to multiples of 16
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
                </div>

                {(scenes.length > 0 || generatedPrompts.length > 0) && (
                  <Card className="p-6">
                    <div className="space-y-4">
                      {/* Header avec titre et boutons */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-semibold">
                            Scènes générées ({scenes.length > 0 ? scenes.length : generatedPrompts.length})
                            {generatedPrompts.length > 0 && ` - ${generatedPrompts.length} prompts`}
                          </h2>
                          {generatedPrompts.filter(p => p && p.imageUrl).length > 0 && (
                            <Button
                              onClick={() => setExportDialogOpen(true)}
                              variant="outline"
                              size="sm"
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Exporter pour montage
                            </Button>
                          )}
                        </div>
                        
                        {/* Boutons d'action - sur une ligne séparée */}
                        <div className="flex flex-wrap gap-2 items-center">
                          <Button
                            onClick={handleTestFirstTwo}
                            disabled={isGeneratingPrompts || isGeneratingImages}
                            size="sm"
                          >
                            {isGeneratingPrompts || isGeneratingImages ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Test en cours...
                              </>
                            ) : (
                              <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Tester (2 premières)
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => handleGeneratePrompts(false)}
                            disabled={isGeneratingPrompts || !hasTestedFirstTwo}
                            title={!hasTestedFirstTwo ? "Veuillez d'abord tester avec les 2 premières scènes" : ""}
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
                                Générer tous les prompts
                              </>
                            )}
                          </Button>
                          {generatedPrompts.length > 0 && (
                            <Button
                              onClick={() => generateAllImages(true)}
                              disabled={
                                isGeneratingImages || 
                                !hasTestedFirstTwo || 
                                generatedPrompts.length < scenes.length
                              }
                              title={
                                !hasTestedFirstTwo 
                                  ? "Veuillez d'abord tester avec les 2 premières scènes" 
                                  : generatedPrompts.length < scenes.length
                                  ? "Veuillez d'abord générer tous les prompts"
                                  : ""
                              }
                              size="sm"
                            >
                              {isGeneratingImages ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Images en cours...
                                </>
                              ) : (
                                <>
                                  <ImageIcon className="mr-2 h-4 w-4" />
                                  Générer toutes les images
                                </>
                              )}
                            </Button>
                          )}
                          {generatedPrompts.length > 0 && !isGeneratingImages && (
                            <Button
                              onClick={() => {
                                // Check for missing prompts (null entries)
                                const missingPromptIndices = generatedPrompts
                                  .map((p, index) => ({ prompt: p, index }))
                                  .filter(item => !item.prompt || !item.prompt.prompt)
                                  .map(item => item.index + 1);
                                
                                // Check for missing images (prompt exists but no imageUrl)
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
                              <AlertCircle className="mr-2 h-4 w-4" />
                              Vérifier images
                            </Button>
                          )}
                          {isGeneratingPrompts && getJobByType('prompts') && (
                            <Button
                              onClick={() => {
                                const job = getJobByType('prompts');
                                if (job) cancelJob(job.id);
                              }}
                              variant="destructive"
                              size="sm"
                            >
                              Annuler prompts
                            </Button>
                          )}
                          {isGeneratingImages && getJobByType('images') && (
                            <Button
                              onClick={() => {
                                const job = getJobByType('images');
                                if (job) cancelJob(job.id);
                              }}
                              variant="destructive"
                              size="sm"
                            >
                              Annuler images
                            </Button>
                          )}
                          {/* Delete dropdown for images/prompts */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="destructive" size="sm">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Supprimer
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={async () => {
                                  if (!currentProjectId || !user) return;
                                  try {
                                    const clearedPrompts = generatedPrompts.map(p => {
                                      const { imageUrl, ...rest } = p;
                                      return { ...rest, imageUrl: null };
                                    });
                                    const { error } = await supabase
                                      .from('projects')
                                      .update({ prompts: clearedPrompts as any })
                                      .eq('id', currentProjectId);
                                    if (error) throw error;
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
                                    const clearedPrompts = generatedPrompts.map(p => ({
                                      ...p,
                                      prompt: null,
                                      imageUrl: null
                                    }));
                                    const { error } = await supabase
                                      .from('projects')
                                      .update({ prompts: clearedPrompts as any })
                                      .eq('id', currentProjectId);
                                    if (error) throw error;
                                    setGeneratedPrompts(clearedPrompts.map(p => ({ ...p, prompt: undefined, imageUrl: undefined })));
                                    toast.success("Tous les prompts et images ont été supprimés");
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
                                      setGeneratedPrompts(project.prompts as any[]);
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
                      generatingImageIndex={generatingImageIndex}
                      copiedIndex={copiedIndex}
                      handleEditScene={handleEditScene}
                      handleEditPrompt={handleEditPrompt}
                      setConfirmRegeneratePrompt={setConfirmRegeneratePrompt}
                      setConfirmRegenerateImage={setConfirmRegenerateImage}
                      generateSinglePrompt={generateSinglePrompt}
                      generateImage={generateImage}
                      uploadManualImage={uploadManualImage}
                      copyToClipboard={copyToClipboard}
                      setImagePreviewUrl={setImagePreviewUrl}
                    />
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="thumbnails" className="m-0">
                <div className="max-w-5xl mx-auto">
                  <ThumbnailGenerator
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                    videoTitle={projectName}
                  />
                </div>
              </TabsContent>

              <TabsContent value="titles" className="m-0">
                <div className="max-w-5xl mx-auto">
                  <TitleGenerator
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                  />
                </div>
              </TabsContent>

              <TabsContent value="descriptions" className="m-0">
                <div className="max-w-5xl mx-auto">
                  <DescriptionGenerator
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                  />
                </div>
              </TabsContent>

              <TabsContent value="test" className="m-0">
                <div className="max-w-6xl mx-auto">
                  <YouTubeTester
                    projectId={currentProjectId || ""}
                    videoTitle={projectName}
                  />
                </div>
              </TabsContent>

              <TabsContent value="tags" className="m-0">
                <div className="max-w-3xl mx-auto">
                  <TagGenerator
                    projectId={currentProjectId || ""}
                    videoScript={generatedPrompts.filter(p => p).map(p => p.text).join(" ")}
                    videoTitle={projectName}
                  />
                </div>
              </TabsContent>

              <TabsContent value="transcript" className="m-0">
                <div className="max-w-3xl mx-auto">
                  <h2 className="text-xl font-semibold mb-4">Transcription</h2>
                  {transcriptData && (transcriptData as { segments?: Array<{ text: string }> }).segments ? (
                    <div className="bg-muted/50 rounded-lg p-6 border">
                      <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                        {((transcriptData as { segments?: Array<{ text: string }> }).segments || []).map(s => s.text).join(' ')}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Aucune transcription disponible</p>
                  )}
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

        {/* Scene settings dialog */}
        <Dialog open={sceneSettingsOpen} onOpenChange={setSceneSettingsOpen}>
          <DialogContent className="max-w-2xl">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Configuration des scènes</h3>
                <p className="text-sm text-muted-foreground">
                  Définissez les durées de scènes selon le contenu
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Format de contenu</label>
                  <RadioGroup value={sceneFormat} onValueChange={(value) => {
                    const newFormat = value as "long" | "short";
                    setSceneFormat(newFormat);
                    // Update range boundaries based on format
                    if (newFormat === "short") {
                      setRange1End(5);
                      setRange2End(15);
                      setSceneDuration0to1(2);
                      setSceneDuration1to3(4);
                      setSceneDuration3plus(6);
                    } else {
                      setRange1End(60);
                      setRange2End(180);
                      setSceneDuration0to1(4);
                      setSceneDuration1to3(6);
                      setSceneDuration3plus(8);
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

                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium mb-2 block">Plage 1 : 0 à {range1End}s</Label>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">Fin de plage (secondes)</Label>
                          <Input
                            type="number"
                            min="1"
                            max={sceneFormat === "long" ? "120" : "30"}
                            value={range1End}
                            onChange={(e) => setRange1End(parseInt(e.target.value) || 1)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                          <Input
                            type="number"
                            min="1"
                            max="60"
                            value={sceneDuration0to1}
                            onChange={(e) => setSceneDuration0to1(parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium mb-2 block">Plage 2 : {range1End}s à {range2End}s</Label>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">Fin de plage (secondes)</Label>
                          <Input
                            type="number"
                            min={range1End + 1}
                            max={sceneFormat === "long" ? "600" : "60"}
                            value={range2End}
                            onChange={(e) => setRange2End(parseInt(e.target.value) || range1End + 1)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                          <Input
                            type="number"
                            min="1"
                            max="180"
                            value={sceneDuration1to3}
                            onChange={(e) => setSceneDuration1to3(parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium mb-2 block">Plage 3 : {range2End}s et plus</Label>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="opacity-50">
                          <Label className="text-xs text-muted-foreground">Sans limite</Label>
                          <Input disabled value="∞" className="bg-muted" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                          <Input
                            type="number"
                            min="1"
                            max="600"
                            value={sceneDuration3plus}
                            onChange={(e) => setSceneDuration3plus(parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sentence boundary option */}
              <div className="flex items-start space-x-3 p-4 border rounded-lg bg-muted/30">
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

              <div className="flex justify-between">
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
                      sceneDuration0to1,
                      sceneDuration1to3,
                      sceneDuration3plus,
                      range1End,
                      range2End,
                      preferSentenceBoundaries
                    );
                    
                    setScenes(newScenes);
                    setGeneratedPrompts([]);
                    setHasTestedFirstTwo(false);
                    
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
                <Button onClick={() => setSceneSettingsOpen(false)}>
                  Fermer
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Prompt settings dialog */}
        <Dialog open={promptSettingsOpen} onOpenChange={setPromptSettingsOpen}>
          <DialogContent className="max-w-2xl">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Paramètres de prompts</h3>
              </div>

              <div className="space-y-4">
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
                    rows={10}
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
                </div>
                
                {[0, 1, 2].map((index) => (
                  <div key={index}>
                    <label className="text-xs text-muted-foreground block mb-1">
                      Exemple {index + 1} {index === 0 ? "(recommandé)" : "(optionnel)"}
                    </label>
                    <Textarea
                      placeholder={`Ex: "A cinematic scene showing... [your style]"`}
                      value={examplePrompts[index]}
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

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPromptSettingsOpen(false)}>
                  Fermer
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Image settings dialog */}
        <Dialog open={imageSettingsOpen} onOpenChange={setImageSettingsOpen}>
          <DialogContent className="max-w-2xl">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Paramètres d'image</h3>
              </div>

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
                    <div className="mt-2">
                      <img 
                        src={uploadedStyleImageUrl} 
                        alt="Style reference" 
                        className="w-32 h-32 object-cover rounded border"
                      />
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
                      <SelectItem value="seedream-4">SeedDream 4.0</SelectItem>
                      <SelectItem value="z-image-turbo">Z-Image Turbo (Rapide, max 720p)</SelectItem>
                      <SelectItem value="z-image-turbo-lora">Z-Image Turbo LoRA</SelectItem>
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

              <div className="flex justify-end">
                <Button onClick={() => setImageSettingsOpen(false)}>
                  Fermer
                </Button>
              </div>
            </div>
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
          <DialogContent className="max-w-md">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-2">Exporter pour montage vidéo</h2>
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
                      Entrez le chemin absolu où vous allez extraire le ZIP. DaVinci/Premiere trouvera automatiquement les médias.
                    </p>
                    <Input
                      value={exportBasePath}
                      onChange={(e) => setExportBasePath(e.target.value)}
                      placeholder="/Users/VotreNom/Downloads"
                      className="font-mono text-sm"
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
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            {transcriptData && currentProjectId && (
              <ProjectConfigurationModal
                transcriptData={transcriptData}
                currentProjectId={currentProjectId}
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
                  
                  // Update local state with fresh data
                  const freshSceneDuration0to1 = data.scene_duration_0to1 || 4;
                  const freshSceneDuration1to3 = data.scene_duration_1to3 || 6;
                  const freshSceneDuration3plus = data.scene_duration_3plus || 8;
                  
                  setSceneDuration0to1(freshSceneDuration0to1);
                  setSceneDuration1to3(freshSceneDuration1to3);
                  setSceneDuration3plus(freshSceneDuration3plus);
                  
                  if (data.example_prompts) {
                    setExamplePrompts(data.example_prompts as string[]);
                  }
                  if (data.image_width) setImageWidth(data.image_width);
                  if (data.image_height) setImageHeight(data.image_height);
                  if (data.aspect_ratio) setAspectRatio(data.aspect_ratio);
                  if (data.image_model) setImageModel(data.image_model);
                  if ((data as any).lora_url) setLoraUrl((data as any).lora_url);
                  if ((data as any).lora_steps) setLoraSteps((data as any).lora_steps);
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
                      freshSceneDuration0to1,
                      freshSceneDuration1to3,
                      freshSceneDuration3plus,
                      range1End,
                      range2End,
                      preferSentenceBoundaries
                    );
                    setScenes(generatedScenes);
                    
                    // Save scenes to database first
                    await supabase
                      .from("projects")
                      .update({ scenes: generatedScenes as any })
                      .eq("id", currentProjectId);
                    
                    toast.success(`${generatedScenes.length} scènes générées !`);
                    
                    // If semi-auto mode, start automatic generation pipeline
                    if (semiAutoMode) {
                      toast.info("Mode semi-automatique activé. Génération des prompts en cours...");
                      
                      // Start prompts job - images will be triggered after prompts complete
                      const result = await startJob('prompts', { 
                        regenerate: false,
                        semiAutoMode: true,
                        thumbnailPresetId: thumbnailPresetIdRef.current
                      });
                      
                      if (result) {
                        setIsGeneratingPrompts(true);
                      }
                    }
                  }
                }}
                onCancel={() => setShowConfigurationModal(false)}
              />
            )}
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
