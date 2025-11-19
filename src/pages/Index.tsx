import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Copy, Check, Upload, LogOut, FolderOpen, Image as ImageIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

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
  const cancelGenerationRef = useRef(false);
  const [imageWidth, setImageWidth] = useState<number>(1920);
  const [imageHeight, setImageHeight] = useState<number>(1080);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
  const [styleReferenceUrl, setStyleReferenceUrl] = useState<string>("");
  const [uploadedStyleImageUrl, setUploadedStyleImageUrl] = useState<string>("");
  const [isUploadingStyleImage, setIsUploadingStyleImage] = useState(false);
  const [regeneratingPromptIndex, setRegeneratingPromptIndex] = useState<number | null>(null);
  const [confirmRegeneratePrompt, setConfirmRegeneratePrompt] = useState<number | null>(null);
  const [confirmRegenerateImage, setConfirmRegenerateImage] = useState<number | null>(null);

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

  // Load project data when project is selected
  useEffect(() => {
    if (currentProjectId) {
      loadProjectData(currentProjectId);
    }
  }, [currentProjectId]);

  // Auto-save project data when it changes
  useEffect(() => {
    if (currentProjectId && transcriptData) {
      const timeoutId = setTimeout(() => {
        saveProjectData();
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [currentProjectId, transcriptData, examplePrompts, scenes, generatedPrompts, sceneDuration0to1, sceneDuration1to3, sceneDuration3plus, styleReferenceUrl]);

  const loadProjectData = async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;

      setProjectName(data.name || "");
      if (data.transcript_json) {
        setTranscriptData(data.transcript_json as unknown as TranscriptData);
      }
      const prompts = (data.example_prompts as string[]) || ["", "", ""];
      setExamplePrompts(Array.isArray(prompts) ? prompts : ["", "", ""]);
      setScenes((data.scenes as unknown as Scene[]) || []);
      setGeneratedPrompts((data.prompts as unknown as GeneratedPrompt[]) || []);
      setSceneDuration0to1(data.scene_duration_0to1 || 4);
      setSceneDuration1to3(data.scene_duration_1to3 || 6);
      setSceneDuration3plus(data.scene_duration_3plus || 8);
      if (data.style_reference_url) {
        setStyleReferenceUrl(data.style_reference_url);
        setUploadedStyleImageUrl(data.style_reference_url);
      }
    } catch (error: any) {
      console.error("Error loading project:", error);
      toast.error("Erreur lors du chargement du projet");
    }
  };

  const saveProjectData = async () => {
    if (!currentProjectId) return;

    try {
      const { error } = await supabase
        .from("projects")
        .update({
          transcript_json: transcriptData as any,
          example_prompts: examplePrompts as any,
          scenes: scenes as any,
          prompts: generatedPrompts as any,
          scene_duration_0to1: sceneDuration0to1,
          scene_duration_1to3: sceneDuration1to3,
          scene_duration_3plus: sceneDuration3plus,
          style_reference_url: styleReferenceUrl || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;
    } catch (error: any) {
      console.error("Error saving project:", error);
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

  const parseTranscriptToScenes = (
    transcriptData: TranscriptData, 
    duration0to1: number,
    duration1to3: number, 
    duration3plus: number
  ): Scene[] => {
    const scenes: Scene[] = [];
    let currentScene: Scene = { text: "", startTime: 0, endTime: 0 };
    
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
        
        if (potentialDuration > maxDuration) {
          if (currentScene.text.trim()) {
            scenes.push({ ...currentScene });
          }
          currentScene = {
            text: segment.text,
            startTime: segment.start_time,
            endTime: segment.end_time
          };
        } else {
          currentScene.text += " " + segment.text;
          currentScene.endTime = segment.end_time;
        }
      }
    });
    
    if (currentScene.text.trim()) {
      scenes.push(currentScene);
    }
    
    return scenes;
  };

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
        sceneDuration3plus
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

    const scenesToProcess = testMode ? scenes.slice(0, 15) : scenes;
    const sceneCount = scenesToProcess.length;

    if (testMode && scenes.length < 15) {
      toast.info(`Mode test : génération des ${scenes.length} scènes disponibles`);
    } else if (testMode) {
      toast.info(`Mode test : génération des 15 premières scènes sur ${scenes.length}`);
    }

    setIsGeneratingPrompts(true);
    setGeneratedPrompts([]);
    cancelGenerationRef.current = false;

    try {
      toast.info("Génération du résumé global...");
      const fullTranscript = transcriptData?.segments.map(seg => seg.text).join(' ') || '';
      
      const { data: summaryData, error: summaryError } = await supabase.functions.invoke('generate-summary', {
        body: { transcript: fullTranscript }
      });

      if (summaryError) throw summaryError;
      
      const summary = summaryData.summary;
      console.log("Global summary:", summary);
      toast.success("Résumé global généré !");

      await supabase
        .from("projects")
        .update({ summary })
        .eq("id", currentProjectId);

      const prompts: GeneratedPrompt[] = [];
      const filteredPrompts = examplePrompts.filter(p => p.trim() !== "");
      const BATCH_SIZE = 10;

      // Process scenes in batches of 10 for parallel generation
      for (let batchStart = 0; batchStart < sceneCount; batchStart += BATCH_SIZE) {
        if (cancelGenerationRef.current) {
          toast.info(`Génération annulée. ${prompts.length} prompts générés.`);
          break;
        }

        const batchEnd = Math.min(batchStart + BATCH_SIZE, sceneCount);
        const batch = scenesToProcess.slice(batchStart, batchEnd);
        
        toast.info(`Génération des scènes ${batchStart + 1}-${batchEnd} sur ${sceneCount}...`);

        const batchPromises = batch.map(async (scene, batchIndex) => {
          const i = batchStart + batchIndex;
          const originalIndex = testMode ? i : scenes.indexOf(scene);
          
          try {
            const { data, error } = await supabase.functions.invoke("generate-prompts", {
              body: { 
                scene: scene.text,
                summary,
                examplePrompts: filteredPrompts,
                sceneIndex: originalIndex + 1,
                totalScenes: scenes.length,
                startTime: scene.startTime,
                endTime: scene.endTime
              },
            });

            if (error) throw error;

            return {
              scene: `Scène ${originalIndex + 1} (${formatTimecode(scene.startTime)} - ${formatTimecode(scene.endTime)})`,
              prompt: data.prompt,
              text: scene.text,
              startTime: scene.startTime,
              endTime: scene.endTime,
              duration: scene.endTime - scene.startTime
            };
          } catch (sceneError: any) {
            console.error(`Error generating prompt for scene ${originalIndex + 1}:`, sceneError);
            return {
              scene: `Scène ${originalIndex + 1} (${formatTimecode(scene.startTime)} - ${formatTimecode(scene.endTime)})`,
              prompt: "Erreur lors de la génération",
              text: scene.text,
              startTime: scene.startTime,
              endTime: scene.endTime,
              duration: scene.endTime - scene.startTime
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        prompts.push(...batchResults);
        setGeneratedPrompts([...prompts]);
      }

      if (!cancelGenerationRef.current) {
        toast.success(`${sceneCount} prompts générés avec succès !`);
      }
    } catch (error: any) {
      console.error("Error generating prompts:", error);
      toast.error(error.message || "Erreur lors de la génération des prompts");
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  const regenerateSinglePrompt = async (sceneIndex: number) => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    setRegeneratingPromptIndex(sceneIndex);
    
    try {
      // Get the project to retrieve the summary
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("summary")
        .eq("id", currentProjectId)
        .single();

      if (projectError) throw projectError;

      let summary = projectData?.summary;

      // If no summary exists, generate one
      if (!summary) {
        const fullTranscript = transcriptData?.segments.map(seg => seg.text).join(' ') || '';
        const { data: summaryData, error: summaryError } = await supabase.functions.invoke('generate-summary', {
          body: { transcript: fullTranscript }
        });

        if (summaryError) throw summaryError;
        
        summary = summaryData.summary;
        
        // Save the summary for future use
        await supabase
          .from("projects")
          .update({ summary })
          .eq("id", currentProjectId);
      }

      const scene = scenes[sceneIndex];
      const filteredPrompts = examplePrompts.filter(p => p.trim() !== "");

      const { data, error } = await supabase.functions.invoke("generate-prompts", {
        body: { 
          scene: scene.text,
          summary,
          examplePrompts: filteredPrompts,
          sceneIndex: sceneIndex + 1,
          totalScenes: scenes.length,
          startTime: scene.startTime,
          endTime: scene.endTime
        },
      });

      if (error) throw error;

      // Update the prompt in the array using functional update to avoid race conditions
      setGeneratedPrompts(prev => {
        const updatedPrompts = [...prev];
        updatedPrompts[sceneIndex] = {
          ...updatedPrompts[sceneIndex],
          prompt: data.prompt,
        };
        return updatedPrompts;
      });

      toast.success("Prompt régénéré !");
    } catch (error: any) {
      console.error("Error regenerating prompt:", error);
      toast.error(error.message || "Erreur lors de la régénération");
    } finally {
      setRegeneratingPromptIndex(null);
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
    switch (ratio) {
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
        setImageWidth(1920);
        setImageHeight(1440);
        break;
      case "custom":
        // Keep current values
        break;
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
      setStyleReferenceUrl(publicUrl);
      toast.success("Image de style uploadée !");
    } catch (error: any) {
      console.error("Error uploading style image:", error);
      toast.error(error.message || "Erreur lors de l'upload de l'image");
    } finally {
      setIsUploadingStyleImage(false);
    }
  };

  const generateImage = async (index: number) => {
    const prompt = generatedPrompts[index];
    if (!prompt) {
      toast.error("Aucun prompt disponible pour cette scène");
      return;
    }

    setGeneratingImageIndex(index);
    try {
      const requestBody: any = {
        prompt: prompt.prompt,
        width: imageWidth,
        height: imageHeight
      };

      // Add style reference if provided
      if (styleReferenceUrl.trim()) {
        requestBody.image_urls = [styleReferenceUrl.trim()];
      }

      const { data, error } = await supabase.functions.invoke('generate-image-seedream', {
        body: requestBody
      });

      if (error) throw error;

      const imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      
      setGeneratedPrompts(prev => {
        const updatedPrompts = [...prev];
        updatedPrompts[index] = { ...updatedPrompts[index], imageUrl };
        return updatedPrompts;
      });
      
      toast.success("Image générée !");
    } catch (error: any) {
      console.error("Error generating image:", error);
      toast.error(error.message || "Erreur lors de la génération de l'image");
    } finally {
      setGeneratingImageIndex(null);
    }
  };

  const generateAllImages = async () => {
    if (generatedPrompts.length === 0) {
      toast.error("Veuillez d'abord générer les prompts");
      return;
    }

    setIsGeneratingImages(true);
    let successCount = 0;

    for (let i = 0; i < generatedPrompts.length; i++) {
      try {
        const prompt = generatedPrompts[i];
        
        toast.info(`Génération de l'image ${i + 1}/${generatedPrompts.length}...`);

        const requestBody: any = {
          prompt: prompt.prompt,
          width: imageWidth,
          height: imageHeight
        };

        // Add style reference if provided
        if (styleReferenceUrl.trim()) {
          requestBody.image_urls = [styleReferenceUrl.trim()];
        }

        const { data, error } = await supabase.functions.invoke('generate-image-seedream', {
          body: requestBody
        });

        if (error) throw error;

        const imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;
        
        setGeneratedPrompts(prev => {
          const updated = [...prev];
          updated[i] = { ...updated[i], imageUrl };
          return updated;
        });

        successCount++;
      } catch (error: any) {
        console.error(`Error generating image ${i + 1}:`, error);
        toast.error(`Erreur image ${i + 1}: ${error.message}`);
      }
    }

    setIsGeneratingImages(false);
    toast.success(`${successCount}/${generatedPrompts.length} images générées !`);
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
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Sparkles className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">
                {currentProjectId && projectName ? projectName : "Générateur de Prompts"}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" asChild>
                <Link to="/projects">
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Mes projets
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Déconnexion
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
          <div className="space-y-6">
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
                  <h2 className="text-lg font-semibold mb-4">2. Configurer les scènes</h2>
                  <div className="space-y-4">
                    <div className="space-y-4">
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

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Durée 0-1min (sec)
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="60"
                          value={sceneDuration0to1}
                          onChange={(e) => setSceneDuration0to1(parseInt(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Durée 1-3min (sec)
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="180"
                          value={sceneDuration1to3}
                          onChange={(e) => setSceneDuration1to3(parseInt(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Durée 3min+ (sec)
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="600"
                          value={sceneDuration3plus}
                          onChange={(e) => setSceneDuration3plus(parseInt(e.target.value))}
                        />
                      </div>
                    </div>

                    <Button
                      onClick={handleGenerateScenes}
                      disabled={!transcriptFile || isGeneratingScenes}
                      className="w-full"
                    >
                      {isGeneratingScenes ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Génération des scènes...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Générer les scènes
                        </>
                      )}
                    </Button>
                  </div>
                </Card>

                {scenes.length > 0 && (
                  <Card className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">
                          Scènes générées ({scenes.length})
                          {generatedPrompts.length > 0 && ` - ${generatedPrompts.length} prompts`}
                        </h2>
                        <div className="flex gap-2 items-center">
                          <Button
                            onClick={() => handleGeneratePrompts(true)}
                            disabled={isGeneratingPrompts}
                            variant="outline"
                            size="sm"
                          >
                            {isGeneratingPrompts ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Test...
                              </>
                            ) : (
                              <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Tester (15 premières)
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => handleGeneratePrompts(false)}
                            disabled={isGeneratingPrompts}
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
                          {isGeneratingPrompts && (
                            <Button
                              onClick={() => {
                                cancelGenerationRef.current = true;
                                toast.info("Annulation en cours...");
                              }}
                              variant="destructive"
                            >
                              Annuler
                            </Button>
                          )}
                        </div>
                      </div>

                      {generatedPrompts.length > 0 && (
                        <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                          <div className="space-y-3">
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
                                  value={styleReferenceUrl}
                                  onChange={(e) => setStyleReferenceUrl(e.target.value)}
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

                            <div className="flex items-center gap-4 flex-wrap">
                              <div className="flex items-center gap-2">
                                <label className="text-sm font-medium">Format:</label>
                                <Select value={aspectRatio} onValueChange={handleAspectRatioChange}>
                                  <SelectTrigger className="w-40">
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
                              
                              <div className="flex items-center gap-2">
                                <label className="text-sm font-medium">Largeur:</label>
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
                                  className="w-24"
                                />
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <label className="text-sm font-medium">Hauteur:</label>
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
                                  className="w-24"
                                />
                              </div>
                              
                              <span className="text-xs text-muted-foreground">
                                ({imageWidth}x{imageHeight}px)
                              </span>
                            </div>
                          </div>
                          
                          <Button
                            onClick={generateAllImages}
                            disabled={isGeneratingImages}
                            variant="default"
                            className="w-full"
                          >
                            {isGeneratingImages ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Génération des images...
                              </>
                            ) : (
                              <>
                                <ImageIcon className="mr-2 h-4 w-4" />
                                Générer toutes les images ({imageWidth}x{imageHeight})
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Timing</TableHead>
                            <TableHead>Durée</TableHead>
                            <TableHead>Texte de la scène</TableHead>
                            <TableHead>Prompt</TableHead>
                            <TableHead className="w-32">Image</TableHead>
                            <TableHead className="w-24">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {scenes.map((scene, index) => {
                            const prompt = generatedPrompts.find((p, i) => i === index);
                            return (
                              <TableRow key={index}>
                                <TableCell className="font-semibold">{index + 1}</TableCell>
                                <TableCell className="text-xs whitespace-nowrap">
                                  {formatTimecode(scene.startTime)} - {formatTimecode(scene.endTime)}
                                </TableCell>
                                <TableCell className="text-xs whitespace-nowrap">
                                  {(scene.endTime - scene.startTime).toFixed(1)}s
                                </TableCell>
                                <TableCell className="max-w-xs">
                                  <p className="text-sm line-clamp-3">{scene.text}</p>
                                </TableCell>
                                <TableCell className="max-w-md">
                                  {prompt ? (
                                    <div className="group relative">
                                      <p className="text-sm">{prompt.prompt}</p>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => setConfirmRegeneratePrompt(index)}
                                        disabled={regeneratingPromptIndex === index}
                                        title="Régénérer le prompt"
                                      >
                                        {regeneratingPromptIndex === index ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <RefreshCw className="h-3 w-3" />
                                        )}
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic">
                                      Pas encore généré
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {prompt?.imageUrl ? (
                                    <div className="group relative">
                                      <img 
                                        src={prompt.imageUrl} 
                                        alt={`Scene ${index + 1}`}
                                        className="w-24 h-24 object-cover rounded cursor-pointer hover:opacity-80 transition"
                                        onClick={() => window.open(prompt.imageUrl, '_blank')}
                                        title="Cliquer pour agrandir"
                                      />
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
                                        onClick={() => setConfirmRegenerateImage(index)}
                                        disabled={generatingImageIndex === index}
                                        title="Régénérer l'image"
                                      >
                                        {generatingImageIndex === index ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <RefreshCw className="h-3 w-3" />
                                        )}
                                      </Button>
                                    </div>
                                  ) : prompt ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => generateImage(index)}
                                      disabled={generatingImageIndex === index}
                                      title="Générer l'image de cette scène"
                                    >
                                      {generatingImageIndex === index ? (
                                        <>
                                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                          <span className="text-xs">Génération...</span>
                                        </>
                                      ) : (
                                        <>
                                          <ImageIcon className="h-4 w-4 mr-1" />
                                          <span className="text-xs">Générer</span>
                                        </>
                                      )}
                                    </Button>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  {prompt && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => copyToClipboard(prompt.prompt, index)}
                                    >
                                      {copiedIndex === index ? (
                                        <Check className="h-4 w-4 text-green-500" />
                                      ) : (
                                        <Copy className="h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                )}
              </div>
          )}
        </div>

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
      </div>
  );
};

export default Index;
