import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Key, LogOut, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [replicateApiKey, setReplicateApiKey] = useState("");
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState("");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (user) {
      loadApiKeys();
    }
  }, [user]);

  const loadApiKeys = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("*")
        .eq("user_id", user?.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setReplicateApiKey(data.replicate_api_key || "");
        setElevenLabsApiKey(data.eleven_labs_api_key || "");
      }
    } catch (error: any) {
      console.error("Error loading API keys:", error);
      toast.error("Erreur lors du chargement des clés API");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    if (!replicateApiKey.trim() || !elevenLabsApiKey.trim()) {
      toast.error("Veuillez remplir toutes les clés API");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("user_api_keys")
        .upsert({
          user_id: user.id,
          replicate_api_key: replicateApiKey.trim(),
          eleven_labs_api_key: elevenLabsApiKey.trim(),
        });

      if (error) throw error;

      toast.success("Clés API sauvegardées !");
    } catch (error: any) {
      console.error("Error saving API keys:", error);
      toast.error("Erreur lors de la sauvegarde des clés API");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => navigate("/projects")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour aux projets
          </Button>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </Button>
        </div>

        <Card className="p-8">
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold mb-2">Mon profil</h1>
              <p className="text-muted-foreground">
                Configurez vos clés API pour utiliser l'application
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Email</Label>
              <p className="text-base">{user.email}</p>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-6 pt-4 border-t">
                <div className="flex items-center gap-2 mb-4">
                  <Key className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-semibold">Clés API</h2>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="replicate-key">
                      Replicate API Key
                      <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input
                      id="replicate-key"
                      type="password"
                      value={replicateApiKey}
                      onChange={(e) => setReplicateApiKey(e.target.value)}
                      placeholder="r8_..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour générer les images avec SeedDream 4.{" "}
                      <a
                        href="https://replicate.com/account/api-tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="elevenlabs-key">
                      Eleven Labs API Key
                      <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input
                      id="elevenlabs-key"
                      type="password"
                      value={elevenLabsApiKey}
                      onChange={(e) => setElevenLabsApiKey(e.target.value)}
                      placeholder="sk_..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la transcription audio.{" "}
                      <a
                        href="https://elevenlabs.io/app/settings/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleSave}
                  disabled={isSaving || !replicateApiKey.trim() || !elevenLabsApiKey.trim()}
                  className="w-full"
                  size="lg"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sauvegarde...
                    </>
                  ) : (
                    "Sauvegarder les clés API"
                  )}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Profile;
