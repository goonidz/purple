import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, Check, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

const TestScenes = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  
  const [user, setUser] = useState<User | null>(null);
  const [testScenes, setTestScenes] = useState<GeneratedPrompt[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
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

  useEffect(() => {
    if (projectId && user) {
      loadTestScenes();
    }
  }, [projectId, user]);

  const loadTestScenes = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("name, prompts")
        .eq("id", projectId)
        .single();

      if (error) throw error;

      setProjectName(data.name);
      const prompts = Array.isArray(data.prompts) 
        ? (data.prompts as unknown as GeneratedPrompt[])
        : [];
      
      // Load only first 3 scenes for testing
      setTestScenes(prompts.slice(0, 3));
    } catch (error: any) {
      console.error("Error loading test scenes:", error);
      toast.error("Erreur lors du chargement des scènes de test");
    }
  };

  const generateTestImages = async () => {
    if (!projectId) return;

    setIsGenerating(true);
    try {
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("style_reference_url")
        .eq("id", projectId)
        .single();

      if (projectError) throw projectError;

      const styleReferenceUrl = projectData.style_reference_url || "";

      // Generate images for test scenes in parallel
      const generatePromises = testScenes.map(async (scene, index) => {
        try {
          const { data, error } = await supabase.functions.invoke("generate-image-seedream", {
            body: {
              prompt: scene.prompt,
              width: 1920,
              height: 1080,
              styleImageUrl: styleReferenceUrl,
            },
          });

          if (error) throw error;

          const imageUrl = data.output?.[0];
          if (!imageUrl) throw new Error("No image URL in response");

          // Download and upload to Supabase Storage
          const imageResponse = await fetch(imageUrl);
          const imageBlob = await imageResponse.blob();

          const timestamp = Date.now();
          const filename = `${projectId}/test_scene_${index + 1}_${timestamp}.jpg`;

          const { error: uploadError } = await supabase.storage
            .from("generated-images")
            .upload(filename, imageBlob, {
              cacheControl: "3600",
              upsert: true,
            });

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from("generated-images")
            .getPublicUrl(filename);

          return { ...scene, imageUrl: publicUrl };
        } catch (error: any) {
          console.error(`Error generating test image ${index + 1}:`, error);
          toast.error(`Erreur génération scène ${index + 1}`);
          return scene;
        }
      });

      const updatedScenes = await Promise.all(generatePromises);
      setTestScenes(updatedScenes);
      
      const successCount = updatedScenes.filter(s => s.imageUrl).length;
      toast.success(`${successCount}/3 images de test générées !`);
    } catch (error: any) {
      console.error("Error generating test images:", error);
      toast.error("Erreur lors de la génération des images de test");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleValidate = async () => {
    navigate(`/?project=${projectId}`);
    toast.success("Configuration validée ! Génération complète lancée.");
  };

  const handleReject = () => {
    navigate(`/?project=${projectId}`);
    toast.info("Retour aux paramètres");
  };

  if (!user || !projectId) {
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
              <Button variant="outline" size="sm" onClick={handleReject}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Retour
              </Button>
              <div>
                <h1 className="text-xl font-bold">{projectName}</h1>
                <p className="text-sm text-muted-foreground">Test des 3 premières scènes</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReject}>
                <X className="h-4 w-4 mr-2" />
                Modifier paramètres
              </Button>
              <Button onClick={handleValidate} disabled={!testScenes.every(s => s.imageUrl)}>
                <Check className="h-4 w-4 mr-2" />
                Valider et générer tout
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Card className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Vérification des paramètres</h2>
            <p className="text-muted-foreground">
              Générez les images des 3 premières scènes pour vérifier que les paramètres sont corrects
            </p>
          </div>

          {testScenes.length === 0 ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-muted-foreground">Chargement des scènes de test...</p>
            </div>
          ) : (
            <>
              <div className="grid gap-6 mb-8">
                {testScenes.map((scene, index) => (
                  <Card key={index} className="p-6">
                    <div className="flex gap-6">
                      <div className="flex-shrink-0 w-64 h-36 bg-muted rounded-lg overflow-hidden">
                        {scene.imageUrl ? (
                          <img
                            src={scene.imageUrl}
                            alt={`Scène ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Sparkles className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <h3 className="font-semibold">Scène {index + 1}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">{scene.text}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 italic">
                          {scene.prompt}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="flex justify-center">
                <Button
                  onClick={generateTestImages}
                  disabled={isGenerating || testScenes.every(s => s.imageUrl)}
                  size="lg"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Génération en cours...
                    </>
                  ) : testScenes.every(s => s.imageUrl) ? (
                    <>
                      <Check className="h-5 w-5 mr-2" />
                      Images générées
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5 mr-2" />
                      Générer les 3 images de test
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

export default TestScenes;
