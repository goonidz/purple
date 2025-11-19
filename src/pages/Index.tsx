import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles, Copy, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface TranscriptSegment {
  text: string;
  start_time: number;
  end_time: number;
  speaker?: { id: string; name: string };
}

interface TranscriptData {
  segments: TranscriptSegment[];
  language_code?: string;
}

interface Scene {
  text: string;
  startTime: number;
  endTime: number;
}

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
}

const Index = () => {
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [examplePrompt, setExamplePrompt] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([]);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState(false);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [sceneDuration0to1, setSceneDuration0to1] = useState(4);
  const [sceneDuration1to3, setSceneDuration1to3] = useState(6);
  const [sceneDuration3plus, setSceneDuration3plus] = useState(8);

  const parseTranscriptToScenes = (
    transcriptData: TranscriptData, 
    duration0to1: number,
    duration1to3: number, 
    duration3plus: number
  ): Scene[] => {
    const scenes: Scene[] = [];
    let currentScene: Scene = { text: "", startTime: 0, endTime: 0 };
    
    // Fonction pour obtenir la durée max selon le timestamp
    const getMaxDuration = (timestamp: number): number => {
      if (timestamp < 60) return duration0to1;
      if (timestamp < 180) return duration1to3;
      return duration3plus;
    };
    
    transcriptData.segments.forEach((segment, index) => {
      if (index === 0) {
        currentScene = {
          text: segment.text,
          startTime: segment.start_time,
          endTime: segment.end_time
        };
      } else {
        const potentialDuration = segment.end_time - currentScene.startTime;
        const maxDuration = getMaxDuration(currentScene.startTime);
        
        // Si ajouter ce segment dépasserait la durée max pour cette tranche temporelle
        if (potentialDuration > maxDuration) {
          // Sauvegarder la scène actuelle si elle n'est pas vide
          if (currentScene.text.trim()) {
            scenes.push({ ...currentScene });
          }
          // Démarrer une nouvelle scène avec ce segment
          currentScene = {
            text: segment.text,
            startTime: segment.start_time,
            endTime: segment.end_time
          };
        } else {
          // Ajouter le segment à la scène actuelle (ne coupe pas les phrases)
          currentScene.text += " " + segment.text;
          currentScene.endTime = segment.end_time;
        }
      }
    });
    
    // Ajouter la dernière scène
    if (currentScene.text.trim()) {
      scenes.push(currentScene);
    }
    
    return scenes;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== "application/json") {
        toast.error("Veuillez uploader un fichier JSON");
        return;
      }
      setTranscriptFile(file);
      setScenes([]);
      setGeneratedPrompts([]);
      toast.success("Fichier chargé !");
    }
  };

  const handleGenerateScenes = async () => {
    if (!transcriptFile) {
      toast.error("Veuillez uploader un fichier de transcription JSON");
      return;
    }

    setIsGeneratingScenes(true);
    setScenes([]);
    setGeneratedPrompts([]);
    
    try {
      const fileContent = await transcriptFile.text();
      const transcriptData: TranscriptData = JSON.parse(fileContent);
      
      if (!transcriptData.segments || transcriptData.segments.length === 0) {
        throw new Error("Le fichier JSON ne contient pas de segments valides");
      }

      const generatedScenes = parseTranscriptToScenes(
        transcriptData, 
        sceneDuration0to1,
        sceneDuration1to3,
        sceneDuration3plus
      );
      setScenes(generatedScenes);
      toast.success(`${generatedScenes.length} scènes générées ! Vous pouvez maintenant générer les prompts.`);
    } catch (error: any) {
      console.error("Error generating scenes:", error);
      toast.error(error.message || "Erreur lors de la génération des scènes");
    } finally {
      setIsGeneratingScenes(false);
    }
  };

  const handleGeneratePrompts = async () => {
    if (scenes.length === 0) {
      toast.error("Veuillez d'abord générer les scènes");
      return;
    }

    setIsGeneratingPrompts(true);
    setGeneratedPrompts([]);
    
    try {
      // Récupérer le fichier original pour le contexte global
      const fileContent = await transcriptFile!.text();
      const transcriptData: TranscriptData = JSON.parse(fileContent);
      
      const globalContext = transcriptData.segments
        .slice(0, 10)
        .map(s => s.text)
        .join(" ");

      const prompts: GeneratedPrompt[] = [];
      
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        
        try {
          const { data, error } = await supabase.functions.invoke("generate-prompts", {
            body: { 
              scene: scene.text,
              globalContext,
              examplePrompt,
              sceneIndex: i + 1,
              totalScenes: scenes.length,
              startTime: scene.startTime,
              endTime: scene.endTime
            },
          });

          if (error) throw error;

          prompts.push({
            scene: `Scène ${i + 1} (${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s)`,
            prompt: data.prompt,
            text: scene.text,
            startTime: scene.startTime,
            endTime: scene.endTime
          });

          setGeneratedPrompts([...prompts]);
          
        } catch (sceneError: any) {
          console.error(`Error generating prompt for scene ${i + 1}:`, sceneError);
          prompts.push({
            scene: `Scène ${i + 1} (${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s)`,
            prompt: "Erreur lors de la génération",
            text: scene.text,
            startTime: scene.startTime,
            endTime: scene.endTime
          });
        }
      }

      toast.success(`${prompts.length} prompts générés avec succès !`);
    } catch (error: any) {
      console.error("Error generating prompts:", error);
      toast.error(error.message || "Erreur lors de la génération des prompts");
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  const copyToClipboard = async (prompt: string, index: number) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    toast.success("Prompt copié !");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-warm">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">ScenePrompt AI</h1>
              <p className="text-sm text-muted-foreground">Transformez vos transcriptions en prompts visuels</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card className="p-6 shadow-card">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Fichier de transcription</h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <label htmlFor="transcript-upload" className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors">
                      <Upload className="h-4 w-4" />
                      <span>Choisir un fichier JSON</span>
                    </div>
                    <input
                      id="transcript-upload"
                      type="file"
                      accept=".json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  {transcriptFile && (
                    <span className="text-sm text-muted-foreground">
                      {transcriptFile.name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Uploadez un fichier JSON avec segments et timestamps
                </p>
              </div>
            </Card>

            <Card className="p-6 shadow-card">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Durée des scènes (secondes)</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">
                    0-1 minute (début captivant)
                  </label>
                  <Input
                    type="number"
                    min="3"
                    max="10"
                    value={sceneDuration0to1}
                    onChange={(e) => setSceneDuration0to1(Number(e.target.value))}
                    className="text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">
                    1-3 minutes (développement)
                  </label>
                  <Input
                    type="number"
                    min="3"
                    max="12"
                    value={sceneDuration1to3}
                    onChange={(e) => setSceneDuration1to3(Number(e.target.value))}
                    className="text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">
                    3+ minutes (rythme établi)
                  </label>
                  <Input
                    type="number"
                    min="4"
                    max="15"
                    value={sceneDuration3plus}
                    onChange={(e) => setSceneDuration3plus(Number(e.target.value))}
                    className="text-base"
                  />
                </div>
              </div>
            </Card>

            <Card className="p-6 shadow-card">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Prompt d'exemple (optionnel)</h2>
              <Input
                placeholder="Ex: cinematic photograph, 8k ultra detailed, dramatic lighting"
                value={examplePrompt}
                onChange={(e) => setExamplePrompt(e.target.value)}
                className="text-base"
              />
            </Card>

            <div className="space-y-3">
              <Button
                onClick={handleGenerateScenes}
                disabled={isGeneratingScenes || !transcriptFile}
                className="w-full h-12 text-base font-semibold shadow-glow bg-gradient-warm hover:opacity-90 transition-opacity"
              >
                {isGeneratingScenes ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Génération des scènes...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    1. Générer les scènes
                  </>
                )}
              </Button>

              <Button
                onClick={handleGeneratePrompts}
                disabled={isGeneratingPrompts || scenes.length === 0}
                variant={scenes.length > 0 ? "default" : "secondary"}
                className="w-full h-12 text-base font-semibold"
              >
                {isGeneratingPrompts ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Génération des prompts... ({generatedPrompts.length}/{scenes.length})
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    2. Générer les prompts {scenes.length > 0 && `(${scenes.length} scènes)`}
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {/* Affichage des scènes générées */}
            {scenes.length > 0 && generatedPrompts.length === 0 && (
              <>
                <h2 className="text-lg font-semibold text-foreground">
                  Scènes générées ({scenes.length})
                </h2>
                <div className="space-y-3 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
                  {scenes.map((scene, index) => (
                    <Card key={index} className="p-4 shadow-card">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground mb-1">
                            {scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s ({(scene.endTime - scene.startTime).toFixed(1)}s)
                          </div>
                          <p className="text-sm text-foreground/90">{scene.text}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {/* Affichage des prompts générés */}
            {generatedPrompts.length > 0 && (
              <>
                <h2 className="text-lg font-semibold text-foreground">
                  Prompts générés ({generatedPrompts.length}/{scenes.length})
                </h2>
                <div className="space-y-4 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
                  {generatedPrompts.map((item, index) => (
                    <Card key={index} className="p-4 shadow-card hover:shadow-card-hover transition-shadow">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground mb-1">{item.scene}</h3>
                          <p className="text-xs text-muted-foreground italic mb-2">"{item.text}"</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyToClipboard(item.prompt, index)}
                          className="shrink-0"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90 bg-muted/50 p-3 rounded-lg">
                        {item.prompt}
                      </p>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {/* État vide */}
            {scenes.length === 0 && generatedPrompts.length === 0 && (
              <>
                <h2 className="text-lg font-semibold text-foreground">
                  Résultats
                </h2>
                <Card className="p-12 shadow-card">
                  <div className="text-center text-muted-foreground">
                    <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="mb-2">Commencez par générer les scènes</p>
                    <p className="text-xs">Les scènes et prompts apparaîtront ici</p>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border/50 mt-12 py-6 text-center text-sm text-muted-foreground">
        Propulsé par Lovable AI ✨
      </footer>
    </div>
  );
};

export default Index;
