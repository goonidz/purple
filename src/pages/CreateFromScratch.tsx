import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Sparkles, FileText, Mic, ArrowRight, Check, RefreshCw, ChevronDown, Save, Trash2, FolderOpen, Pencil, Copy } from "lucide-react";
import { toast } from "sonner";

type WorkflowStep = "topic" | "axes" | "script" | "audio" | "complete";

interface VideoAxe {
  id: number;
  title: string;
  description: string;
}

interface ScriptPreset {
  id: string;
  name: string;
  custom_prompt: string | null;
  duration: string;
  style: string;
  language: string;
}

const VOICE_OPTIONS = [
  { id: "daniel", name: "Daniel", language: "fr" },
  { id: "charlotte", name: "Charlotte", language: "fr" },
  { id: "aria", name: "Aria", language: "en" },
  { id: "roger", name: "Roger", language: "en" },
  { id: "sarah", name: "Sarah", language: "en" },
  { id: "charlie", name: "Charlie", language: "en" },
  { id: "george", name: "George", language: "en" },
  { id: "brian", name: "Brian", language: "en" },
];


const DEFAULT_PROMPT = `Tu es un scénariste professionnel pour vidéos YouTube. Tu écris des scripts captivants et optimisés pour la narration vocale.

RÈGLES IMPORTANTES:
- Écris UNIQUEMENT le texte qui sera lu à voix haute
- PAS de directions de scène, PAS de [crochets], PAS d'annotations
- Utilise un langage naturel et fluide pour la narration
- Inclus des pauses naturelles avec des phrases courtes
- Commence par un hook accrocheur
- Termine par un appel à l'action ou une conclusion mémorable`;

