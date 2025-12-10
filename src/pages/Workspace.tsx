import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Loader2, Settings, Download, Video, Image as ImageIcon, Sparkles, Pencil, MonitorPlay, Trash2, Hash, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SceneSidebar } from "@/components/SceneSidebar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimelineBar } from "@/components/TimelineBar";
import { ThumbnailGenerator } from "@/components/ThumbnailGenerator";
import { YouTubeTester } from "@/components/YouTubeTester";
import { TagGenerator } from "@/components/TagGenerator";
import { toast } from "sonner";
import { exportToVideo } from "@/lib/videoExportHelpers";

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

const Workspace = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [imageWidth, setImageWidth] = useState<number>(1920);
  const [imageHeight, setImageHeight] = useState<number>(1080);
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [isGeneratingImage, setIsGeneratingImage] = useState<number | null>(null);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState<number | null>(null);
  const [subtitleSettings, setSubtitleSettings] = useState({
    enabled: true,
    fontSize: 18,
    fontFamily: 'Arial, sans-serif',
    color: '#ffffff',
    backgroundColor: '#000000',
    opacity: 0.8,
    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
    x: 50,
    y: 85
  });
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<string>("video");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [transcriptText, setTranscriptText] = useState<string>("");

  // Check authentication
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
    } else {
      navigate("/projects");
    }
  }, [searchParams, navigate]);

  // Load project data
  useEffect(() => {
    if (currentProjectId) {
      loadProjectData(currentProjectId);
    }
  }, [currentProjectId]);

  // Poll for project updates to refresh images in real-time
  useEffect(() => {
    if (!currentProjectId) return;

    let lastPromptsHash = JSON.stringify(generatedPrompts.map(p => p.imageUrl));

    const pollInterval = setInterval(async () => {
      try {
        // Refresh prompts to get new images
        const { data: projectData } = await supabase
          .from('projects')
          .select('prompts')
          .eq('id', currentProjectId)
          .single();

        if (projectData?.prompts) {
          const newPrompts = projectData.prompts as unknown as GeneratedPrompt[];
          const newHash = JSON.stringify(newPrompts.map(p => p.imageUrl));
          
          // Only update if images have changed
          if (newHash !== lastPromptsHash) {
            console.log('Images updated, refreshing UI');
            setGeneratedPrompts(newPrompts);
            lastPromptsHash = newHash;
          }
        }
      } catch (error) {
        console.error('Error polling for images:', error);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
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
      // It has a summary (script) but no audio_url and no transcript_json
      const hasScript = data.summary && data.summary.length > 100;
      const hasAudio = !!data.audio_url;
      const hasTranscript = data.transcript_json && Object.keys(data.transcript_json).length > 0;
      
      if (hasScript && !hasAudio && !hasTranscript) {
        // This is an incomplete "from scratch" project - redirect to continue
        navigate(`/create-from-scratch?continue=${projectId}`);
        return;
      }

      setProjectName(data.name || "");
      setGeneratedPrompts((data.prompts as unknown as GeneratedPrompt[]) || []);
      if (data.audio_url) {
        setAudioUrl(data.audio_url);
      }
      
      // Load image dimensions and aspect ratio
      if (data.image_width) setImageWidth(data.image_width);
      if (data.image_height) setImageHeight(data.image_height);
      if (data.aspect_ratio) setAspectRatio(data.aspect_ratio);
      
      // Extract transcript text from transcript_json
      if (data.transcript_json) {
        const transcriptData = data.transcript_json as { segments?: Array<{ text: string }> };
        if (transcriptData.segments) {
          const fullText = transcriptData.segments.map(s => s.text).join(' ');
          setTranscriptText(fullText);
        }
      }
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
          audio_url: audioUrl || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;
    } catch (error: any) {
      console.error("Error saving project:", error);
    }
  };

  // Auto-save (only audio_url, prompts are managed by backend)
  useEffect(() => {
    if (currentProjectId && audioUrl) {
      const timeoutId = setTimeout(() => {
        saveProjectData();
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [currentProjectId, audioUrl]);

  const handleStartEditName = () => {
    setEditedName(projectName);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!currentProjectId || !editedName.trim()) return;
    
    try {
      const { error } = await supabase
        .from("projects")
        .update({ name: editedName.trim() })
        .eq("id", currentProjectId);

      if (error) throw error;
      
      setProjectName(editedName.trim());
      setIsEditingName(false);
      toast.success("Titre mis à jour");
    } catch (error: any) {
      console.error("Error updating project name:", error);
      toast.error("Erreur lors de la mise à jour du titre");
    }
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedName("");
  };

  const handleRegenerateImage = async (sceneIndex: number) => {
    const prompt = generatedPrompts[sceneIndex];
    if (!prompt) {
      toast.error("Aucun prompt disponible pour cette scène");
      return;
    }

    setIsGeneratingImage(sceneIndex);
    try {
      const requestBody: any = {
        prompt: prompt.prompt,
        width: imageWidth,
        height: imageHeight
      };

      const { data, error } = await supabase.functions.invoke('generate-image-seedream', {
        body: requestBody
      });

      if (error) throw error;

      const replicateUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      
      // Save image to Supabase Storage for permanent access
      const response = await fetch(replicateUrl);
      if (!response.ok) throw new Error("Failed to download image");
      
      const blob = await response.blob();
      const timestamp = Date.now();
      const filename = `${currentProjectId}/scene_${sceneIndex + 1}_${timestamp}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(filename, blob, {
          contentType: 'image/jpeg',
          upsert: true
        });
      
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('generated-images')
        .getPublicUrl(filename);
      
      const updated = [...generatedPrompts];
      updated[sceneIndex] = { ...updated[sceneIndex], imageUrl: publicUrl };
      setGeneratedPrompts(updated);
      
      toast.success("Image régénérée !");
    } catch (error: any) {
      console.error("Error generating image:", error);
      toast.error(error.message || "Erreur lors de la génération de l'image");
    } finally {
      setIsGeneratingImage(null);
    }
  };

  const handleRegeneratePrompt = async (sceneIndex: number) => {
    setIsGeneratingPrompt(sceneIndex);
    // TODO: Implement prompt regeneration logic
    toast.info("Régénération de prompt à implémenter");
    setIsGeneratingPrompt(null);
  };

  const handleUploadImage = async (sceneIndex: number, file: File) => {
    setIsGeneratingImage(sceneIndex);
    try {
      if (!user) throw new Error("User not authenticated");

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}-scene-${sceneIndex}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('generated-images')
        .getPublicUrl(fileName);

      const updated = [...generatedPrompts];
      updated[sceneIndex] = { ...updated[sceneIndex], imageUrl: publicUrl };
      setGeneratedPrompts(updated);
      toast.success("Image uploadée !");
    } catch (error: any) {
      console.error("Error uploading image:", error);
      toast.error(error.message || "Erreur lors de l'upload de l'image");
    } finally {
      setIsGeneratingImage(null);
    }
  };

  const handleExport = () => {
    navigate(`/?project=${currentProjectId}`);
  };

  // TEMPORARY: Delete all images
  const handleDeleteAllImages = async () => {
    if (!currentProjectId || !user) return;
    
    const confirmed = window.confirm("Supprimer toutes les images ? Cette action est irréversible.");
    if (!confirmed) return;

    try {
      const clearedPrompts = generatedPrompts.map(p => ({
        ...p,
        imageUrl: undefined
      }));
      
      const { error } = await supabase
        .from('projects')
        .update({ prompts: clearedPrompts })
        .eq('id', currentProjectId);

      if (error) throw error;

      setGeneratedPrompts(clearedPrompts);
      toast.success("Toutes les images ont été supprimées");
    } catch (error: any) {
      console.error("Error deleting images:", error);
      toast.error("Erreur lors de la suppression des images");
    }
  };

  const handleVideoExport = async () => {
    if (!audioUrl) {
      toast.error("Aucun audio trouvé dans le projet");
      return;
    }

    const missingImages = generatedPrompts.filter(p => !p.imageUrl);
    if (missingImages.length > 0) {
      toast.error(`${missingImages.length} scène(s) n'ont pas d'image`);
      return;
    }

    setIsExportingVideo(true);
    setExportProgress(0);

    try {
      toast.info("Génération de la vidéo en cours...");
      
      await exportToVideo({
        scenes: generatedPrompts,
        audioUrl,
        subtitleSettings,
        width: imageWidth,
        height: imageHeight,
        framerate: 25,
        onProgress: (progress) => {
          setExportProgress(progress);
        }
      });

      toast.success("Vidéo exportée avec succès !");
    } catch (error: any) {
      console.error("Video export error:", error);
      toast.error("Erreur lors de l'export vidéo: " + error.message);
    } finally {
      setIsExportingVideo(false);
      setExportProgress(0);
    }
  };

  if (!user || !currentProjectId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (generatedPrompts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Aucune scène trouvée</p>
          <Button onClick={() => navigate(`/?project=${currentProjectId}`)}>
            Retour au projet
          </Button>
        </div>
      </div>
    );
  }

  const hasAllImages = generatedPrompts.every(p => p.imageUrl);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-background/80 backdrop-blur-sm">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                VidéoFlow
              </span>
            </Link>
            <span className="text-muted-foreground">/</span>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="h-8 w-64"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") handleCancelEditName();
                  }}
                />
                <Button size="sm" onClick={handleSaveName}>Enregistrer</Button>
                <Button size="sm" variant="ghost" onClick={handleCancelEditName}>Annuler</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-lg font-semibold">{projectName}</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={handleStartEditName}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mr-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                Video duration: {generatedPrompts.reduce((acc, p) => acc + p.duration, 0).toFixed(1)}s
              </span>
            </div>
            
            {activeTab === "video" && (
              <>
                <Button
                  variant="outline"
                  onClick={handleExport}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export XML
                </Button>

                <Button
                  onClick={handleVideoExport}
                  disabled={isExportingVideo || !audioUrl || !hasAllImages}
                >
                  {isExportingVideo ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {exportProgress > 0 ? `${Math.round(exportProgress)}%` : "Export..."}
                    </>
                  ) : (
                    <>
                      <Video className="mr-2 h-4 w-4" />
                      Export Vidéo
                    </>
                  )}
                </Button>

              </>
            )}

            {/* TEMPORARY: Delete all images button */}
            <Button
              variant="destructive"
              onClick={handleDeleteAllImages}
              title="TEMP: Supprimer toutes les images"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Suppr. images
            </Button>
            
            <Button variant="outline" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content with tabs */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="border-b px-6">
            <TabsList>
              <TabsTrigger value="video" className="flex items-center gap-2">
                <Video className="h-4 w-4" />
                Vidéo
              </TabsTrigger>
              <TabsTrigger value="thumbnails" className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Miniatures
              </TabsTrigger>
              <TabsTrigger value="test" className="flex items-center gap-2">
                <MonitorPlay className="h-4 w-4" />
                Test
              </TabsTrigger>
              <TabsTrigger value="tags" className="flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Tags
              </TabsTrigger>
              <TabsTrigger value="transcript" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Transcription
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="video" className="flex-1 flex overflow-hidden m-0">
            <div className="flex-1 flex overflow-hidden">
              {/* Scenes list */}
              <div className="flex-1 flex-shrink-0">
                <SceneSidebar
                  scenes={generatedPrompts}
                  selectedSceneIndex={0}
                  onSelectScene={() => {}}
                  onRegenerateImage={handleRegenerateImage}
                  onRegeneratePrompt={handleRegeneratePrompt}
                  onUploadImage={handleUploadImage}
                  isGeneratingImage={isGeneratingImage}
                  isGeneratingPrompt={isGeneratingPrompt}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="thumbnails" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              <div className="max-w-5xl mx-auto">
                <ThumbnailGenerator
                  projectId={currentProjectId || ""}
                  videoScript={generatedPrompts.map(p => p.text).join(" ")}
                  videoTitle={projectName}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="test" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              <div className="max-w-6xl mx-auto">
                <YouTubeTester
                  projectId={currentProjectId || ""}
                  videoTitle={projectName}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="tags" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              <div className="max-w-3xl mx-auto">
                <TagGenerator
                  projectId={currentProjectId || ""}
                  videoScript={generatedPrompts.map(p => p.text).join(" ")}
                  videoTitle={projectName}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="transcript" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              <div className="max-w-3xl mx-auto">
                <h2 className="text-xl font-semibold mb-4">Transcription</h2>
                {transcriptText ? (
                  <div className="bg-muted/50 rounded-lg p-6 border">
                    <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                      {transcriptText}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Aucune transcription disponible</p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Workspace;
