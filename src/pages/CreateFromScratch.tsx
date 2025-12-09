import { useState, useEffect, useRef } from "react";
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
import { Loader2, Sparkles, FileText, Mic, ArrowRight, Check, RefreshCw, ChevronDown, Save, Trash2, FolderOpen, Pencil, Copy, User as UserIcon, Upload, X, ClipboardCopy, ExternalLink } from "lucide-react";
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

interface TtsPreset {
  id: string;
  name: string;
  provider: string;
  voice_id: string;
  model: string | null;
  speed: number;
  pitch: number;
  volume: number;
  language_boost: string;
  english_normalization: boolean;
  emotion: string;
}

const MINIMAX_EMOTIONS = [
  { id: "neutral", name: "Neutre" },
  { id: "happy", name: "Joyeux" },
  { id: "sad", name: "Triste" },
  { id: "angry", name: "En colère" },
  { id: "fearful", name: "Effrayé" },
  { id: "disgusted", name: "Dégoûté" },
  { id: "surprised", name: "Surpris" },
];

// ElevenLabs removed - MiniMax only

// Official MiniMax voice IDs from API documentation
const MINIMAX_VOICE_OPTIONS = [
  // English voices - Format: Language_VoiceName (as per MiniMax API docs)
  { id: "English_Expressive_Narrator", name: "Expressive Narrator", language: "en" },
  { id: "English_Insightful_Speaker", name: "Insightful Speaker", language: "en" },
  { id: "English_Wise_Woman", name: "Wise Woman", language: "en" },
  { id: "English_radiant_girl", name: "Radiant Girl", language: "en" },
  { id: "English_magnetic_voiced_man", name: "Magnetic-voiced Male", language: "en" },
  { id: "English_compelling_lady1", name: "Compelling Lady", language: "en" },
  { id: "English_Aussie_Bloke", name: "Aussie Bloke", language: "en" },
  { id: "English_captivating_female1", name: "Captivating Female", language: "en" },
  { id: "English_Upbeat_Woman", name: "Upbeat Woman", language: "en" },
  { id: "English_Trustworth_Man", name: "Trustworthy Man", language: "en" },
  { id: "English_CalmWoman", name: "Calm Woman", language: "en" },
  { id: "English_UpsetGirl", name: "Upset Girl", language: "en" },
  { id: "English_Gentle-voiced_man", name: "Gentle-voiced Man", language: "en" },
  { id: "English_Whispering_girl", name: "Whispering Girl", language: "en" },
  { id: "English_Diligent_Man", name: "Diligent Man", language: "en" },
  { id: "English_Graceful_Lady", name: "Graceful Lady", language: "en" },
  { id: "English_ReservedYoungMan", name: "Reserved Young Man", language: "en" },
  { id: "English_PlayfulGirl", name: "Playful Girl", language: "en" },
  { id: "English_ManWithDeepVoice", name: "Man With Deep Voice", language: "en" },
  { id: "English_MaturePartner", name: "Mature Partner", language: "en" },
  { id: "English_FriendlyPerson", name: "Friendly Guy", language: "en" },
  { id: "English_MatureBoss", name: "Bossy Lady", language: "en" },
  { id: "English_Debator", name: "Male Debater", language: "en" },
  { id: "English_LovelyGirl", name: "Lovely Girl", language: "en" },
  { id: "English_Steadymentor", name: "Reliable Man", language: "en" },
  { id: "English_Deep-VoicedGentleman", name: "Deep-voiced Gentleman", language: "en" },
  { id: "English_Wiselady", name: "Wise Lady", language: "en" },
  { id: "English_CaptivatingStoryteller", name: "Captivating Storyteller", language: "en" },
  { id: "English_DecentYoungMan", name: "Decent Young Man", language: "en" },
  { id: "English_SentimentalLady", name: "Sentimental Lady", language: "en" },
  { id: "English_ImposingManner", name: "Imposing Queen", language: "en" },
  { id: "English_PassionateWarrior", name: "Passionate Warrior", language: "en" },
  { id: "English_WiseScholar", name: "Wise Scholar", language: "en" },
  { id: "English_Soft-spokenGirl", name: "Soft-Spoken Girl", language: "en" },
  { id: "English_SereneWoman", name: "Serene Woman", language: "en" },
  { id: "English_ConfidentWoman", name: "Confident Woman", language: "en" },
  { id: "English_PatientMan", name: "Patient Man", language: "en" },
  { id: "English_Comedian", name: "Comedian", language: "en" },
  { id: "English_BossyLeader", name: "Bossy Leader", language: "en" },
  { id: "English_Jovialman", name: "Jovial Man", language: "en" },
  { id: "English_WhimsicalGirl", name: "Whimsical Girl", language: "en" },
  { id: "English_Kind-heartedGirl", name: "Kind-Hearted Girl", language: "en" },
  { id: "English_AnimeCharacter", name: "Female Narrator", language: "en" },
  // French voices
  { id: "French_Male_Speech_New", name: "Level-Headed Man", language: "fr" },
  { id: "French_Female_News Anchor", name: "Patient Female Presenter", language: "fr" },
  { id: "French_CasualMan", name: "Casual Man", language: "fr" },
  { id: "French_MovieLeadFemale", name: "Movie Lead Female", language: "fr" },
  { id: "French_FemaleAnchor", name: "Female Anchor", language: "fr" },
  { id: "French_MaleNarrator", name: "Male Narrator", language: "fr" },
  // Spanish voices
  { id: "Spanish_SereneWoman", name: "Serene Woman", language: "es" },
  { id: "Spanish_MaturePartner", name: "Mature Partner", language: "es" },
  { id: "Spanish_CaptivatingStoryteller", name: "Captivating Storyteller", language: "es" },
  { id: "Spanish_Narrator", name: "Narrator", language: "es" },
  { id: "Spanish_WiseScholar", name: "Wise Scholar", language: "es" },
  { id: "Spanish_Kind-heartedGirl", name: "Kind-hearted Girl", language: "es" },
  { id: "Spanish_DeterminedManager", name: "Determined Manager", language: "es" },
  { id: "Spanish_BossyLeader", name: "Bossy Leader", language: "es" },
  { id: "Spanish_ConfidentWoman", name: "Confident Woman", language: "es" },
  { id: "Spanish_Comedian", name: "Comedian", language: "es" },
  // German voices
  { id: "German_FriendlyMan", name: "Friendly Man", language: "de" },
  { id: "German_SweetLady", name: "Sweet Lady", language: "de" },
  { id: "German_PlayfulMan", name: "Playful Man", language: "de" },
  // Italian voices
  { id: "Italian_BraveHeroine", name: "Brave Heroine", language: "it" },
  { id: "Italian_Narrator", name: "Narrator", language: "it" },
  { id: "Italian_WanderingSorcerer", name: "Wandering Sorcerer", language: "it" },
  { id: "Italian_DiligentLeader", name: "Diligent Leader", language: "it" },
  // Portuguese voices
  { id: "Portuguese_SentimentalLady", name: "Sentimental Lady", language: "pt" },
  { id: "Portuguese_BossyLeader", name: "Bossy Leader", language: "pt" },
  { id: "Portuguese_CaptivatingStoryteller", name: "Captivating Storyteller", language: "pt" },
  { id: "Portuguese_Narrator", name: "Narrator", language: "pt" },
  { id: "Portuguese_Comedian", name: "Comedian", language: "pt" },
  // Japanese voices
  { id: "Japanese_IntellectualSenior", name: "Intellectual Senior", language: "ja" },
  { id: "Japanese_DecisivePrincess", name: "Decisive Princess", language: "ja" },
  { id: "Japanese_LoyalKnight", name: "Loyal Knight", language: "ja" },
  { id: "Japanese_GentleButler", name: "Gentle Butler", language: "ja" },
  { id: "Japanese_KindLady", name: "Kind Lady", language: "ja" },
  { id: "Japanese_CalmLady", name: "Calm Lady", language: "ja" },
  { id: "Japanese_OptimisticYouth", name: "Optimistic Youth", language: "ja" },
  { id: "Japanese_GracefulMaiden", name: "Graceful Maiden", language: "ja" },
  // Korean voices
  { id: "Korean_CalmGentleman", name: "Calm Gentleman", language: "ko" },
  { id: "Korean_CalmLady", name: "Calm Lady", language: "ko" },
  { id: "Korean_CheerfulBoyfriend", name: "Cheerful Boyfriend", language: "ko" },
  { id: "Korean_SweetGirl", name: "Sweet Girl", language: "ko" },
  { id: "Korean_WiseTeacher", name: "Wise Teacher", language: "ko" },
  // Chinese (Mandarin) voices
  { id: "Chinese (Mandarin)_Reliable_Executive", name: "Reliable Executive", language: "zh" },
  { id: "Chinese (Mandarin)_News_Anchor", name: "News Anchor", language: "zh" },
  { id: "Chinese (Mandarin)_Mature_Woman", name: "Mature Woman", language: "zh" },
  { id: "Chinese (Mandarin)_Gentleman", name: "Gentleman", language: "zh" },
  { id: "Chinese (Mandarin)_Sweet_Lady", name: "Sweet Lady", language: "zh" },
  { id: "Chinese (Mandarin)_Lyrical_Voice", name: "Lyrical Voice", language: "zh" },
  // Arabic voices
  { id: "Arabic_CalmWoman", name: "Calm Woman", language: "ar" },
  { id: "Arabic_FriendlyGuy", name: "Friendly Guy", language: "ar" },
  // Russian voices
  { id: "Russian_ReliableMan", name: "Reliable Man", language: "ru" },
  { id: "Russian_BrightHeroine", name: "Bright Queen", language: "ru" },
  { id: "Russian_AmbitiousWoman", name: "Ambitious Woman", language: "ru" },
  { id: "Russian_AttractiveGuy", name: "Attractive Guy", language: "ru" },
  // Hindi voices
  { id: "hindi_male_1_v2", name: "Trustworthy Advisor", language: "hi" },
  { id: "hindi_female_2_v1", name: "Tranquil Woman", language: "hi" },
  { id: "hindi_female_1_v2", name: "News Anchor", language: "hi" },
  // Indonesian voices
  { id: "Indonesian_SweetGirl", name: "Sweet Girl", language: "id" },
  { id: "Indonesian_CalmWoman", name: "Calm Woman", language: "id" },
  { id: "Indonesian_ConfidentWoman", name: "Confident Woman", language: "id" },
  { id: "Indonesian_CaringMan", name: "Caring Man", language: "id" },
];

