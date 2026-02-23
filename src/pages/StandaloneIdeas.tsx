import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { IdeaGenerator } from "@/components/IdeaGenerator";
import { supabase } from "@/integrations/supabase/client";

const StandaloneIdeas = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Idea Generator";
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
        <IdeaGenerator />
      </div>
    </div>
  );
};

export default StandaloneIdeas;
