import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppHeader from "@/components/AppHeader";
import { AudioTTSGenerator } from "@/components/AudioTTSGenerator";
import { Qwen3TTSGenerator } from "@/components/Qwen3TTSGenerator";
import { supabase } from "@/integrations/supabase/client";

const StandaloneAudio = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Audio TTS Generator";
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) navigate("/auth");
    };
    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <AppHeader />
      <div className="container max-w-3xl py-8 px-4">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Accueil
            </Link>
          </Button>
        </div>
        <Tabs defaultValue="gemini" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="gemini">Gemini TTS</TabsTrigger>
            <TabsTrigger value="qwen3">Qwen3 TTS</TabsTrigger>
          </TabsList>
          <TabsContent value="gemini">
            <AudioTTSGenerator />
          </TabsContent>
          <TabsContent value="qwen3">
            <Qwen3TTSGenerator />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default StandaloneAudio;
