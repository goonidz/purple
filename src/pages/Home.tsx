import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Video, History, Sparkles, Image } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Home = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              VidéoFlow
            </span>
          </div>
          <Link to="/projects">
            <Button variant="ghost" size="sm">
              Mes projets
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <div className="container flex flex-col items-center justify-center py-20 px-4">
        <div className="text-center space-y-4 mb-12 max-w-2xl">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Transformez votre audio en vidéo
          </h1>
          <p className="text-xl text-muted-foreground">
            Créez des vidéos captivantes automatiquement à partir de vos fichiers audio
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid md:grid-cols-3 gap-6 w-full max-w-5xl">
          <Link to="/workspace" className="group">
            <Card className="p-8 hover:shadow-lg transition-all duration-300 hover:scale-105 border-2 hover:border-primary/50 bg-card/50 backdrop-blur">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Video className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold">Créer une vidéo</h3>
                <p className="text-muted-foreground">
                  Importez un fichier audio et générez automatiquement votre vidéo avec scènes et images
                </p>
                <Button size="lg" className="w-full mt-4">
                  Commencer
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Card>
          </Link>

          <Link to="/thumbnail-creator" className="group">
            <Card className="p-8 hover:shadow-lg transition-all duration-300 hover:scale-105 border-2 hover:border-primary/50 bg-card/50 backdrop-blur">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Image className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold">Créer une miniature</h3>
                <p className="text-muted-foreground">
                  Générez des miniatures YouTube professionnelles avec l'IA
                </p>
                <Button size="lg" className="w-full mt-4">
                  Créer
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Card>
          </Link>

          <Link to="/projects" className="group">
            <Card className="p-8 hover:shadow-lg transition-all duration-300 hover:scale-105 border-2 hover:border-primary/50 bg-card/50 backdrop-blur">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <History className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-2xl font-bold">Mes projets</h3>
                <p className="text-muted-foreground">
                  Accédez à l'historique de tous vos projets vidéo et continuez où vous vous êtes arrêté
                </p>
                <Button size="lg" variant="outline" className="w-full mt-4">
                  Voir l'historique
                </Button>
              </div>
            </Card>
          </Link>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mt-16 w-full max-w-4xl">
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold text-primary">🎯</div>
            <h4 className="font-semibold">IA Puissante</h4>
            <p className="text-sm text-muted-foreground">Génération automatique de scènes et prompts</p>
          </div>
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold text-primary">⚡</div>
            <h4 className="font-semibold">Rapide</h4>
            <p className="text-sm text-muted-foreground">Création de vidéos en quelques minutes</p>
          </div>
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold text-primary">🎨</div>
            <h4 className="font-semibold">Personnalisable</h4>
            <p className="text-sm text-muted-foreground">Presets et styles selon vos besoins</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
