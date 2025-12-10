import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Sparkles, ArrowLeft, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ThumbnailGenerator } from "@/components/ThumbnailGenerator";

const StandaloneThumbnails = () => {
  const navigate = useNavigate();
  const [videoTitle, setVideoTitle] = useState("");
  const [videoScript, setVideoScript] = useState("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
  }, [navigate]);

  // Use a unique virtual project ID for standalone thumbnails
  const [virtualProjectId] = useState(() => `standalone-${crypto.randomUUID()}`);

  const handleStart = () => {
    if (videoTitle.trim() && videoScript.trim()) {
      setIsReady(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                VidéoFlow
              </span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-semibold">Générateur de miniatures</h1>
          </div>
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
        </div>
      </header>

      <div className="container py-8 max-w-5xl">
        {!isReady ? (
          <div className="space-y-6">
            <div className="text-center space-y-2 mb-8">
              <h2 className="text-3xl font-bold">Générer des miniatures</h2>
              <p className="text-muted-foreground">
                Entrez le titre et le script de votre vidéo pour générer des miniatures avec vos presets
              </p>
            </div>

            <Card className="p-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Titre de la vidéo</Label>
                <Input
                  id="title"
                  placeholder="Ex: 10 conseils pour réussir sur YouTube"
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="script">Script / Contenu de la vidéo</Label>
                <Textarea
                  id="script"
                  placeholder="Collez ici le script ou le contenu principal de votre vidéo..."
                  value={videoScript}
                  onChange={(e) => setVideoScript(e.target.value)}
                  className="min-h-[300px]"
                />
                <p className="text-xs text-muted-foreground">
                  Le script sera utilisé pour générer des miniatures pertinentes au contenu
                </p>
              </div>

              <Button
                onClick={handleStart}
                disabled={!videoTitle.trim() || !videoScript.trim()}
                size="lg"
                className="w-full"
              >
                <ImageIcon className="h-5 w-5 mr-2" />
                Continuer vers la génération
              </Button>
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">{videoTitle}</h2>
                <p className="text-muted-foreground text-sm">
                  {videoScript.length} caractères de script
                </p>
              </div>
              <Button variant="outline" onClick={() => setIsReady(false)}>
                Modifier le script
              </Button>
            </div>

            <ThumbnailGenerator
              projectId={virtualProjectId}
              videoScript={videoScript}
              videoTitle={videoTitle}
              standalone={true}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default StandaloneThumbnails;