const MINIMAX_MODEL_OPTIONS = [
  { id: "speech-2.6-hd", name: "HD (Haute qualité)", description: "Meilleure qualité audio" },
  { id: "speech-2.6-turbo", name: "Turbo (Rapide)", description: "Génération plus rapide" },
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
  const [ttsProvider] = useState<"minimax">("minimax");
  const [selectedVoice, setSelectedVoice] = useState("English_expressive_narrator");
  const [minimaxModel, setMinimaxModel] = useState("speech-2.6-hd");
  const [minimaxSpeed, setMinimaxSpeed] = useState(1.0);
  const [minimaxPitch, setMinimaxPitch] = useState(0);
  const [minimaxVolume, setMinimaxVolume] = useState(1.0);
  const [minimaxLanguageBoost, setMinimaxLanguageBoost] = useState("auto");
  const [minimaxEnglishNormalization, setMinimaxEnglishNormalization] = useState(true);
  const [minimaxEmotion, setMinimaxEmotion] = useState("neutral");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isGenerationOpen, setIsGenerationOpen] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  
  // TTS Preset management
  const [ttsPresets, setTtsPresets] = useState<TtsPreset[]>([]);
  const [selectedTtsPresetId, setSelectedTtsPresetId] = useState<string>("");
  const [saveTtsPresetDialogOpen, setSaveTtsPresetDialogOpen] = useState(false);
  const [editTtsPresetDialogOpen, setEditTtsPresetDialogOpen] = useState(false);
  const [duplicateTtsPresetDialogOpen, setDuplicateTtsPresetDialogOpen] = useState(false);
  const [newTtsPresetName, setNewTtsPresetName] = useState("");
  const [editTtsPresetName, setEditTtsPresetName] = useState("");
  const [editingTtsPresetId, setEditingTtsPresetId] = useState<string | null>(null);
  const [isSavingTtsPreset, setIsSavingTtsPreset] = useState(false);
  const [ttsPresetPopoverOpen, setTtsPresetPopoverOpen] = useState(false);
  
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
        loadTtsPresets();
        
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

  // TTS Preset functions
  const loadTtsPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("tts_presets")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      setTtsPresets(data || []);
    } catch (error) {
      console.error("Error loading TTS presets:", error);
    }
  };

  const handleLoadTtsPreset = (presetId: string) => {
    const preset = ttsPresets.find(p => p.id === presetId);
    if (preset) {
      // Only load MiniMax presets (ElevenLabs removed)
      if (preset.provider !== "minimax") {
        toast.error("Ce preset utilise un fournisseur non supporté");
        return;
      }
      setSelectedVoice(preset.voice_id);
      if (preset.model) setMinimaxModel(preset.model);
      setMinimaxSpeed(preset.speed);
      setMinimaxPitch(preset.pitch);
      setMinimaxVolume(preset.volume);
      setMinimaxLanguageBoost(preset.language_boost);
      setMinimaxEnglishNormalization(preset.english_normalization);
      setMinimaxEmotion(preset.emotion);
      setSelectedTtsPresetId(presetId);
      toast.success(`Preset TTS "${preset.name}" chargé`);
    }
  };

  const handleSaveTtsPreset = async () => {
    if (!newTtsPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    setIsSavingTtsPreset(true);
    try {
      const { error } = await supabase
        .from("tts_presets")
        .insert([{
          user_id: user!.id,
          name: newTtsPresetName.trim(),
          provider: ttsProvider,
          voice_id: selectedVoice,
          model: ttsProvider === "minimax" ? minimaxModel : null,
          speed: minimaxSpeed,
          pitch: minimaxPitch,
          volume: minimaxVolume,
          language_boost: minimaxLanguageBoost,
          english_normalization: minimaxEnglishNormalization,
          emotion: minimaxEmotion
        }]);

      if (error) throw error;

      toast.success("Preset TTS sauvegardé !");
      setSaveTtsPresetDialogOpen(false);
      setNewTtsPresetName("");
      loadTtsPresets();
    } catch (error: any) {
      console.error("Error saving TTS preset:", error);
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSavingTtsPreset(false);
    }
  };

  const handleDeleteTtsPreset = async (presetId: string) => {
    const preset = ttsPresets.find(p => p.id === presetId);
    if (!preset) return;

    if (!confirm(`Supprimer le preset TTS "${preset.name}" ?`)) return;

    try {
      const { error } = await supabase
        .from("tts_presets")
        .delete()
        .eq("id", presetId);

      if (error) throw error;

      toast.success("Preset TTS supprimé");
      if (selectedTtsPresetId === presetId) {
        setSelectedTtsPresetId("");
      }
      loadTtsPresets();
    } catch (error: any) {
      console.error("Error deleting TTS preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleOpenEditTtsPreset = (presetId: string) => {
    const preset = ttsPresets.find(p => p.id === presetId);
    if (!preset) return;
    setEditingTtsPresetId(presetId);
    setEditTtsPresetName(preset.name);
    // Load preset values into current state for editing (MiniMax only)
    if (preset.provider !== "minimax") {
      toast.error("Ce preset utilise un fournisseur non supporté");
      return;
    }
    setSelectedVoice(preset.voice_id);
    if (preset.model) setMinimaxModel(preset.model);
    setMinimaxSpeed(preset.speed);
    setMinimaxPitch(preset.pitch);
    setMinimaxVolume(preset.volume);
    setMinimaxLanguageBoost(preset.language_boost);
    setMinimaxEnglishNormalization(preset.english_normalization);
    setMinimaxEmotion(preset.emotion);
    setEditTtsPresetDialogOpen(true);
  };

  const handleUpdateTtsPreset = async () => {
    if (!editingTtsPresetId || !editTtsPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    setIsSavingTtsPreset(true);
    try {
      const { error } = await supabase
        .from("tts_presets")
        .update({
          name: editTtsPresetName.trim(),
          provider: ttsProvider,
          voice_id: selectedVoice,
          model: ttsProvider === "minimax" ? minimaxModel : null,
          speed: minimaxSpeed,
          pitch: minimaxPitch,
          volume: minimaxVolume,
          language_boost: minimaxLanguageBoost,
          english_normalization: minimaxEnglishNormalization,
          emotion: minimaxEmotion
        })
        .eq("id", editingTtsPresetId);

      if (error) throw error;

      toast.success("Preset TTS mis à jour !");
      setEditTtsPresetDialogOpen(false);
      setEditingTtsPresetId(null);
      loadTtsPresets();
    } catch (error: any) {
      console.error("Error updating TTS preset:", error);
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setIsSavingTtsPreset(false);
    }
  };

  const handleOpenDuplicateTtsPreset = (presetId: string) => {
    const preset = ttsPresets.find(p => p.id === presetId);
    if (!preset) return;
    setEditingTtsPresetId(presetId);
    setNewTtsPresetName(`${preset.name} (copie)`);
    setDuplicateTtsPresetDialogOpen(true);
  };

  const handleDuplicateTtsPreset = async () => {
    if (!editingTtsPresetId || !newTtsPresetName.trim()) {
      toast.error("Veuillez entrer un nom pour le preset");
      return;
    }

    const preset = ttsPresets.find(p => p.id === editingTtsPresetId);
    if (!preset) return;

    setIsSavingTtsPreset(true);
    try {
      const { error } = await supabase
        .from("tts_presets")
        .insert([{
          user_id: user!.id,
          name: newTtsPresetName.trim(),
          provider: preset.provider,
          voice_id: preset.voice_id,
          model: preset.model,
          speed: preset.speed,
          pitch: preset.pitch,
          volume: preset.volume,
          language_boost: preset.language_boost,
          english_normalization: preset.english_normalization,
          emotion: preset.emotion
        }]);

      if (error) throw error;

      toast.success("Preset TTS dupliqué !");
      setDuplicateTtsPresetDialogOpen(false);
      setEditingTtsPresetId(null);
      setNewTtsPresetName("");
      loadTtsPresets();
    } catch (error: any) {
      console.error("Error duplicating TTS preset:", error);
      toast.error("Erreur lors de la duplication");
    } finally {
      setIsSavingTtsPreset(false);
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

  // Audio job polling
  const [audioJobId, setAudioJobId] = useState<string | null>(null);

  // Poll for audio job completion
  useEffect(() => {
    if (!audioJobId || !isGeneratingAudio) return;

    const pollInterval = setInterval(async () => {
      try {
        const { data: job, error } = await supabase
          .from('generation_jobs')
          .select('*')
          .eq('id', audioJobId)
          .single();

        if (error) {
          console.error("Error polling audio job:", error);
          return;
        }

        if (job.status === 'completed') {
          clearInterval(pollInterval);
          setIsGeneratingAudio(false);

          // Get audio URL from job metadata
          const metadata = job.metadata as any;
          if (metadata?.audioUrl) {
            setAudioUrl(metadata.audioUrl);
            setStep("audio");
            toast.success("Audio généré avec succès !");
          }
          setAudioJobId(null);
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          setIsGeneratingAudio(false);
          setAudioJobId(null);
          toast.error(job.error_message || "Erreur lors de la génération audio");
        }
      } catch (err) {
        console.error("Audio polling error:", err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [audioJobId, isGeneratingAudio]);

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

      // Start audio generation job via backend
      const { data, error } = await supabase.functions.invoke('start-generation-job', {
        body: {
          projectId,
          jobType: 'audio_generation',
          metadata: {
            script: generatedScript,
            voice: selectedVoice,
            model: minimaxModel,
            speed: minimaxSpeed,
            pitch: minimaxPitch,
            volume: minimaxVolume,
            languageBoost: minimaxLanguageBoost,
            englishNormalization: minimaxEnglishNormalization,
            emotion: minimaxEmotion,
            provider: ttsProvider
          }
        }
      });

      if (error) throw error;

      if (data.jobId) {
        setAudioJobId(data.jobId);
        toast.info("Génération audio en cours... Vous pouvez quitter cette page, l'audio sera sauvegardé.");
      } else {
        throw new Error("Pas de job ID reçu");
      }
    } catch (error: any) {
      console.error("Error starting audio generation:", error);
      setIsGeneratingAudio(false);
      toast.error(error.message || "Erreur lors du lancement de la génération audio");
    }
  };

  // Handle audio file upload
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!projectId) {
      toast.error("Erreur: projet non trouvé");
      return;
    }

    // Validate file type
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Format non supporté. Utilisez MP3 ou WAV.");
      return;
    }

    // Max size 100MB
    if (file.size > 100 * 1024 * 1024) {
      toast.error("Le fichier est trop volumineux (max 100MB)");
      return;
    }

    setIsUploadingAudio(true);
    try {
      // Upload to Supabase Storage
      const timestamp = Date.now();
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${user!.id}/${projectId}/${timestamp}_${cleanFileName}`;

      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('audio-files')
        .getPublicUrl(filePath);

      if (!urlData?.publicUrl) {
        throw new Error("Impossible d'obtenir l'URL du fichier");
      }

      // Update project with audio URL
      await supabase
        .from("projects")
        .update({ audio_url: urlData.publicUrl })
        .eq("id", projectId);

      setAudioUrl(urlData.publicUrl);
      setStep("audio");
      toast.success("Audio importé avec succès !");
    } catch (error: any) {
      console.error("Error uploading audio:", error);
      toast.error(error.message || "Erreur lors de l'import de l'audio");
    } finally {
      setIsUploadingAudio(false);
      // Reset input
      if (audioInputRef.current) {
        audioInputRef.current.value = "";
      }
    }
  };

  const handleContinueToVideo = () => {
    if (!projectId) {
      toast.error("Erreur: projet non trouvé");
      return;
    }
    
    // Navigate directly to workspace with the project
    navigate(`/workspace?project=${projectId}`);
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Créer de zéro</span>
            <Link to="/profile">
              <Button variant="ghost" size="icon">
                <UserIcon className="h-4 w-4" />
              </Button>
            </Link>
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
                    disabled={isGeneratingScript}
                  >
                    Retour
                  </Button>
                  <Button 
                    variant="secondary"
                    onClick={() => generateScriptWithPrompt(customPrompt)}
                    disabled={isGeneratingScript}
                  >
                    Aucune thèse
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={handleGenerateAxes}
                    disabled={isGeneratingScript}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Régénérer
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
                  <div className="flex gap-2 flex-wrap">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedScript);
                        toast.success("Script copié !");
                      }}
                      disabled={!generatedScript.trim()}
                    >
                      <ClipboardCopy className="h-4 w-4 mr-2" />
                      Copier
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open("https://www.minimax.io/audio/text-to-speech", "_blank")}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      MiniMax Web
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
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

                {/* Audio Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-semibold">Audio</h3>
                  
                  {/* Import Audio Option */}
                  <div className="space-y-3">
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav"
                      onChange={handleAudioUpload}
                      className="hidden"
                      id="audio-upload"
                    />
                    <Button
                      variant="outline"
                      onClick={() => audioInputRef.current?.click()}
                      disabled={isUploadingAudio || isGeneratingAudio || !generatedScript.trim()}
                      className="w-full"
                    >
                      {isUploadingAudio ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Import en cours...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Importer un fichier audio (MP3, WAV)
                        </>
                      )}
                    </Button>

                    <div className="relative flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <span className="relative bg-card px-3 text-xs text-muted-foreground uppercase">
                        ou générer
                      </span>
                    </div>
                  </div>

                  {/* Generation Options - Collapsible */}
                  <Collapsible open={isGenerationOpen} onOpenChange={setIsGenerationOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-3 h-auto">
                        <span className="flex items-center gap-2">
                          <Mic className="h-4 w-4" />
                          Options de génération audio
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${isGenerationOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-4">
                      {/* TTS Presets */}
                      <div className="space-y-2">
                        <Label>Preset TTS</Label>
                        <div className="flex gap-2">
                          <Popover open={ttsPresetPopoverOpen} onOpenChange={setTtsPresetPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="flex-1 justify-between">
                                <span className="flex items-center gap-2">
                                  <FolderOpen className="h-4 w-4" />
                                  {selectedTtsPresetId 
                                    ? ttsPresets.find(p => p.id === selectedTtsPresetId)?.name || "Sélectionner..."
                                    : "Sélectionner un preset..."}
                                </span>
                                <ChevronDown className="h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-0 bg-popover z-50" align="start">
                              <div className="p-2 border-b">
                                <p className="text-sm font-medium">Presets TTS sauvegardés</p>
                              </div>
                              {ttsPresets.length === 0 ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  Aucun preset TTS sauvegardé
                                </div>
                              ) : (
                                <div className="max-h-60 overflow-y-auto">
                                  {ttsPresets.map((preset) => (
                                    <div 
                                      key={preset.id}
                                      className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer"
                                    >
                                      <div 
                                        className="flex-1 pr-2"
                                        onClick={() => {
                                          handleLoadTtsPreset(preset.id);
                                          setTtsPresetPopoverOpen(false);
                                        }}
                                      >
                                        <p className="font-medium text-sm">{preset.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {preset.provider === "minimax" ? "MiniMax (API Officielle)" : "ElevenLabs (Replicate)"} - {preset.voice_id}
                                        </p>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenEditTtsPreset(preset.id);
                                            setTtsPresetPopoverOpen(false);
                                          }}
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenDuplicateTtsPreset(preset.id);
                                            setTtsPresetPopoverOpen(false);
                                          }}
                                        >
                                          <Copy className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive hover:text-destructive"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteTtsPreset(preset.id);
                                          }}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                          <Button
                            variant="outline"
                            onClick={() => setSaveTtsPresetDialogOpen(true)}
                          >
                            <Save className="h-4 w-4 mr-2" />
                            Sauvegarder
                          </Button>
                        </div>
                      </div>

                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="text-sm font-medium">Fournisseur TTS</p>
                        <p className="text-sm text-muted-foreground">MiniMax (API Officielle)</p>
                      </div>

                      <div className="space-y-4">
                        <Label>Modèle MiniMax</Label>
                        <Select value={minimaxModel} onValueChange={setMinimaxModel}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MINIMAX_MODEL_OPTIONS.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-4">
                        <Label>Langue prioritaire</Label>
                        <Select value={minimaxLanguageBoost} onValueChange={setMinimaxLanguageBoost}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto-détection</SelectItem>
                            <SelectItem value="English">Anglais</SelectItem>
                            <SelectItem value="French">Français</SelectItem>
                            <SelectItem value="Spanish">Espagnol</SelectItem>
                            <SelectItem value="German">Allemand</SelectItem>
                            <SelectItem value="Italian">Italien</SelectItem>
                            <SelectItem value="Portuguese">Portugais</SelectItem>
                            <SelectItem value="Chinese">Chinois</SelectItem>
                            <SelectItem value="Japanese">Japonais</SelectItem>
                            <SelectItem value="Korean">Coréen</SelectItem>
                            <SelectItem value="Arabic">Arabe</SelectItem>
                            <SelectItem value="Russian">Russe</SelectItem>
                            <SelectItem value="Hindi">Hindi</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Vitesse ({minimaxSpeed.toFixed(1)}x)</Label>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.1"
                            value={minimaxSpeed}
                            onChange={(e) => setMinimaxSpeed(parseFloat(e.target.value))}
                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>0.5x</span>
                            <span>2.0x</span>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>Pitch ({minimaxPitch > 0 ? '+' : ''}{minimaxPitch})</Label>
                          <input
                            type="range"
                            min="-12"
                            max="12"
                            step="1"
                            value={minimaxPitch}
                            onChange={(e) => setMinimaxPitch(parseInt(e.target.value))}
                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Grave</span>
                            <span>Aigu</span>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>Volume ({Math.round(minimaxVolume * 100)}%)</Label>
                          <input
                            type="range"
                            min="10"
                            max="100"
                            step="10"
                            value={Math.round(minimaxVolume * 100)}
                            onChange={(e) => setMinimaxVolume(parseInt(e.target.value) / 100)}
                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>10%</span>
                            <span>100%</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div className="space-y-0.5">
                          <Label className="text-base">Normalisation des nombres</Label>
                          <p className="text-sm text-muted-foreground">
                            Améliore la lecture des nombres, dates et unités
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={minimaxEnglishNormalization}
                          onChange={(e) => setMinimaxEnglishNormalization(e.target.checked)}
                          className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </div>

                      <div className="space-y-4">
                        <Label>Émotion</Label>
                        <Select value={minimaxEmotion} onValueChange={setMinimaxEmotion}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MINIMAX_EMOTIONS.map((emotion) => (
                              <SelectItem key={emotion.id} value={emotion.id}>
                                {emotion.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-4">
                        <Label>Voix pour l'audio</Label>
                        <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MINIMAX_VOICE_OPTIONS.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name} ({voice.language.toUpperCase()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button 
                        onClick={handleGenerateAudio} 
                        disabled={isGeneratingAudio || !generatedScript.trim()}
                        className="w-full"
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
                            Générer l'audio avec MiniMax
                          </>
                        )}
                      </Button>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                <div className="flex gap-4 border-t pt-4">
                  <Button 
                    variant="outline"
                    onClick={() => setStep("topic")}
                    className="flex-1"
                  >
                    Retour
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

      {/* Save TTS Preset Dialog */}
      <Dialog open={saveTtsPresetDialogOpen} onOpenChange={setSaveTtsPresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sauvegarder le preset TTS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newTtsPresetName">Nom du preset</Label>
              <Input
                id="newTtsPresetName"
                placeholder="Ma configuration TTS..."
                value={newTtsPresetName}
                onChange={(e) => setNewTtsPresetName(e.target.value)}
              />
            </div>
            <div className="p-4 bg-muted rounded-lg text-sm">
              <p className="font-medium mb-2">Configuration actuelle :</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>Fournisseur : {ttsProvider === "minimax" ? "MiniMax" : "ElevenLabs"}</li>
                <li>Voix : {selectedVoice}</li>
                {ttsProvider === "minimax" && (
                  <>
                    <li>Modèle : {minimaxModel}</li>
                    <li>Vitesse : {minimaxSpeed}x</li>
                    <li>Pitch : {minimaxPitch}</li>
                    <li>Émotion : {MINIMAX_EMOTIONS.find(e => e.id === minimaxEmotion)?.name || minimaxEmotion}</li>
                  </>
                )}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTtsPresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSaveTtsPreset} disabled={isSavingTtsPreset || !newTtsPresetName.trim()}>
              {isSavingTtsPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Sauvegarder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit TTS Preset Dialog */}
      <Dialog open={editTtsPresetDialogOpen} onOpenChange={setEditTtsPresetDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modifier le preset TTS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editTtsPresetName">Nom du preset</Label>
              <Input
                id="editTtsPresetName"
                placeholder="Ma configuration TTS..."
                value={editTtsPresetName}
                onChange={(e) => setEditTtsPresetName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fournisseur</Label>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm font-medium">Fournisseur: MiniMax (API Officielle)</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Voix</Label>
                <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MINIMAX_VOICE_OPTIONS.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        {voice.name} ({voice.language.toUpperCase()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ttsProvider === "minimax" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Modèle</Label>
                    <Select value={minimaxModel} onValueChange={setMinimaxModel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MINIMAX_MODEL_OPTIONS.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Émotion</Label>
                    <Select value={minimaxEmotion} onValueChange={setMinimaxEmotion}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MINIMAX_EMOTIONS.map((emotion) => (
                          <SelectItem key={emotion.id} value={emotion.id}>
                            {emotion.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Vitesse ({minimaxSpeed.toFixed(1)}x)</Label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={minimaxSpeed}
                      onChange={(e) => setMinimaxSpeed(parseFloat(e.target.value))}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Pitch ({minimaxPitch > 0 ? '+' : ''}{minimaxPitch})</Label>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={minimaxPitch}
                      onChange={(e) => setMinimaxPitch(parseInt(e.target.value))}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Volume ({(minimaxVolume * 100).toFixed(0)}%)</Label>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.1"
                      value={minimaxVolume}
                      onChange={(e) => setMinimaxVolume(parseFloat(e.target.value))}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTtsPresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleUpdateTtsPreset} disabled={isSavingTtsPreset || !editTtsPresetName.trim()}>
              {isSavingTtsPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate TTS Preset Dialog */}
      <Dialog open={duplicateTtsPresetDialogOpen} onOpenChange={setDuplicateTtsPresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dupliquer le preset TTS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="duplicateTtsPresetName">Nom du nouveau preset</Label>
              <Input
                id="duplicateTtsPresetName"
                placeholder="Ma configuration TTS (copie)..."
                value={newTtsPresetName}
                onChange={(e) => setNewTtsPresetName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateTtsPresetDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleDuplicateTtsPreset} disabled={isSavingTtsPreset || !newTtsPresetName.trim()}>
              {isSavingTtsPreset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              Dupliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateFromScratch;
