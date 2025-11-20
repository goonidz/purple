import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Loader2, Settings, Play, Download, Video, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SceneSidebar } from "@/components/SceneSidebar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimelineBar } from "@/components/TimelineBar";
import { VideoPreview } from "@/components/VideoPreview";
import { SubtitleControls } from "@/components/SubtitleControls";
import { ThumbnailGenerator } from "@/components/ThumbnailGenerator";
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
  const [showPreview, setShowPreview] = useState(false);
  const [autoPlayPreview, setAutoPlayPreview] = useState(false);
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

  const loadProjectData = async (projectId: string) => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;

      setProjectName(data.name || "");
      setGeneratedPrompts((data.prompts as unknown as GeneratedPrompt[]) || []);
      if (data.audio_url) {
        setAudioUrl(data.audio_url);
      }
      
      // Load image dimensions and aspect ratio
      if (data.image_width) setImageWidth(data.image_width);
      if (data.image_height) setImageHeight(data.image_height);
      if (data.aspect_ratio) setAspectRatio(data.aspect_ratio);
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
          prompts: generatedPrompts as any,
          audio_url: audioUrl || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;
    } catch (error: any) {
      console.error("Error saving project:", error);
    }
  };

  // Auto-save
  useEffect(() => {
    if (currentProjectId && generatedPrompts.length > 0) {
      const timeoutId = setTimeout(() => {
        saveProjectData();
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [currentProjectId, generatedPrompts, audioUrl]);

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

  const handlePlayPreview = () => {
    setShowPreview(true);
    setAutoPlayPreview(true);
  };

  const handleExport = () => {
    navigate(`/?project=${currentProjectId}`);
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
  const canShowPreview = audioUrl && hasAllImages;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-background/80 backdrop-blur-sm">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/projects")}
            >
              ← Projets
            </Button>
            <h1 className="text-lg font-semibold">{projectName}</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mr-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                Video duration: {generatedPrompts.reduce((acc, p) => acc + p.duration, 0).toFixed(1)}s
              </span>
            </div>

            {activeTab === "video" && canShowPreview && (
              <>
                <Button
                  onClick={handlePlayPreview}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Play
                </Button>
                {showPreview && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowPreview(false);
                      setAutoPlayPreview(false);
                    }}
                  >
                    Fermer la preview
                  </Button>
                )}
              </>
            )}
            
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
                  disabled={isExportingVideo || !canShowPreview}
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

              {/* Right side - Preview */}
              {showPreview && canShowPreview && (
                <div className="flex-1 flex overflow-hidden border-l">
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-auto">
                      <div className="p-6">
                        <VideoPreview 
                          audioUrl={audioUrl} 
                          prompts={generatedPrompts}
                          autoPlay={autoPlayPreview}
                          startFromScene={0}
                          subtitleSettings={subtitleSettings}
                          onSubtitleSettingsChange={setSubtitleSettings}
                        />
                      </div>
                    </div>

                    {/* Right sidebar - Subtitle controls */}
                    <div className="w-[320px] border-l flex-shrink-0">
                      <SubtitleControls
                        settings={subtitleSettings}
                        onChange={setSubtitleSettings}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="thumbnails" className="flex-1 overflow-auto m-0">
            <div className="p-6">
              <div className="max-w-5xl mx-auto">
                <ThumbnailGenerator
                  projectId={currentProjectId || ""}
                  videoScript={generatedPrompts.map(p => p.text).join(" ")}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Workspace;
