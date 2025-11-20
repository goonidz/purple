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
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
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
import { Loader2, Sparkles, Copy, Check, Upload, LogOut, FolderOpen, Image as ImageIcon, RefreshCw, Settings, Download } from "lucide-react";
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
  const cancelImageGenerationRef = useRef(false);
  const [imageWidth, setImageWidth] = useState<number>(1920);
  const [imageHeight, setImageHeight] = useState<number>(1080);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
  const [generatingPromptIndex, setGeneratingPromptIndex] = useState<number | null>(null);
  const [styleReferenceUrl, setStyleReferenceUrl] = useState<string>("");
  const [uploadedStyleImageUrl, setUploadedStyleImageUrl] = useState<string>("");
  const [isUploadingStyleImage, setIsUploadingStyleImage] = useState(false);
  const [regeneratingPromptIndex, setRegeneratingPromptIndex] = useState<number | null>(null);
  const [confirmRegeneratePrompt, setConfirmRegeneratePrompt] = useState<number | null>(null);
  const [confirmRegenerateImage, setConfirmRegenerateImage] = useState<number | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [sceneSettingsOpen, setSceneSettingsOpen] = useState(false);
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  const [confirmGenerateImages, setConfirmGenerateImages] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("premiere-xml");
  const [exportMode, setExportMode] = useState<ExportMode>("with-images");
  const [exportFramerate, setExportFramerate] = useState<number>(25);
  const [isExporting, setIsExporting] = useState(false);

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
      toast.error(error.message || "Erreur lors de la régénération du prompt");
    } finally {
      setRegeneratingPromptIndex(null);
    }
  };

  const generateSinglePrompt = async (sceneIndex: number) => {
    if (!currentProjectId) {
      toast.error("Veuillez d'abord sélectionner ou créer un projet");
      return;
    }

    setGeneratingPromptIndex(sceneIndex);
    
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

      // Create new prompt object
      const newPrompt: GeneratedPrompt = {
        scene: `Scène ${sceneIndex + 1} (${formatTimecode(scene.startTime)} - ${formatTimecode(scene.endTime)})`,
        prompt: data.prompt,
        text: scene.text,
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration: scene.endTime - scene.startTime
      };

      // Insert the prompt at the correct index
      setGeneratedPrompts(prev => {
        const updatedPrompts = [...prev];
        updatedPrompts[sceneIndex] = newPrompt;
        return updatedPrompts;
      });

      toast.success("Prompt généré !");
    } catch (error: any) {
      console.error("Error generating prompt:", error);
      toast.error(error.message || "Erreur lors de la génération du prompt");
    } finally {
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

      const replicateUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      
      // Save image to Supabase Storage for permanent access
      const permanentUrl = await saveImageToStorage(replicateUrl, index);
      
      setGeneratedPrompts(prev => {
        const updatedPrompts = [...prev];
        updatedPrompts[index] = { ...updatedPrompts[index], imageUrl: permanentUrl };
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

  const generateAllImages = async (skipExisting: boolean = false) => {
    if (generatedPrompts.length === 0) {
      toast.error("Veuillez d'abord générer les prompts");
      return;
    }

    setIsGeneratingImages(true);
    cancelImageGenerationRef.current = false;
    let successCount = 0;
    let skippedCount = 0;

    // Filter prompts to process
    const promptsToProcess = generatedPrompts
      .map((prompt, index) => ({ prompt, index }))
      .filter(({ prompt }) => !skipExisting || !prompt.imageUrl);

    // Count skipped images
    skippedCount = generatedPrompts.length - promptsToProcess.length;

    // Process in batches of 20
    const batchSize = 20;
    for (let i = 0; i < promptsToProcess.length; i += batchSize) {
      if (cancelImageGenerationRef.current) {
        toast.info(`Génération annulée. ${successCount} images générées.`);
        break;
      }

      const batch = promptsToProcess.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(promptsToProcess.length / batchSize);
      
      toast.info(`Génération batch ${batchNumber}/${totalBatches} (${batch.length} images)...`);

      const batchPromises = batch.map(async ({ prompt, index }) => {
        // Function to generate single image with retry
        const generateWithRetry = async (retryCount = 0): Promise<{ success: boolean; index: number }> => {
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

            const replicateUrl = Array.isArray(data.output) ? data.output[0] : data.output;
            
            // Save image to Supabase Storage for permanent access
            const permanentUrl = await saveImageToStorage(replicateUrl, index);
            
            setGeneratedPrompts(prev => {
              const updated = [...prev];
              updated[index] = { ...updated[index], imageUrl: permanentUrl };
              return updated;
            });

            return { success: true, index };
          } catch (error: any) {
            // Retry once if it's the first attempt
            if (retryCount === 0 && error.message?.includes('interrupted')) {
              console.log(`Retry image ${index + 1} après interruption...`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
              return generateWithRetry(1);
            }
            
            console.error(`Error generating image ${index + 1}:`, error);
            toast.error(`Erreur image ${index + 1}: ${error.message}`);
            return { success: false, index };
          }
        };

        return generateWithRetry();
      });

      const results = await Promise.all(batchPromises);
      successCount += results.filter(r => r.success).length;
    }

    setIsGeneratingImages(false);
    
    // Check for missing images
    const missingCount = generatedPrompts.filter(p => !p.imageUrl).length;
    
    if (!cancelImageGenerationRef.current) {
      if (missingCount > 0) {
        toast.warning(`${successCount} images générées, ${skippedCount} conservées. ${missingCount} image(s) manquante(s).`);
      } else if (skippedCount > 0) {
        toast.success(`${successCount} images générées, ${skippedCount} conservées !`);
      } else {
        toast.success(`${successCount}/${generatedPrompts.length} images générées !`);
      }
    }
  };

  const handleExport = async () => {
    if (generatedPrompts.length === 0) {
      toast.error("Aucune donnée à exporter");
      return;
    }

    // Check for missing images and show alert
    const missingImages = generatedPrompts.filter(p => !p.imageUrl);
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
      const options = {
        format: exportFormat,
        mode: exportMode,
        projectName: projectName || "projet_sans_nom",
        framerate: exportFramerate,
        width: imageWidth,
        height: imageHeight
      };

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
      }

      if (exportMode === "with-images") {
        toast.info("Préparation du ZIP avec les images...");
        await downloadImagesAsZip(generatedPrompts, content, filename);
        toast.success("Export ZIP téléchargé avec succès !");
      } else {
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

                <div className="grid grid-cols-3 gap-6">
                  {/* Configuration des scènes */}
                  <Card className="p-6">
                    <h2 className="text-lg font-semibold mb-4">2. Configurer les scènes</h2>
                    <div className="space-y-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Durée max (0-1 min):</span>
                          <span className="font-medium">{sceneDuration0to1}s</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Durée max (1-3 min):</span>
                          <span className="font-medium">{sceneDuration1to3}s</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Durée max (3+ min):</span>
                          <span className="font-medium">{sceneDuration3plus}s</span>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => setSceneSettingsOpen(true)}
                        className="w-full"
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Modifier les paramètres
                      </Button>

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

                  {/* Configuration des prompts */}
                  <Card className="p-6">
                    <h2 className="text-lg font-semibold mb-4">3. Configurer les prompts</h2>
                    <div className="space-y-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Exemples de prompts:</span>
                          <span className="font-medium">{examplePrompts.filter(p => p.trim()).length}/3</span>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => setPromptSettingsOpen(true)}
                        className="w-full"
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Modifier les paramètres
                      </Button>

                      <Button
                        onClick={() => handleGeneratePrompts()}
                        disabled={scenes.length === 0 || isGeneratingPrompts}
                        className="w-full"
                      >
                        {isGeneratingPrompts ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Génération des prompts...
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Générer les prompts
                          </>
                        )}
                      </Button>
                    </div>
                  </Card>

                  {/* Configuration des images */}
                  <Card className="p-6">
                    <h2 className="text-lg font-semibold mb-4">4. Configurer les images</h2>
                    <div className="space-y-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Résolution:</span>
                          <span className="font-medium">{imageWidth}x{imageHeight}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Format:</span>
                          <span className="font-medium">{aspectRatio === "custom" ? "Personnalisé" : aspectRatio}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t">
                          <span className="text-muted-foreground">Référence de style:</span>
                          <span className="font-medium">{styleReferenceUrl ? "✓ Définie" : "Non définie"}</span>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => setImageSettingsOpen(true)}
                        className="w-full"
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Modifier les paramètres
                      </Button>

                      {generatedPrompts.length > 0 && (
                        <>
                          <Button
                            onClick={() => setConfirmGenerateImages(true)}
                            disabled={isGeneratingImages}
                            className="w-full"
                          >
                            {isGeneratingImages ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Génération...
                              </>
                            ) : (
                              <>
                                <ImageIcon className="mr-2 h-4 w-4" />
                                Générer toutes les images
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.multiple = true;
                              input.onchange = (e) => {
                                const files = (e.target as HTMLInputElement).files;
                                if (files && files.length > 0) {
                                  uploadMultipleImages(files);
                                }
                              };
                              input.click();
                            }}
                            variant="outline"
                            disabled={isGeneratingImages}
                            className="w-full"
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            Importer toutes les images
                          </Button>
                          {isGeneratingImages && (
                            <Button
                              onClick={() => {
                                cancelImageGenerationRef.current = true;
                                toast.info("Annulation en cours...");
                              }}
                              variant="destructive"
                              className="w-full"
                            >
                              Annuler
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </Card>
                </div>

                {scenes.length > 0 && (
                  <Card className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">
                          Scènes générées ({scenes.length})
                          {generatedPrompts.length > 0 && ` - ${generatedPrompts.length} prompts`}
                        </h2>
                        <div className="flex gap-2 items-center">
                          {generatedPrompts.length > 0 && generatedPrompts.filter(p => p.imageUrl).length > 0 && (
                            <Button
                              onClick={() => setExportDialogOpen(true)}
                              variant="outline"
                              size="sm"
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Exporter pour montage
                            </Button>
                          )}
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
                                        className={`absolute top-0 right-0 bg-background/80 hover:bg-background transition-all ${
                                          regeneratingPromptIndex === index 
                                            ? 'opacity-100' 
                                            : 'opacity-0 group-hover:opacity-100'
                                        }`}
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
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => generateSinglePrompt(index)}
                                      disabled={generatingPromptIndex === index}
                                      title="Générer le prompt de cette scène"
                                    >
                                      {generatingPromptIndex === index ? (
                                        <>
                                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                          <span className="text-xs">Génération...</span>
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="h-4 w-4 mr-1" />
                                          <span className="text-xs">Générer</span>
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {prompt?.imageUrl ? (
                                    <div className="group relative">
                                      <img 
                                        src={prompt.imageUrl} 
                                        alt={`Scene ${index + 1}`}
                                        className="w-24 h-24 object-cover rounded cursor-pointer hover:opacity-80 transition"
                                        onClick={() => setImagePreviewUrl(prompt.imageUrl || null)}
                                        title="Cliquer pour agrandir"
                                      />
                                      <div className="absolute top-1 right-1 flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="bg-background/80 hover:bg-background opacity-0 group-hover:opacity-100 transition-all"
                                          onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = 'image/*';
                                            input.onchange = (e) => {
                                              const file = (e.target as HTMLInputElement).files?.[0];
                                              if (file) uploadManualImage(file, index);
                                            };
                                            input.click();
                                          }}
                                          disabled={generatingImageIndex === index}
                                          title="Importer une image"
                                        >
                                          <Upload className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className={`bg-background/80 hover:bg-background transition-all ${
                                            generatingImageIndex === index 
                                              ? 'opacity-100' 
                                              : 'opacity-0 group-hover:opacity-100'
                                          }`}
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
                                    </div>
                                  ) : prompt ? (
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'image/*';
                                          input.onchange = (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file) uploadManualImage(file, index);
                                          };
                                          input.click();
                                        }}
                                        disabled={generatingImageIndex === index}
                                        title="Importer une image"
                                      >
                                        <Upload className="h-4 w-4 mr-1" />
                                        <span className="text-xs">Importer</span>
                                      </Button>
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
                                    </div>
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

        {/* Image preview dialog */}
        <Dialog open={imagePreviewUrl !== null} onOpenChange={(open) => !open && setImagePreviewUrl(null)}>
          <DialogContent className="max-w-5xl max-h-[90vh] p-0">
            {imagePreviewUrl && (
              <img 
                src={imagePreviewUrl} 
                alt="Aperçu" 
                className="w-full h-full object-contain rounded-lg"
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Scene settings dialog */}
        <Dialog open={sceneSettingsOpen} onOpenChange={setSceneSettingsOpen}>
          <DialogContent className="max-w-2xl">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Paramètres de scènes</h3>
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

              <div className="flex justify-end">
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

              <div className="space-y-4">
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
                  const existingImagesCount = generatedPrompts.filter(p => p.imageUrl).length;
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
                        {styleReferenceUrl && (
                          <div className="flex justify-between">
                            <span className="font-medium">Référence de style :</span>
                            <span className="text-xs text-primary">Activée</span>
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
              {generatedPrompts.filter(p => p.imageUrl).length > 0 && (
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
                {generatedPrompts.filter(p => p.imageUrl).length > 0 ? "Tout régénérer" : "Générer"}
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
      </div>
  );
};

export default Index;
