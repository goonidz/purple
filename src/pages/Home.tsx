import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { History, Sparkles, Calendar, Mic, FileText, ImageIcon, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";

const Home = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Accueil";
  }, []);

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
      <AppHeader />

      {/* Hero Section */}
      <div className="container flex flex-col items-center justify-center py-20 px-4">
        <div className="text-center space-y-4 mb-12 max-w-2xl">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Créez des vidéos captivantes
          </h1>
          <p className="text-xl text-muted-foreground">
            Générez automatiquement des vidéos à partir d'un fichier audio ou créez tout de zéro avec l'IA
          </p>
        </div>

        {/* Main Action Cards - Two creation options */}
        <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl mb-8">
          <Link to="/project" className="group">
            <Card className="p-8 hover:shadow-xl transition-all duration-300 hover:scale-105 border-2 hover:border-primary/50 bg-card/50 backdrop-blur h-full">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Mic className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-2xl font-bold">À partir d'un audio</h3>
                <p className="text-muted-foreground">
                  Importez votre fichier audio (MP3, WAV) et laissez l'IA transcrire et générer les scènes automatiquement
                </p>
                <Button size="lg" className="w-full mt-4">
                  Importer un audio
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Card>
          </Link>

          <Link to="/create-from-scratch" className="group">
            <Card className="p-8 hover:shadow-xl transition-all duration-300 hover:scale-105 border-2 hover:border-secondary/50 bg-card/50 backdrop-blur h-full">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-20 w-20 rounded-full bg-secondary/10 flex items-center justify-center group-hover:bg-secondary/20 transition-colors">
                  <FileText className="h-10 w-10 text-secondary-foreground" />
                </div>
                <h3 className="text-2xl font-bold">Créer de zéro</h3>
                <p className="text-muted-foreground">
                  Générez un script avec Claude IA, puis l'audio avec ElevenLabs, et enfin les images automatiquement
                </p>
                <Button size="lg" variant="secondary" className="w-full mt-4">
                  Commencer de zéro
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Card>
          </Link>
        </div>

        {/* Secondary Action Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl">
          <Link to="/thumbnails" className="group">
            <Card className="p-6 hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-primary/30 bg-card/30 backdrop-blur h-full">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <ImageIcon className="h-6 w-6 text-primary" />
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-bold">Miniatures</h3>
                  <p className="text-sm text-muted-foreground">
                    Générez des miniatures sans projet
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/calendar" className="group">
            <Card className="p-6 hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-primary/30 bg-card/30 backdrop-blur h-full">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-bold">Calendrier</h3>
                  <p className="text-sm text-muted-foreground">
                    Planifiez vos vidéos
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/competitors" className="group">
            <Card className="p-6 hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-primary/30 bg-card/30 backdrop-blur h-full">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-bold">Competitors</h3>
                  <p className="text-sm text-muted-foreground">
                    Analysez vos concurrents YouTube
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/projects" className="group">
            <Card className="p-6 hover:shadow-lg transition-all duration-300 hover:scale-105 border hover:border-primary/30 bg-card/30 backdrop-blur h-full">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
                  <History className="h-6 w-6 text-primary" />
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-bold">Mes projets</h3>
                  <p className="text-sm text-muted-foreground">
                    Historique des projets
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-4 gap-6 mt-16 w-full max-w-5xl">
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold text-primary">🎯</div>
            <h4 className="font-semibold">Claude IA</h4>
            <p className="text-sm text-muted-foreground">Génération de scripts intelligents</p>
          </div>
          <div className="text-center space-y-2">
            <div className="text-3xl font-bold text-primary">🎙️</div>
            <h4 className="font-semibold">ElevenLabs</h4>
            <p className="text-sm text-muted-foreground">Voix de synthèse réalistes</p>
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
