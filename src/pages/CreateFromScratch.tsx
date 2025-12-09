import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Sparkles, FileText, Mic, ArrowRight, Check, RefreshCw, ChevronDown, Save, Trash2, FolderOpen } from "lucide-react";
import { toast } from "sonner";

type WorkflowStep = "topic" | "script" | "audio" | "complete";

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

const DURATION_OPTIONS = [
  { id: "short", name: "Court (30-60s)", description: "Environ 100-150 mots" },
  { id: "medium", name: "Moyen (2-3 min)", description: "Environ 300-450 mots" },
  { id: "long", name: "Long (5-7 min)", description: "Environ 750-1000 mots" },
];

const STYLE_OPTIONS = [
  { id: "educational", name: "Éducatif", description: "Informatif avec des explications claires" },
  { id: "entertaining", name: "Divertissant", description: "Engageant avec de l'humour" },
  { id: "dramatic", name: "Dramatique", description: "Captivant avec du suspense" },
  { id: "natural", name: "Naturel", description: "Conversationnel et fluide" },
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
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState<WorkflowStep>("topic");
  
  // Topic step
  const [projectName, setProjectName] = useState("");
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("medium");
  const [style, setStyle] = useState("educational");
  const [language, setLanguage] = useState("fr");
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_PROMPT);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  
  // Preset management
  const [presets, setPresets] = useState<ScriptPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [savePresetDialogOpen, setSavePresetDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  
  // Script step
  const [generatedScript, setGeneratedScript] = useState("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [estimatedDuration, setEstimatedDuration] = useState(0);
  
  // Audio step
  const [selectedVoice, setSelectedVoice] = useState("daniel");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);

  // Check authentication
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      } else {
        loadPresets();
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
      setDuration(preset.duration || "medium");
      setStyle(preset.style || "educational");
      setLanguage(preset.language || "fr");
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
          custom_prompt: customPrompt,
          duration,
          style,
          language
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

  const handleGenerateScript = async () => {
    if (!topic.trim()) {
      toast.error("Veuillez entrer un sujet pour votre vidéo");
      return;
    }

    setIsGeneratingScript(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-script', {
        body: {
          topic: topic.trim(),
          duration,
          style,
          language,
          customPrompt: customPrompt !== DEFAULT_PROMPT ? customPrompt : undefined
        }
      });

      if (error) throw error;

      setGeneratedScript(data.script);
      setWordCount(data.wordCount || 0);
      setEstimatedDuration(data.estimatedDuration || 0);
      setStep("script");
      toast.success("Script généré avec succès !");
    } catch (error: any) {
      console.error("Error generating script:", error);
      toast.error(error.message || "Erreur lors de la génération du script");
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRegenerateScript = async () => {
    setIsGeneratingScript(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-script', {
        body: {
          topic: topic.trim(),
          duration,
          style,
          language,
          customPrompt: customPrompt !== DEFAULT_PROMPT ? customPrompt : undefined
        }
      });

      if (error) throw error;

      setGeneratedScript(data.script);
      setWordCount(data.wordCount || 0);
      setEstimatedDuration(data.estimatedDuration || 0);
      toast.success("Script régénéré !");
    } catch (error: any) {
      console.error("Error regenerating script:", error);
      toast.error(error.message || "Erreur lors de la régénération");
    } finally {
      setIsGeneratingScript(false);
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

    setIsGeneratingAudio(true);
    try {
      // First create the project
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .insert([{
          user_id: user!.id,
          name: projectName.trim(),
        }])
        .select()
        .single();

      if (projectError) throw projectError;
      
      setProjectId(projectData.id);

      // Generate audio
      const { data, error } = await supabase.functions.invoke('generate-audio-tts', {
        body: {
          script: generatedScript,
          voice: selectedVoice,
          projectId: projectData.id
        }
      });

      if (error) throw error;

      // Update project with audio URL
      await supabase
        .from("projects")
        .update({ audio_url: data.audioUrl })
        .eq("id", projectData.id);

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
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className={`flex items-center gap-2 ${step === "topic" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "topic" ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary"}`}>
              {step !== "topic" ? <Check className="h-4 w-4" /> : "1"}
            </div>
            <span className="font-medium">Sujet</span>
          </div>
          <div className="w-12 h-0.5 bg-muted" />
          <div className={`flex items-center gap-2 ${step === "script" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "script" ? "bg-primary text-primary-foreground" : step === "audio" || step === "complete" ? "bg-primary/20 text-primary" : "bg-muted"}`}>
              {step === "audio" || step === "complete" ? <Check className="h-4 w-4" /> : "2"}
            </div>
            <span className="font-medium">Script</span>
          </div>
          <div className="w-12 h-0.5 bg-muted" />
          <div className={`flex items-center gap-2 ${step === "audio" || step === "complete" ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === "audio" || step === "complete" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {step === "complete" ? <Check className="h-4 w-4" /> : "3"}
            </div>
            <span className="font-medium">Audio</span>
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
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Label>Charger un preset</Label>
                    <Select value={selectedPresetId} onValueChange={handleLoadPreset}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner un preset..." />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedPresetId && (
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="mt-6"
                      onClick={() => handleDeletePreset(selectedPresetId)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
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

                  <div className="space-y-2">
                    <Label htmlFor="topic">Sujet de la vidéo *</Label>
                    <Textarea
                      id="topic"
                      placeholder="Décrivez le sujet de votre vidéo en détail. Par exemple: 'Les 5 erreurs les plus courantes en investissement immobilier et comment les éviter'"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Durée</Label>
                      <Select value={duration} onValueChange={setDuration}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DURATION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              <div>
                                <div>{opt.name}</div>
                                <div className="text-xs text-muted-foreground">{opt.description}</div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Style</Label>
                      <Select value={style} onValueChange={setStyle}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STYLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              <div>
                                <div>{opt.name}</div>
                                <div className="text-xs text-muted-foreground">{opt.description}</div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Langue</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fr">Français</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                      </SelectContent>
                    </Select>
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
                        Ce prompt sera envoyé à Claude IA pour guider la génération du script. Les variables de durée, style et langue seront ajoutées automatiquement.
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                <Button 
                  onClick={handleGenerateScript} 
                  disabled={isGeneratingScript || !topic.trim() || !projectName.trim()}
                  className="w-full"
                  size="lg"
                >
                  {isGeneratingScript ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Génération du script...
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" />
                      Générer le script avec Claude IA
                    </>
                  )}
                </Button>
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
              Ce preset sauvegardera: durée ({duration}), style ({style}), langue ({language}) et le prompt personnalisé.
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
    </div>
  );
};

export default CreateFromScratch;
