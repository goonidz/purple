import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Loader2, Settings, Play, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SceneSidebar } from "@/components/SceneSidebar";
import { SceneEditor } from "@/components/SceneEditor";
import { TimelineBar } from "@/components/TimelineBar";
import { VideoPreview } from "@/components/VideoPreview";
import { toast } from "sonner";

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
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

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

  const handleUpdateScene = (updatedScene: GeneratedPrompt) => {
    const updated = [...generatedPrompts];
    updated[selectedSceneIndex] = updatedScene;
    setGeneratedPrompts(updated);
  };

  const handleRegenerateImage = async (sceneIndex: number) => {
    setIsGeneratingImage(true);
    // TODO: Implement image regeneration logic
    toast.info("Régénération d'image à implémenter");
    setIsGeneratingImage(false);
  };

  const handleRegeneratePrompt = async (sceneIndex: number) => {
    setIsGeneratingPrompt(true);
    // TODO: Implement prompt regeneration logic
    toast.info("Régénération de prompt à implémenter");
    setIsGeneratingPrompt(false);
  };

  const handleExport = () => {
    navigate(`/?project=${currentProjectId}`);
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
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                Scene duration: {generatedPrompts[selectedSceneIndex]?.duration.toFixed(1)}s
              </span>
              <span className="flex items-center gap-1 ml-4">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                Video duration: {generatedPrompts.reduce((acc, p) => acc + p.duration, 0).toFixed(1)}s
              </span>
            </div>

            {canShowPreview && (
              <Button
                variant="outline"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Play className="mr-2 h-4 w-4" />
                {showPreview ? "Masquer" : "Preview"}
              </Button>
            )}
            
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Exporter
            </Button>
            
            <Button variant="outline" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Scenes list */}
        <div className="w-[400px] flex-shrink-0">
          <SceneSidebar
            scenes={generatedPrompts}
            selectedSceneIndex={selectedSceneIndex}
            onSelectScene={setSelectedSceneIndex}
          />
        </div>

        {/* Center/Right - Preview & Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Preview area */}
          <div className="flex-1 overflow-auto">
            {showPreview && canShowPreview ? (
              <div className="p-6">
                <VideoPreview audioUrl={audioUrl} prompts={generatedPrompts} />
              </div>
            ) : (
              <div className="p-6">
                <div className="max-w-4xl mx-auto">
                  <SceneEditor
                    scene={generatedPrompts[selectedSceneIndex]}
                    sceneIndex={selectedSceneIndex}
                    onUpdate={handleUpdateScene}
                    onRegenerateImage={handleRegenerateImage}
                    onRegeneratePrompt={handleRegeneratePrompt}
                    isGeneratingImage={isGeneratingImage}
                    isGeneratingPrompt={isGeneratingPrompt}
                    userId={user.id}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Timeline at bottom */}
          <TimelineBar
            scenes={generatedPrompts}
            selectedSceneIndex={selectedSceneIndex}
            onSelectScene={setSelectedSceneIndex}
          />
        </div>
      </div>
    </div>
  );
};

export default Workspace;