const CreateFromScratch = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState<WorkflowStep>("topic");
  
  // Topic step
  const [projectName, setProjectName] = useState("");
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_PROMPT);
  const [isPromptOpen, setIsPromptOpen] = useState(true);
  
  // Preset management
  const [presets, setPresets] = useState<ScriptPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [savePresetDialogOpen, setSavePresetDialogOpen] = useState(false);
  const [editPresetDialogOpen, setEditPresetDialogOpen] = useState(false);
  const [duplicatePresetDialogOpen, setDuplicatePresetDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [editPresetName, setEditPresetName] = useState("");
  const [editPresetPrompt, setEditPresetPrompt] = useState("");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetPopoverOpen, setPresetPopoverOpen] = useState(false);
  
  // Script step
  const [generatedScript, setGeneratedScript] = useState("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [estimatedDuration, setEstimatedDuration] = useState(0);
  
  // Audio step
  const [selectedVoice, setSelectedVoice] = useState("daniel");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  
  // Axes step
  const [videoAxes, setVideoAxes] = useState<VideoAxe[]>([]);
  const [isGeneratingAxes, setIsGeneratingAxes] = useState(false);
  const [selectedAxe, setSelectedAxe] = useState<VideoAxe | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Check authentication and load continued project if any
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      } else {
        loadPresets();
        
        // Check if continuing an existing project
        const continueProjectId = searchParams.get("continue");
        if (continueProjectId) {
          loadExistingProject(continueProjectId);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, searchParams]);

  // Load existing project with script (continue workflow)
  const loadExistingProject = async (projectIdToLoad: string) => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, summary")
        .eq("id", projectIdToLoad)
        .single();

      if (error) throw error;

      if (data && data.summary) {
        setProjectId(data.id);
        setProjectName(data.name || "");
        setGeneratedScript(data.summary);
        setWordCount(data.summary.split(/\s+/).length);
        setEstimatedDuration(Math.round(data.summary.split(/\s+/).length / 2.5));
        setStep("script");
        toast.success("Script récupéré ! Continuez avec la génération audio.");
      }
    } catch (error) {
      console.error("Error loading existing project:", error);
      toast.error("Erreur lors du chargement du projet");
    }
  };

  const loadPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("script_presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      setPresets(data || []);
    } catch (error) {
      console.error("Error loading presets:", error);
    }
  };

  const handleLoadPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setCustomPrompt(preset.custom_prompt || DEFAULT_PROMPT);
      setSelectedPresetId(presetId);
      toast.success(`Preset "${preset.name}" chargé`);
    }
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    setIsSavingPreset(true);
    try {
      const { error } = await supabase
        .from("script_presets")
        .insert([{
          user_id: user!.id,
          name: newPresetName.trim(),
          custom_prompt: customPrompt
        }]);

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setSavePresetDialogOpen(false);
      setNewPresetName("");
      loadPresets();
    } catch (error: any) {
      console.error("Error saving preset:", error);
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return;

    try {
      const { error } = await supabase
        .from("script_presets")
        .delete()
        .eq("id", presetId);

      if (error) throw error;

      toast.success("Preset supprimé");
      if (selectedPresetId === presetId) {
        setSelectedPresetId("");
      }
      loadPresets();
    } catch (error: any) {
      console.error("Error deleting preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleOpenEditPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setEditingPresetId(presetId);
    setEditPresetName(preset.name);
    setEditPresetPrompt(preset.custom_prompt || DEFAULT_PROMPT);
    setEditPresetDialogOpen(true);
  };

  const handleUpdatePreset = async () => {
    if (!editingPresetId || !editPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    setIsSavingPreset(true);
    try {
      const { error } = await supabase
        .from("script_presets")
        .update({
          name: editPresetName.trim(),
          custom_prompt: editPresetPrompt
        })
        .eq("id", editingPresetId);

      if (error) throw error;

      toast.success("Preset mis à jour !");
      setEditPresetDialogOpen(false);
      setEditingPresetId(null);
      loadPresets();
      
      // Reload current prompt if this preset is selected
      if (selectedPresetId === editingPresetId) {
        setCustomPrompt(editPresetPrompt);
      }
    } catch (error: any) {
      console.error("Error updating preset:", error);
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleOpenDuplicatePreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setEditingPresetId(presetId);
    setNewPresetName(`${preset.name} (copie)`);
    setDuplicatePresetDialogOpen(true);
  };

  const handleDuplicatePreset = async () => {
    if (!editingPresetId || !newPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    const preset = presets.find(p => p.id === editingPresetId);
    if (!preset) return;

    setIsSavingPreset(true);
    try {
      const { error } = await supabase
        .from("script_presets")
        .insert([{
          user_id: user!.id,
          name: newPresetName.trim(),
          custom_prompt: preset.custom_prompt
        }]);

      if (error) throw error;

      toast.success("Preset dupliqué !");
      setDuplicatePresetDialogOpen(false);
      setEditingPresetId(null);
      setNewPresetName("");
      loadPresets();
    } catch (error: any) {
      console.error("Error duplicating preset:", error);
      toast.error("Erreur lors de la duplication");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const GENERATION_MESSAGES = [
    "Analyse du prompt...",
    "Claude réfléchit à la structure...",
    "Rédaction de l'introduction...",
    "Développement du contenu principal...",
    "Création des transitions...",
    "Rédaction de la conclusion...",
    "Optimisation du script...",
    "Finalisation en cours...",
  ];

  // Job polling for script generation
  const [scriptJobId, setScriptJobId] = useState<string | null>(null);

  // Poll for script job completion
  useEffect(() => {
    if (!scriptJobId || !isGeneratingScript) return;

    const pollInterval = setInterval(async () => {
      try {
        const { data: jobs, error } = await supabase
          .from('generation_jobs')
          .select('*')
          .eq('id', scriptJobId)
          .single();

        if (error) {
          console.error("Error polling job:", error);
          return;
        }

        if (jobs.status === 'completed') {
          clearInterval(pollInterval);
          setIsGeneratingScript(false);
          setGenerationProgress(100);
          setGenerationMessage("Script terminé !");

          // Get script from job metadata
          const metadata = jobs.metadata as any;
          if (metadata?.script) {
            setGeneratedScript(metadata.script);
            setWordCount(metadata.wordCount || 0);
            setEstimatedDuration(metadata.estimatedDuration || 0);
            setStep("script");
            toast.success("Script généré avec succès !");
          }
          setScriptJobId(null);
        } else if (jobs.status === 'failed') {
          clearInterval(pollInterval);
          setIsGeneratingScript(false);
          setScriptJobId(null);
          toast.error(jobs.error_message || "Erreur lors de la génération du script");
        } else {
          // Update progress message based on time elapsed
          setGenerationProgress(prev => Math.min(prev + 2, 85));
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [scriptJobId, isGeneratingScript]);

  // Generate video axes via Gemini
  const handleGenerateAxes = async () => {
    if (!customPrompt.trim()) {
      toast.error("Veuillez entrer un prompt");
      return;
    }

    if (!projectName.trim()) {
      toast.error("Veuillez entrer un nom de projet");
      return;
    }

    setIsGeneratingAxes(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-video-axes', {
        body: { customPrompt }
      });

      if (error) throw error;

      if (data.axes && Array.isArray(data.axes)) {
        setVideoAxes(data.axes);
        setStep("axes");
      } else {
        throw new Error("Format de réponse invalide");
      }
    } catch (error: any) {
      console.error("Error generating axes:", error);
      toast.error(error.message || "Erreur lors de la génération des axes");
    } finally {
      setIsGeneratingAxes(false);
    }
  };

  // Handle axe selection and proceed to script generation
  const handleSelectAxe = async (axe: VideoAxe) => {
    setSelectedAxe(axe);
    
    // Combine the original prompt with the selected thesis
    const enhancedPrompt = `${customPrompt}

THÈSE CHOISIE POUR LA VIDÉO:
"${axe.title}"

Direction du script: ${axe.description}

Génère un script qui défend et développe cette thèse spécifique. Le script doit être cohérent avec la direction indiquée.`;
    
    // Now generate the script with the enhanced prompt
    await generateScriptWithPrompt(enhancedPrompt);
  };

  const generateScriptWithPrompt = async (promptToUse: string) => {
    setIsGeneratingScript(true);
    setGenerationProgress(0);
    setGenerationMessage(GENERATION_MESSAGES[0]);

    // Progress animation - slower updates every 8 seconds
    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        const newProgress = Math.min(prev + Math.random() * 4, 80);
        const messageIndex = Math.min(
          Math.floor(newProgress / 12),
          GENERATION_MESSAGES.length - 1
        );
        setGenerationMessage(GENERATION_MESSAGES[messageIndex]);
        return newProgress;
      });
    }, 8000);

    try {
      // Create a temporary project just for the job (will be updated later)
      const tempProjectName = projectName.trim() || `Script-${Date.now()}`;
      
      const { data: tempProject, error: projectError } = await supabase
        .from("projects")
        .insert([{
          user_id: user!.id,
          name: tempProjectName,
        }])
        .select()
        .single();

      if (projectError) throw projectError;
      
      setProjectId(tempProject.id);

      // Start the script generation job via backend
      const { data, error } = await supabase.functions.invoke('start-generation-job', {
        body: {
          projectId: tempProject.id,
          jobType: 'script_generation',
          metadata: {
            customPrompt: promptToUse
          }
        }
      });

      clearInterval(progressInterval);

      if (error) throw error;

      if (data.jobId) {
        setScriptJobId(data.jobId);
        setStep("script");
        toast.info("Génération du script en cours... Vous pouvez quitter cette page, le script sera sauvegardé.");
      } else {
        throw new Error("Pas de job ID reçu");
      }
    } catch (error: any) {
      console.error("Error starting script generation:", error);
      clearInterval(progressInterval);
      setIsGeneratingScript(false);
      toast.error(error.message || "Erreur lors du lancement de la génération");
    }
  };

  const handleGenerateScript = async () => {
    if (!customPrompt.trim()) {
      toast.error("Veuillez entrer un prompt");
      return;
    }
    await generateScriptWithPrompt(customPrompt);
  };

  const handleRegenerateScript = async () => {
    if (!projectId) {
      toast.error("Erreur: projet non trouvé");
      return;
    }

    setIsGeneratingScript(true);
    setGenerationProgress(0);
    setGenerationMessage("Régénération en cours...");

    try {
      // Start the script generation job via backend
      const { data, error } = await supabase.functions.invoke('start-generation-job', {
        body: {
          projectId,
          jobType: 'script_generation',
          metadata: {
            customPrompt
          }
        }
      });

      if (error) throw error;

      if (data.jobId) {
        setScriptJobId(data.jobId);
        toast.info("Régénération du script en cours...");
      } else {
        throw new Error("Pas de job ID reçu");
      }
    } catch (error: any) {
      console.error("Error regenerating script:", error);
      setIsGeneratingScript(false);
      toast.error(error.message || "Erreur lors de la régénération");
    }
  };

  const handleGenerateAudio = async () => {
    if (!generatedScript.trim()) {
      toast.error("Le script est vide");
      return;
    }

    if (!projectName.trim()) {
      toast.error("Veuillez entrer un nom de projet");
      return;
    }

    if (!projectId) {
      toast.error("Erreur: projet non trouvé");
      return;
    }

    setIsGeneratingAudio(true);
    try {
      // Update project name if changed
      await supabase
        .from("projects")
        .update({ name: projectName.trim() })
        .eq("id", projectId);

      // Generate audio
      const { data, error } = await supabase.functions.invoke('generate-audio-tts', {
        body: {
          script: generatedScript,
          voice: selectedVoice,
          projectId
        }
      });

      if (error) throw error;

      // Update project with audio URL
      await supabase
        .from("projects")
        .update({ audio_url: data.audioUrl })
        .eq("id", projectId);

      setAudioUrl(data.audioUrl);
      setStep("audio");
      toast.success("Audio généré avec succès !");
    } catch (error: any) {
      console.error("Error generating audio:", error);
      toast.error(error.message || "Erreur lors de la génération audio");
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleContinueToVideo = () => {
    if (!projectId) {
      toast.error("Erreur: projet non trouvé");
      return;
    }
    
    // Navigate to projects page to continue with transcription workflow
    navigate(`/projects?from_scratch=true&project=${projectId}`);
  };

  const handleLoadDefaultPrompt = () => {
    setCustomPrompt(DEFAULT_PROMPT);
    toast.success("Prompt par défaut chargé");
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
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              VidéoFlow
            </span>
          </Link>
          <div className="text-sm text-muted-foreground">
            Créer de zéro
          </div>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="container py-6">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className={`flex items-center gap-2 ${step === "topic" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "topic" ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary"}`}>
              {step !== "topic" ? <Check className="h-4 w-4" /> : "1"}
            </div>
            <span className="font-medium hidden sm:inline">Sujet</span>
          </div>
          <div className="w-8 h-0.5 bg-muted" />
          <div className={`flex items-center gap-2 ${step === "axes" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "axes" ? "bg-primary text-primary-foreground" : step === "script" || step === "audio" || step === "complete" ? "bg-primary/20 text-primary" : "bg-muted"}`}>
              {step === "script" || step === "audio" || step === "complete" ? <Check className="h-4 w-4" /> : "2"}
            </div>
            <span className="font-medium hidden sm:inline">Thèse</span>
          </div>
          <div className="w-8 h-0.5 bg-muted" />
          <div className={`flex items-center gap-2 ${step === "script" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "script" ? "bg-primary text-primary-foreground" : step === "audio" || step === "complete" ? "bg-primary/20 text-primary" : "bg-muted"}`}>
              {step === "audio" || step === "complete" ? <Check className="h-4 w-4" /> : "3"}
            </div>
            <span className="font-medium hidden sm:inline">Script</span>
          </div>
          <div className="w-8 h-0.5 bg-muted" />
          <div className={`flex items-center gap-2 ${step === "audio" || step === "complete" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "audio" || step === "complete" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {step === "complete" ? <Check className="h-4 w-4" /> : "4"}
            </div>
            <span className="font-medium hidden sm:inline">Audio</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="max-w-3xl mx-auto">
          {step === "topic" && (
            <Card className="p-8">
              <div className="space-y-6">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold mb-2">Définissez votre vidéo</h2>
                  <p className="text-muted-foreground">
                    Claude IA va générer un script professionnel basé sur votre sujet
                  </p>
                </div>

                {/* Preset selector */}
                <div className="space-y-2">
                  <Label>Charger un preset</Label>
                  <Popover open={presetPopoverOpen} onOpenChange={setPresetPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        {selectedPresetId 
                          ? presets.find(p => p.id === selectedPresetId)?.name 
                          : "Sélectionner un preset..."}
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-lg overflow-hidden" align="start">
                      {presets.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                          Aucun preset sauvegardé
                        </div>
                      ) : (
                        <div className="max-h-[300px] overflow-auto">
                          {presets.map((preset) => (
                            <div 
                              key={preset.id}
                              className={`flex items-center justify-between px-3 py-2 hover:bg-accent cursor-pointer group ${
                                selectedPresetId === preset.id ? "bg-accent" : ""
                              }`}
                            >
                              <span 
                                className="flex-1 truncate"
                                onClick={() => {
                                  handleLoadPreset(preset.id);
                                  setPresetPopoverOpen(false);
                                }}
                              >
                                {preset.name}
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEditPreset(preset.id);
                                  }}
                                  title="Modifier"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenDuplicatePreset(preset.id);
                                  }}
                                  title="Dupliquer"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeletePreset(preset.id);
                                  }}
                                  title="Supprimer"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="projectName">Nom du projet *</Label>
                    <Input
                      id="projectName"
                      placeholder="Ma super vidéo..."
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                    />
                  </div>


                  {/* Custom Prompt Section */}
                  <Collapsible open={isPromptOpen} onOpenChange={setIsPromptOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Prompt personnalisé
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${isPromptOpen ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-3">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={handleLoadDefaultPrompt}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Réinitialiser
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setSavePresetDialogOpen(true)}
                        >
                          <Save className="h-3 w-3 mr-1" />
                          Sauvegarder preset
                        </Button>
                      </div>
                      <Textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        className="min-h-[200px] font-mono text-sm"
                        placeholder="Instructions pour Claude IA..."
                      />
                      <p className="text-xs text-muted-foreground">
                        Ce prompt sera envoyé à Claude IA pour générer le script. Incluez tous les détails: sujet, durée, style, langue, etc.
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                {isGeneratingAxes ? (
                  <div className="w-full space-y-4 p-6 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div className="flex-1">
                        <p className="font-medium">Gemini analyse votre sujet...</p>
                        <p className="text-sm text-muted-foreground">
                          Génération des axes en cours
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button 
                    onClick={handleGenerateAxes} 
                    disabled={!customPrompt.trim() || !projectName.trim()}
                    className="w-full"
                    size="lg"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Proposer des thèses avec Gemini
                  </Button>
                )}
              </div>
            </Card>
          )}

          {step === "axes" && (
            <Card className="p-8">
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold mb-2">Choisissez une thèse</h2>
                  <p className="text-muted-foreground">
                    Sélectionnez l'argument principal et la direction du script
                  </p>
                </div>

                {isGeneratingScript ? (
                  <div className="w-full space-y-4 p-6 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div className="flex-1">
                        <p className="font-medium">{generationMessage}</p>
                        <p className="text-sm text-muted-foreground">
                          La génération peut prendre 3-4 minutes pour un script long
                        </p>
                      </div>
                    </div>
                    <Progress value={generationProgress} className="h-2" />
                    <p className="text-xs text-center text-muted-foreground">
                      {Math.round(generationProgress)}% complété
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {videoAxes.map((axe) => (
                      <button
                        key={axe.id}
                        onClick={() => handleSelectAxe(axe)}
                        className={`p-4 rounded-lg border text-left transition-all hover:border-primary hover:bg-primary/5 ${
                          selectedAxe?.id === axe.id ? "border-primary bg-primary/10" : "border-border"
                        }`}
                      >
                        <h3 className="font-semibold text-lg mb-1">{axe.title}</h3>
                        <p className="text-muted-foreground text-sm">{axe.description}</p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-4">
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setStep("topic");
                      setVideoAxes([]);
                      setSelectedAxe(null);
                    }}
                    className="flex-1"
                    disabled={isGeneratingScript}
                  >
                    Retour
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={handleGenerateAxes}
                    className="flex-1"
                    disabled={isGeneratingScript}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Régénérer les thèses
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {step === "script" && (
            <Card className="p-8">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Votre script</h2>
                    <p className="text-muted-foreground">
                      {wordCount} mots • ~{estimatedDuration}s de lecture
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={handleRegenerateScript}
                    disabled={isGeneratingScript}
                  >
                    {isGeneratingScript ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Régénérer
                  </Button>
                </div>

                <Textarea
                  value={generatedScript}
                  onChange={(e) => {
                    setGeneratedScript(e.target.value);
                    setWordCount(e.target.value.split(/\s+/).filter(w => w).length);
                  }}
                  className="min-h-[300px] font-mono text-sm"
                  placeholder="Le script apparaîtra ici..."
                />

                <div className="space-y-4">
                  <Label>Voix pour l'audio</Label>
                  <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VOICE_OPTIONS.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>
                          {voice.name} ({voice.language.toUpperCase()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-4">
                  <Button 
                    variant="outline"
                    onClick={() => setStep("topic")}
                    className="flex-1"
                  >
                    Retour
                  </Button>
                  <Button 
                    onClick={handleGenerateAudio} 
                    disabled={isGeneratingAudio || !generatedScript.trim()}
                    className="flex-1"
                    size="lg"
                  >
                    {isGeneratingAudio ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Génération audio...
                      </>
                    ) : (
                      <>
                        <Mic className="mr-2 h-4 w-4" />
                        Générer l'audio avec ElevenLabs
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {step === "audio" && (
            <Card className="p-8">
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="h-8 w-8 text-green-500" />
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Audio généré !</h2>
                  <p className="text-muted-foreground">
                    Votre audio a été créé avec succès. Écoutez-le ci-dessous.
                  </p>
                </div>

                {audioUrl && (
                  <div className="p-4 bg-muted rounded-lg">
                    <audio controls className="w-full">
                      <source src={audioUrl} type="audio/mpeg" />
                      Votre navigateur ne supporte pas l'audio.
                    </audio>
                  </div>
                )}

                <div className="bg-primary/5 rounded-lg p-4">
                  <h3 className="font-semibold mb-2">Prochaine étape</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    L'audio va être transcrit pour créer les scènes, puis vous pourrez configurer les paramètres d'image et générer votre vidéo complète.
                  </p>
                </div>

                <Button 
                  onClick={handleContinueToVideo}
                  className="w-full"
                  size="lg"
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Continuer vers la création vidéo
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={savePresetDialogOpen} onOpenChange={setSavePresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sauvegarder le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="presetName">Nom du preset</Label>
              <Input
                id="presetName"
                placeholder="Mon style de script..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Ce preset sauvegardera le prompt personnalisé.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavePresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSavePreset} disabled={isSavingPreset || !newPresetName.trim()}>
              {isSavingPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Sauvegarder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Preset Dialog */}
      <Dialog open={editPresetDialogOpen} onOpenChange={setEditPresetDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modifier le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editPresetName">Nom du preset</Label>
              <Input
                id="editPresetName"
                placeholder="Mon style de script..."
                value={editPresetName}
                onChange={(e) => setEditPresetName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editPresetPrompt">Prompt personnalisé</Label>
              <Textarea
                id="editPresetPrompt"
                value={editPresetPrompt}
                onChange={(e) => setEditPresetPrompt(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
                placeholder="Instructions pour Claude IA..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleUpdatePreset} disabled={isSavingPreset || !editPresetName.trim()}>
              {isSavingPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Preset Dialog */}
      <Dialog open={duplicatePresetDialogOpen} onOpenChange={setDuplicatePresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dupliquer le preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="duplicatePresetName">Nom du nouveau preset</Label>
              <Input
                id="duplicatePresetName"
                placeholder="Mon style de script (copie)..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicatePresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleDuplicatePreset} disabled={isSavingPreset || !newPresetName.trim()}>
              {isSavingPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              Dupliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateFromScratch;
