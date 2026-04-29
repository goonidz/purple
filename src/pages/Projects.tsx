import { useState, useEffect, useCallback } from "react";
import { parseStyleReferenceUrls, serializeStyleReferenceUrls } from "@/lib/styleReferenceHelpers";
import { parseTranscriptToScenes } from "@/lib/sceneParser";
import { DurationRange, DEFAULT_DURATION_RANGES, SHORT_FORM_DURATION_RANGES, convertLegacyToRanges } from "@/lib/durationRanges";
import { sanitizeProjectName } from "@/lib/utils";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Pencil, Check, X, Cloud, Calendar, LayoutGrid, LayoutList, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PresetManager } from "@/components/PresetManager";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import OnboardingDialog from "@/components/OnboardingDialog";
import { useGenerationJobs, GenerationJob } from "@/hooks/useGenerationJobs";
import { ActiveJobsBanner } from "@/components/JobProgressIndicator";
import { DurationRangesEditor } from "@/components/DurationRangesEditor";

interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  scene_count: number;
  prompt_count: number;
  scheduled_date?: string | null;
}

const Projects = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [workflowStep, setWorkflowStep] = useState<"upload" | "transcription" | "review" | "scene-config" | "prompt-config" | "image-config" | "final">("upload");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [transcriptData, setTranscriptData] = useState<any>(null);
  const [durationRanges, setDurationRanges] = useState<DurationRange[]>(DEFAULT_DURATION_RANGES);
  const [sceneFormat, setSceneFormat] = useState<"long" | "short">("long");
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [imageWidth, setImageWidth] = useState(1920);
  const [imageHeight, setImageHeight] = useState(1080);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageModel, setImageModel] = useState("seedream-4.5");
  const [loraUrl, setLoraUrl] = useState("");
  const [loraSteps, setLoraSteps] = useState(10);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [promptSystemMessage, setPromptSystemMessage] = useState("");
  const [qaPrompt, setQaPrompt] = useState("");
  const [styleReferenceFiles, setStyleReferenceFiles] = useState<File[]>([]);
  const [styleReferenceUrls, setStyleReferenceUrls] = useState<string[]>([]);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasCheckedApiKeys, setHasCheckedApiKeys] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [calendarEntryId, setCalendarEntryId] = useState<string | null>(null);
  const [semiAutoMode, setSemiAutoMode] = useState(false);
  const [thumbnailPresets, setThumbnailPresets] = useState<any[]>([]);
  const [selectedThumbnailPresetId, setSelectedThumbnailPresetId] = useState<string>("");
  const [selectedThumbnailPreset2Id, setSelectedThumbnailPreset2Id] = useState<string>("");
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    return (localStorage.getItem("projects_view_mode") as "list" | "grid") || "list";
  });
  const [pageSize, setPageSize] = useState<number>(() => {
    const stored = localStorage.getItem("projects_page_size");
    return stored ? parseInt(stored, 10) : 10;
  });
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [sortColumn, setSortColumn] = useState<"name" | "updated_at" | "scheduled_date">("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const toggleViewMode = () => {
    const next = viewMode === "list" ? "grid" : "list";
    setViewMode(next);
    localStorage.setItem("projects_view_mode", next);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(0);
    localStorage.setItem("projects_page_size", String(size));
  };

  const handleSort = (column: "name" | "updated_at" | "scheduled_date") => {
    if (sortColumn === column) {
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection(column === "name" ? "asc" : "desc");
    }
    setCurrentPage(0);
  };

  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalCount / pageSize);

  useEffect(() => {
    document.title = "Projets";
  }, []);

  useEffect(() => {
    if (user) {
      loadProjects(currentPage, pageSize);
    }
  }, [currentPage, pageSize, sortColumn, sortDirection]);

  // Job management for background transcription
  const handleTranscriptionComplete = useCallback(async (job: GenerationJob) => {
    toast.success("Transcription terminée en arrière-plan !");
    // Load the transcript from the project
    if (currentProjectId) {
      const { data: projectData } = await supabase
        .from("projects")
        .select("transcript_json")
        .eq("id", currentProjectId)
        .single();
      
      if (projectData?.transcript_json) {
        setTranscriptData(projectData.transcript_json);
        setWorkflowStep("review");
      }
    }
    setIsCreating(false);
    loadProjects();
  }, [currentProjectId]);

  const handleTranscriptionFailed = useCallback((job: GenerationJob) => {
    toast.error(`Erreur de transcription: ${job.error_message || 'Échec de la transcription'}`);
    setWorkflowStep("upload");
    setIsCreating(false);
  }, []);

  const { 
    activeJobs, 
    startJob, 
    cancelJob, 
    hasActiveJob 
  } = useGenerationJobs({
    projectId: currentProjectId,
    onJobComplete: handleTranscriptionComplete,
    onJobFailed: handleTranscriptionFailed
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      } else {
        loadProjects();
        checkApiKeys(session.user.id);
        loadThumbnailPresets();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadThumbnailPresets = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("thumbnail_presets")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      if (error) throw error;
      setThumbnailPresets(data || []);
    } catch (error) {
      console.error("Error loading thumbnail presets:", error);
    }
  };

  // Handle calendar data
  useEffect(() => {
    const fromCalendar = searchParams.get("from_calendar");
    if (fromCalendar === "true") {
      const calendarTitle = sessionStorage.getItem("calendar_title");
      const calendarAudioUrl = sessionStorage.getItem("calendar_audio_url");
      const calendarEntryIdStored = sessionStorage.getItem("calendar_entry_id");
      
      if (calendarAudioUrl && calendarTitle) {
        setNewProjectName(calendarTitle);
        setCalendarEntryId(calendarEntryIdStored);
        setIsDialogOpen(true);
        
        // Start transcription with the audio URL from calendar
        // Pass the calendarEntryId directly since state might not be updated yet
        startCalendarTranscription(calendarAudioUrl, calendarTitle, calendarEntryIdStored);
        
        // Load and store channel preset IDs for later use
        const projectPresetId = sessionStorage.getItem("calendar_project_preset_id");
        const thumbnailPresetId = sessionStorage.getItem("calendar_thumbnail_preset_id");
        
        if (projectPresetId) {
          // Store for use in ProjectConfigurationModal
          sessionStorage.setItem("auto_load_project_preset_id", projectPresetId);
        }
        if (thumbnailPresetId) {
          // Set in state so it gets saved to projects.thumbnail_preset_id when the
          // project row is created. ThumbnailGenerator will then read it back from
          // the DB on mount (we no longer mirror this into sessionStorage to avoid
          // cross-project leaks).
          setSelectedThumbnailPresetId(thumbnailPresetId);
        }
        const thumbnailPreset2Id = sessionStorage.getItem("calendar_thumbnail_preset_id_2");
        if (thumbnailPreset2Id) {
          setSelectedThumbnailPreset2Id(thumbnailPreset2Id);
        }
        
        // Transfer thumbnail chain enabled flag (for auto-generation behavior)
        const thumbnailChainEnabled = sessionStorage.getItem("calendar_thumbnail_chain_enabled");
        if (thumbnailChainEnabled) {
          sessionStorage.setItem("auto_thumbnail_chain_enabled", thumbnailChainEnabled);
        }
        
        // Clear sessionStorage after passing data to function
        sessionStorage.removeItem("calendar_script");
        sessionStorage.removeItem("calendar_audio_url");
        sessionStorage.removeItem("calendar_title");
        sessionStorage.removeItem("calendar_entry_id");
        sessionStorage.removeItem("calendar_project_preset_id");
        sessionStorage.removeItem("calendar_thumbnail_preset_id");
        sessionStorage.removeItem("calendar_thumbnail_preset_id_2");
        sessionStorage.removeItem("calendar_thumbnail_chain_enabled");
        
        // Clear URL params
        navigate("/projects", { replace: true });
      }
    }
  }, [searchParams, navigate]);

  // Handle "from scratch" projects that need transcription
  useEffect(() => {
    const fromScratch = searchParams.get("from_scratch");
    const projectId = searchParams.get("project");
    const needsTranscription = searchParams.get("needs_transcription");
    
    if (fromScratch === "true" && projectId && needsTranscription === "true") {
      startFromScratchTranscription(projectId);
      // Clear URL params
      navigate("/projects", { replace: true });
    }
  }, [searchParams, navigate]);

  const startFromScratchTranscription = async (projectId: string) => {
    setIsCreating(true);
    setWorkflowStep("transcription");
    setCurrentProjectId(projectId);
    
    try {
      // Get the project's audio URL
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("audio_url, name")
        .eq("id", projectId)
        .single();
      
      if (projectError) throw projectError;
      if (!project?.audio_url) throw new Error("Pas d'audio trouvé pour ce projet");
      
      setNewProjectName(project.name || "");
      setIsDialogOpen(true);
      
      // Check if there's already a transcription job running for this project
      const { data: existingJobs } = await supabase
        .from("generation_jobs")
        .select("*")
        .eq("project_id", projectId)
        .eq("job_type", "transcription")
        .in("status", ["pending", "processing"]);
      
      if (existingJobs && existingJobs.length > 0) {
        // Job already running, just track it
        toast.info("Transcription déjà en cours. Veuillez patienter...");
        return;
      }
      
      // Start background transcription job
      const result = await startJob('transcription', { audioUrl: project.audio_url }, projectId);
      if (result) {
        toast.info("Transcription lancée en arrière-plan. Une fois terminée, vous pourrez générer les scènes.");
      } else {
        throw new Error("Impossible de démarrer la transcription");
      }
    } catch (error: any) {
      console.error("Error with from-scratch transcription:", error);
      toast.error("Erreur lors de la transcription: " + error.message);
      setWorkflowStep("upload");
      setIsCreating(false);
    }
  };

  const startCalendarTranscription = async (audioUrl: string, projectName: string, entryId?: string | null) => {
    setIsCreating(true);
    setWorkflowStep("transcription");
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Create project with audio URL
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .insert([
          {
            user_id: user.id,
            name: projectName.trim(),
            audio_url: audioUrl,
          },
        ])
        .select()
        .single();

      if (projectError) throw projectError;

      setCurrentProjectId(projectData.id);
      
      // Link calendar entry to project immediately if coming from calendar
      const entryIdToLink = entryId || calendarEntryId;
      if (entryIdToLink) {
        const { error: linkError } = await supabase
          .from("content_calendar")
          .update({ project_id: projectData.id, status: 'generating' })
          .eq("id", entryIdToLink);
        
        if (linkError) {
          console.error("Failed to link calendar entry:", linkError);
        } else {
          console.log("Calendar entry linked successfully:", entryIdToLink);
          setCalendarEntryId(null); // Clear since it's been used
        }
      }
      
      // Start background transcription job with explicit projectId
      const result = await startJob('transcription', { audioUrl }, projectData.id);
      if (result) {
        toast.info("Transcription lancée en arrière-plan. Vous pouvez quitter cette page.");
      } else {
        throw new Error("Impossible de démarrer la transcription");
      }
    } catch (error: any) {
      console.error("Error with calendar transcription:", error);
      toast.error("Erreur lors de la transcription: " + error.message);
      setWorkflowStep("upload");
      setIsCreating(false);
    }
  };


  const checkApiKeys = async (userId: string) => {
    // Ne pas afficher l'onboarding si l'utilisateur l'a déjà vu
    const onboardingCompleted = localStorage.getItem("onboarding_completed");
    const onboardingSkipped = localStorage.getItem("onboarding_skipped");
    
    if (onboardingCompleted || onboardingSkipped) {
      setHasCheckedApiKeys(true);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("replicate_api_key, eleven_labs_api_key")
        .eq("user_id", userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error("Error checking API keys:", error);
        setHasCheckedApiKeys(true);
        return;
      }

      // Afficher l'onboarding si les clés ne sont pas configurées
      const hasKeys = data?.replicate_api_key && data?.eleven_labs_api_key;
      if (!hasKeys) {
        setShowOnboarding(true);
      }
      setHasCheckedApiKeys(true);
    } catch (error) {
      console.error("Error checking API keys:", error);
      setHasCheckedApiKeys(true);
    }
  };

  const loadProjects = async (page = currentPage, size = pageSize) => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error("Not authenticated");

      let query = supabase
        .from("projects")
        .select("id, name, created_at, updated_at, scene_count, prompt_count, scheduled_date", { count: "exact" })
        .eq("user_id", currentUser.id)
        .order(sortColumn, { ascending: sortDirection === "asc", nullsFirst: false });

      if (size > 0) {
        const from = page * size;
        const to = from + size - 1;
        query = query.range(from, to);
      }

      const { data: projectsData, error, count } = await query;

      if (error) throw error;

      setTotalCount(count ?? 0);
      setProjects((projectsData || []) as Project[]);
    } catch (error: any) {
      console.error("Error loading projects:", error);
      toast.error("Erreur lors du chargement des projets");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAudioDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingAudio(true);
  };

  const handleAudioDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingAudio(false);
  };

  const handleAudioDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingAudio(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      // Check if it's an audio file
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|m4a|ogg)$/i)) {
        toast.error("Veuillez importer un fichier audio (MP3, WAV, etc.)");
        return;
      }
      await handleAudioUpload(file);
    }
  };

  const handleAudioUpload = async (file: File) => {
    if (!newProjectName.trim()) {
      toast.error("Veuillez entrer un nom de projet");
      return;
    }

    setIsCreating(true);
    toast.info("Upload du fichier audio en cours...");
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Upload audio to storage with user ID in path
      const audioFileName = `${user.id}/${Date.now()}_${file.name}`;
      const { data: audioData, error: audioError } = await supabase.storage
        .from("audio-files")
        .upload(audioFileName, file);

      if (audioError) throw audioError;

      const { data: { publicUrl } } = supabase.storage
        .from("audio-files")
        .getPublicUrl(audioFileName);

      // Create project with audio URL
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .insert([
          {
            user_id: user.id,
            name: newProjectName.trim(),
            audio_url: publicUrl,
          },
        ])
        .select()
        .single();

      if (projectError) throw projectError;

      setCurrentProjectId(projectData.id);
      setWorkflowStep("transcription");
      
      // Start background transcription job with explicit projectId
      const result = await startJob('transcription', { audioUrl: publicUrl }, projectData.id);
      if (result) {
        toast.info("Transcription lancée en arrière-plan. Vous pouvez quitter cette page.");
      } else {
        throw new Error("Impossible de démarrer la transcription");
      }
    } catch (error: any) {
      console.error("Error creating project:", error);
      toast.error("Erreur : " + (error.message || "Erreur inconnue"));
      setIsCreating(false);
    }
  };

  const handleStyleImageUpload = async (files: FileList) => {
    if (!currentProjectId) return;
    
    if (styleReferenceUrls.length >= 15) {
      toast.error("Vous ne pouvez pas uploader plus de 15 images");
      return;
    }

    const filesToUpload = Array.from(files).slice(0, 15 - styleReferenceUrls.length);
    
    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const uploadPromises = filesToUpload.map(async (file) => {
        const fileName = `${user.id}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("style-references")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("style-references")
          .getPublicUrl(fileName);

        return publicUrl;
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      setStyleReferenceUrls([...styleReferenceUrls, ...uploadedUrls]);
      toast.success(`${uploadedUrls.length} image(s) de référence uploadée(s) !`);
    } catch (error: any) {
      console.error("Error uploading style images:", error);
      toast.error("Erreur lors de l'upload des images");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveStyleImage = (indexToRemove: number) => {
    setStyleReferenceUrls(styleReferenceUrls.filter((_, index) => index !== indexToRemove));
    toast.success("Image supprimée");
  };

  const handleFinalizeConfiguration = async () => {
    if (!currentProjectId || !transcriptData) return;
    
    const projectId = currentProjectId; // Sauvegarder l'ID avant de réinitialiser
    const shouldSemiAuto = semiAutoMode; // Sauvegarder le mode avant de réinitialiser
    const thumbnailPresetId = selectedThumbnailPresetId; // Sauvegarder le preset de miniatures
    const thumbnailPreset2Id = selectedThumbnailPreset2Id; // Preset 2 (A/B test, optionnel)
    const transcript = transcriptData; // Sauvegarder les données de transcription
    
    setIsCreating(true);
    try {
      // Generate scenes from transcript BEFORE saving using dynamic ranges
      const generatedScenes = parseTranscriptToScenes(
        transcript,
        durationRanges,
        undefined, undefined, undefined, undefined,
        true // preferSentenceBoundaries
      );

      // Convert ranges to legacy format for database storage
      const legacyRanges = {
        scene_duration_0to1: durationRanges[0]?.sceneDuration || 4,
        scene_duration_1to3: durationRanges[1]?.sceneDuration || 6,
        scene_duration_3plus: durationRanges[durationRanges.length - 1]?.sceneDuration || 8,
        range_end_1: durationRanges[0]?.endSeconds || 60,
        range_end_2: durationRanges[1]?.endSeconds || 180,
      };

      // Save all configuration + generated scenes + thumbnail preset to database
      const { error } = await supabase
        .from("projects")
        .update({
          ...legacyRanges,
          duration_ranges: durationRanges as any, // Store full ranges as JSON
          example_prompts: examplePrompts,
          image_width: imageWidth,
          image_height: imageHeight,
          aspect_ratio: aspectRatio,
          image_model: imageModel,
          lora_url: loraUrl || null,
          lora_steps: loraSteps,
          preset_id: selectedPresetId || null,
          prompt_system_message: promptSystemMessage || null,
          style_reference_url: serializeStyleReferenceUrls(styleReferenceUrls),
          scenes: generatedScenes as any,
          thumbnail_preset_id: thumbnailPresetId || null,
          thumbnail_preset_id_2: thumbnailPreset2Id || null,
        } as any)
        .eq("id", projectId);

      if (error) throw error;

      // Link project to calendar entry if created from calendar
      if (calendarEntryId) {
        await supabase
          .from("content_calendar")
          .update({ project_id: projectId, status: "generating" })
          .eq("id", calendarEntryId);
        setCalendarEntryId(null);
      }

      toast.success(`Configuration enregistrée ! ${generatedScenes.length} scènes générées.`);
      setIsDialogOpen(false);
      setWorkflowStep("upload");
      setNewProjectName("");
      setTranscriptData(null);
      setCurrentProjectId(null);
      setSemiAutoMode(false);
      setSelectedThumbnailPresetId("");
      
      // Navigate to project - thumbnail preset is now stored in DB
      const params = new URLSearchParams();
      params.set('project', projectId);
      if (shouldSemiAuto) params.set('semi_auto', 'true');
      navigate(`/project?${params.toString()}`);
    } catch (error: any) {
      console.error("Error saving configuration:", error);
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setIsCreating(false);
    }
  };
  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le projet "${projectName}" ?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) throw error;

      toast.success("Projet supprimé");
      await loadProjects();
    } catch (error: any) {
      console.error("Error deleting project:", error);
      toast.error("Erreur lors de la suppression du projet");
    }
  };

  const handleStartEditProject = (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.stopPropagation();
    setEditingProjectId(projectId);
    setEditingProjectName(projectName);
  };

  const handleSaveProjectName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingProjectId || !editingProjectName.trim()) return;

    try {
      const { error } = await supabase
        .from("projects")
        .update({ name: editingProjectName.trim() })
        .eq("id", editingProjectId);

      if (error) throw error;

      setProjects(projects.map(p => 
        p.id === editingProjectId ? { ...p, name: editingProjectName.trim() } : p
      ));
      setEditingProjectId(null);
      setEditingProjectName("");
      toast.success("Titre mis à jour");
    } catch (error: any) {
      console.error("Error updating project name:", error);
      toast.error("Erreur lors de la mise à jour du titre");
    }
  };

  const handleCancelEditProject = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };


  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <AppHeader title="Projets" />

      <div className="container py-12 px-4">
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-5xl font-bold tracking-tight mb-4 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Mes Projets
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            Gérez tous vos projets vidéo en un seul endroit
          </p>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="lg">
                <Plus className="h-4 w-4 mr-2" />
                Nouveau projet
              </Button>
            </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] w-[95vw] sm:w-full flex flex-col p-6">
                <div className="overflow-y-auto flex-1 min-h-0">
                <DialogHeader>
                  <DialogTitle>
                    {workflowStep === "upload" && "Créer un nouveau projet"}
                    {workflowStep === "transcription" && "Transcription en cours..."}
                    {workflowStep === "review" && "Transcription terminée"}
                    {workflowStep === "scene-config" && "Configuration des scènes"}
                    {workflowStep === "prompt-config" && "Configuration des prompts"}
                    {workflowStep === "image-config" && "Configuration des images"}
                  </DialogTitle>
                  <DialogDescription>
                    {workflowStep === "upload" && "Importez un fichier audio (MP3 ou WAV) pour créer votre vidéo"}
                    {workflowStep === "transcription" && "Veuillez patienter pendant que nous transcrivons votre audio"}
                    {workflowStep === "review" && "Vérifiez la transcription et continuez vers la configuration"}
                    {workflowStep === "scene-config" && "Définissez les durées de scènes selon le contenu"}
                    {workflowStep === "prompt-config" && "Ajoutez 2-3 exemples de prompts pour guider l'IA"}
                    {workflowStep === "image-config" && "Configurez les dimensions et le style des images"}
                  </DialogDescription>
                </DialogHeader>

                {workflowStep === "upload" && (
                  <div className="space-y-4 py-4">
                    <Input
                      placeholder="Nom du projet"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(sanitizeProjectName(e.target.value))}
                      disabled={isCreating}
                    />
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                        isDraggingAudio ? 'border-primary bg-primary/10' : 'border-muted-foreground/25 hover:border-primary/50'
                      }`}
                      onDragOver={handleAudioDragOver}
                      onDragLeave={handleAudioDragLeave}
                      onDrop={handleAudioDrop}
                    >
                      <Input
                        type="file"
                        accept="audio/mp3,audio/wav,audio/mpeg"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleAudioUpload(file);
                          }
                        }}
                        className="hidden"
                        id="audio-upload-mobile"
                        disabled={isCreating}
                      />
                      <label htmlFor="audio-upload-mobile" className="cursor-pointer">
                        <div className="flex flex-col items-center gap-2">
                          {isCreating ? (
                            <>
                              <Loader2 className="h-8 w-8 animate-spin text-primary" />
                              <p className="text-sm font-medium text-primary">Upload en cours...</p>
                              <p className="text-xs text-muted-foreground">
                                Veuillez patienter pendant l'upload et la transcription
                              </p>
                            </>
                          ) : (
                            <>
                              <Plus className="h-8 w-8 text-muted-foreground" />
                              <p className="text-sm text-muted-foreground">
                                Glissez-déposez ou cliquez pour importer un fichier audio
                              </p>
                              <p className="text-xs text-muted-foreground">
                                MP3 ou WAV
                              </p>
                            </>
                          )}
                        </div>
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setNewProjectName("");
                        }}
                        disabled={isCreating}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "transcription" && (
                  <div className="flex flex-col items-center justify-center py-8 gap-4">
                    <div className="flex items-center gap-2 text-primary">
                      <Cloud className="h-8 w-8" />
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                    <p className="text-sm font-medium">
                      Transcription en cours en arrière-plan...
                    </p>
                    <p className="text-xs text-muted-foreground text-center max-w-sm">
                      Vous pouvez fermer cette fenêtre ou quitter la page. La transcription continuera en arrière-plan et sera disponible quand vous reviendrez.
                    </p>
                    <ActiveJobsBanner 
                      jobs={activeJobs} 
                      onCancel={cancelJob}
                      className="w-full"
                    />
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setIsDialogOpen(false);
                        toast.info("La transcription continue en arrière-plan");
                      }}
                    >
                      Fermer et continuer plus tard
                    </Button>
                  </div>
                )}

                {workflowStep === "review" && transcriptData && (
                  <div className="space-y-4 py-4">
                    <div className="rounded-lg border p-4 max-h-60 overflow-y-auto bg-muted/30">
                      <h3 className="font-semibold mb-2 text-sm">Transcription :</h3>
                      {transcriptData.full_text ? (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {transcriptData.full_text}
                        </p>
                      ) : transcriptData.segments && transcriptData.segments.length > 0 ? (
                        <div className="space-y-2 text-sm">
                          {transcriptData.segments.map((segment: any, index: number) => (
                            <p key={index} className="text-muted-foreground">
                              {segment.text}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          Aucune transcription disponible
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setWorkflowStep("upload");
                          setNewProjectName("");
                          setTranscriptData(null);
                          setCurrentProjectId(null);
                        }}
                      >
                        Annuler
                      </Button>
                      <Button onClick={() => setWorkflowStep("scene-config")}>
                        Continuer la configuration
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "scene-config" && (
                  <div className="space-y-4 py-4">
                    <div className="mb-4">
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
                        }}
                        autoLoadPresetId={sessionStorage.getItem("auto_load_project_preset_id") || undefined}
                        onLoadPreset={(preset) => {
                          // Convert legacy format to durationRanges if needed
                          if (preset.duration_ranges && Array.isArray(preset.duration_ranges)) {
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
                          setSelectedPresetId(preset.id);
                          setStyleReferenceUrls(parseStyleReferenceUrls(preset.style_reference_url));
                          setPromptSystemMessage(preset.prompt_system_message || "");
                          setQaPrompt(preset.qa_prompt || "");
                          setActivePresetName(preset.name);
                          // Clean up sessionStorage after auto-load
                          const wasAutoLoaded = sessionStorage.getItem("auto_load_project_preset_id");
                          sessionStorage.removeItem("auto_load_project_preset_id");
                          // Only show toast for manual loads (PresetManager handles auto-load toast)
                          if (!wasAutoLoaded) {
                            toast.success("Preset chargé !");
                          }
                        }}
                      />
                      {activePresetName && (
                        <div className="mt-3 p-2 bg-primary/10 border border-primary/30 rounded-md">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Preset actif :</span>
                            <span className="font-medium text-primary">{activePresetName}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Format de contenu</Label>
                        <RadioGroup
                          value={sceneFormat}
                          onValueChange={(value) => {
                            const newFormat = value as "long" | "short";
                            setSceneFormat(newFormat);
                            if (newFormat === "short") {
                              setDurationRanges(SHORT_FORM_DURATION_RANGES);
                            } else {
                              setDurationRanges(DEFAULT_DURATION_RANGES);
                            }
                          }}
                        >
                          <div className="flex gap-4">
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="long" id="scene-format-long" />
                              <Label htmlFor="scene-format-long" className="font-normal cursor-pointer">
                                Long form
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="short" id="scene-format-short" />
                              <Label htmlFor="scene-format-short" className="font-normal cursor-pointer">
                                Short form
                              </Label>
                            </div>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="p-4 border rounded-lg bg-muted/30">
                        <DurationRangesEditor
                          ranges={durationRanges}
                          onChange={setDurationRanges}
                          maxEndValue={sceneFormat === "long" ? 600 : 60}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setWorkflowStep("review")}>
                        Précédent
                      </Button>
                      <Button onClick={() => setWorkflowStep("prompt-config")}>
                        Suivant
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "prompt-config" && (
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Prompt système personnalisé (optionnel)</Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Personnalisez les instructions données à l'IA pour générer les prompts
                      </p>
                      <Textarea
                        value={promptSystemMessage}
                        onChange={(e) => setPromptSystemMessage(e.target.value)}
                        placeholder="Ex: Tu es un expert en création de prompts pour la génération d'images. Tu dois créer des prompts détaillés avec un style cinématique..."
                        rows={4}
                        className="font-mono text-sm"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Ajoutez 2-3 exemples de prompts pour que l'IA comprenne le style souhaité
                    </p>
                    {examplePrompts.map((prompt, index) => (
                      <div key={index}>
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
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setWorkflowStep("scene-config")}>
                        Précédent
                      </Button>
                      <Button onClick={() => setWorkflowStep("image-config")}>
                        Suivant
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "image-config" && (
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Modèle de génération</Label>
                      <Select value={imageModel} onValueChange={setImageModel}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="seedream-4">SeedDream 4.0</SelectItem>
                          <SelectItem value="seedream-4.5">SeedDream 4.5</SelectItem>
                          <SelectItem value="ai33-seedream-4.5">SeedDream 4.5 via AI33 Pro</SelectItem>
                          <SelectItem value="seedream-5-lite">SeedDream 5.0 Lite</SelectItem>
                          <SelectItem value="z-image-turbo">Z-Image Turbo (rapide)</SelectItem>
                          <SelectItem value="z-image-turbo-lora">Z-Image Turbo LoRA</SelectItem>
                        </SelectContent>
                      </Select>
                      {imageModel === "z-image-turbo" && styleReferenceUrls.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1">
                          Z-Image Turbo ne supporte pas les images de référence de style
                        </p>
                      )}
                    </div>
                    
                    {/* LoRA configuration for z-image-turbo-lora */}
                    {imageModel === "z-image-turbo-lora" && (
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                        <h4 className="font-medium text-sm">Configuration LoRA</h4>
                        <div className="space-y-2">
                          <Label>URL du LoRA (HuggingFace .safetensors)</Label>
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
                          <Label>Nombre de steps</Label>
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
                      <Label>Aspect Ratio</Label>
                      <Select 
                        value={aspectRatio} 
                        onValueChange={(value) => {
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
                        }}
                      >
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
                      <div>
                        <Label>Largeur (px)</Label>
                        <Input
                          type="number"
                          value={imageWidth}
                          onChange={(e) => setImageWidth(parseInt(e.target.value))}
                          min={512}
                          max={1920}
                        />
                      </div>
                      <div>
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
                    <div>
                      <Label>Images de référence de style (optionnel - max 15)</Label>
                      <div className="border-2 border-dashed rounded-lg p-4">
                        <Input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files && files.length > 0) {
                              handleStyleImageUpload(files);
                            }
                          }}
                          className="hidden"
                          id="style-upload"
                          disabled={isCreating || styleReferenceUrls.length >= 15}
                        />
                        <label htmlFor="style-upload" className={`cursor-pointer block ${styleReferenceUrls.length >= 15 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <div className="flex flex-col items-center gap-2 mb-4">
                            {isCreating ? (
                              <>
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">Upload en cours...</p>
                              </>
                            ) : (
                              <>
                                <Plus className="h-6 w-6 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                  {styleReferenceUrls.length >= 15 
                                    ? "Maximum atteint (15 images)"
                                    : `Cliquez pour uploader des images (${styleReferenceUrls.length}/15)`
                                  }
                                </p>
                              </>
                            )}
                          </div>
                        </label>
                        {styleReferenceUrls.length > 0 && (
                          <div className="grid grid-cols-3 gap-2 mt-4">
                            {styleReferenceUrls.map((url, index) => (
                              <div key={index} className="relative group">
                                <img 
                                  src={url} 
                                  alt={`Style reference ${index + 1}`} 
                                  className="h-20 w-full object-cover rounded border-2 border-border"
                                />
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleRemoveStyleImage(index);
                                  }}
                                  className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  type="button"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Thumbnail preset selector for semi-auto mode */}
                    <div className="space-y-2">
                      <Label>Preset de miniatures (pour le mode semi-automatique)</Label>
                      <Select value={selectedThumbnailPresetId} onValueChange={setSelectedThumbnailPresetId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un preset de miniatures..." />
                        </SelectTrigger>
                        <SelectContent>
                          {thumbnailPresets.length === 0 ? (
                            <SelectItem value="none" disabled>Aucun preset disponible</SelectItem>
                          ) : (
                            thumbnailPresets.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>
                                {preset.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Requis si le mode semi-automatique est activé pour générer les miniatures
                      </p>
                    </div>

                    {/* Semi-automatic mode option */}
                    <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id="semi-auto-mode-projects"
                          checked={semiAutoMode}
                          onChange={(e) => setSemiAutoMode(e.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <div className="flex-1">
                          <label htmlFor="semi-auto-mode-projects" className="font-medium cursor-pointer block">
                            Mode semi-automatique
                          </label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Génère automatiquement tous les prompts, images et miniatures sans intervention manuelle après la configuration.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setWorkflowStep("prompt-config")}>
                        Précédent
                      </Button>
                      <Button onClick={handleFinalizeConfiguration} disabled={isCreating}>
                        {isCreating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Création du projet...
                          </>
                        ) : (
                          "Créer le projet"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

        {!isLoading && projects.length > 0 && (
          <div className="flex items-center justify-between max-w-6xl mx-auto mb-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Afficher</span>
              {[10, 25, 50, 0].map((size) => (
                <button
                  key={size}
                  onClick={() => handlePageSizeChange(size)}
                  className={`px-2 py-1 rounded transition-colors ${
                    pageSize === size
                      ? "bg-primary text-primary-foreground font-medium"
                      : "hover:bg-muted"
                  }`}
                >
                  {size === 0 ? "Tout" : size}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleViewMode}
              className="h-9 w-9"
              title={viewMode === "list" ? "Vue grille" : "Vue liste"}
            >
              {viewMode === "list" ? (
                <LayoutGrid className="h-5 w-5 text-muted-foreground" />
              ) : (
                <LayoutList className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : projects.length === 0 ? (
          <Card className="p-12 text-center max-w-2xl mx-auto bg-card/50 backdrop-blur">
            <p className="text-muted-foreground mb-6 text-lg">Aucun projet pour le moment</p>
            <Button size="lg" onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Créer votre premier projet
            </Button>
          </Card>
        ) : (
          viewMode === "list" ? (
            <div className="max-w-6xl mx-auto">
              <div className="hidden sm:grid grid-cols-[1fr_80px_80px_120px_140px_72px] gap-4 px-5 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider sticky top-[65px] bg-background/95 backdrop-blur-sm z-30 border-b mb-1">
                <button
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-1 hover:text-foreground transition-colors text-left"
                >
                  Projet
                  {sortColumn === "name" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  )}
                </button>
                <span className="text-center">Scènes</span>
                <span className="text-center">Prompts</span>
                <button
                  onClick={() => handleSort("scheduled_date")}
                  className="flex items-center justify-center gap-1 hover:text-foreground transition-colors"
                >
                  Prévu le
                  {sortColumn === "scheduled_date" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  )}
                </button>
                <button
                  onClick={() => handleSort("updated_at")}
                  className="flex items-center justify-center gap-1 hover:text-foreground transition-colors"
                >
                  Modifié le
                  {sortColumn === "updated_at" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  )}
                </button>
                <span></span>
              </div>
              <div className="flex flex-col gap-1">
                {projects.map((project) => (
                  <Card
                    key={project.id}
                    className="group cursor-pointer hover:shadow-md transition-all duration-200 border hover:border-primary/50 bg-card/50 backdrop-blur"
                    onClick={() => navigate(`/project?project=${project.id}`)}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_80px_80px_120px_140px_72px] items-center gap-4 px-5 py-3">
                      {editingProjectId === project.id ? (
                        <div className="flex items-center gap-2 min-w-0" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(sanitizeProjectName(e.target.value))}
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveProjectName(e as any);
                              if (e.key === "Escape") handleCancelEditProject(e as any);
                            }}
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveProjectName}>
                            <Check className="h-4 w-4 text-green-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCancelEditProject}>
                            <X className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <h3 className="text-base font-semibold truncate group-hover:text-primary transition-colors min-w-0">
                          {project.name}
                        </h3>
                      )}

                      <span className="hidden sm:block text-sm text-muted-foreground text-center">
                        {project.scene_count}
                      </span>
                      <span className="hidden sm:block text-sm text-muted-foreground text-center">
                        {project.prompt_count}
                      </span>
                      <span className="hidden sm:flex items-center justify-center text-sm">
                        {project.scheduled_date ? (
                          <span className="flex items-center gap-1.5 text-primary">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(project.scheduled_date).toLocaleDateString("fr-FR", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </span>
                      <span className="hidden sm:block text-xs text-muted-foreground/70 text-center">
                        {formatDate(project.updated_at)}
                      </span>

                      <div className="flex items-center justify-end gap-1 shrink-0">
                        {editingProjectId !== project.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => handleStartEditProject(e, project.id, project.name)}
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(project.id, project.name);
                          }}
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
              {projects.map((project) => (
                <Card
                  key={project.id}
                  className="group cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-105 border-2 hover:border-primary/50 bg-card/50 backdrop-blur"
                  onClick={() => navigate(`/project?project=${project.id}`)}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4 gap-2">
                      {editingProjectId === project.id ? (
                        <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(sanitizeProjectName(e.target.value))}
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveProjectName(e as any);
                              if (e.key === "Escape") handleCancelEditProject(e as any);
                            }}
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSaveProjectName}>
                            <Check className="h-4 w-4 text-green-500" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCancelEditProject}>
                            <X className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <h3 className="text-xl font-bold truncate group-hover:text-primary transition-colors flex-1">
                            {project.name}
                          </h3>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => handleStartEditProject(e, project.id, project.name)}
                            className="hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id, project.name);
                        }}
                        className="hover:bg-destructive/10 shrink-0"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Scènes:</span>
                        <span className="font-medium">{project.scene_count}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Prompts:</span>
                        <span className="font-medium">{project.prompt_count}</span>
                      </div>
                      {project.scheduled_date && (
                        <div className="flex items-center gap-2 text-primary">
                          <Calendar className="h-4 w-4" />
                          <span className="text-sm font-medium">
                            Prévu le {new Date(project.scheduled_date).toLocaleDateString("fr-FR", {
                              day: "numeric",
                              month: "short",
                              year: "numeric"
                            })}
                          </span>
                        </div>
                      )}
                      <div className="pt-2 mt-2 border-t">
                        <div className="text-xs">
                          Modifié le {formatDate(project.updated_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}

        {!isLoading && totalCount > 0 && totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-6 max-w-6xl mx-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Précédent
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentPage + 1} / {totalPages}
              <span className="ml-2 text-xs text-muted-foreground/60">
                ({totalCount} projets)
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              Suivant
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        <OnboardingDialog
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
        />
      </div>
    </div>
  );
};

export default Projects;
