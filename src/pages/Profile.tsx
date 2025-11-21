import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Key, LogOut, Sparkles } from "lucide-react";
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
      // Try to get API keys from Vault
      const { data: replicateKey, error: replicateError } = await supabase
        .rpc('get_user_api_key', { key_name: 'replicate' });
      
      const { data: elevenLabsKey, error: elevenLabsError } = await supabase
        .rpc('get_user_api_key', { key_name: 'eleven_labs' });

      // Don't show errors if keys don't exist yet - just leave them empty
      if (replicateKey) setReplicateApiKey(replicateKey);
      if (elevenLabsKey) setElevenLabsApiKey(elevenLabsKey);
      
      if (replicateError && !replicateError.message?.includes('not found')) {
        console.error("Error loading Replicate API key:", replicateError);
      }
      if (elevenLabsError && !elevenLabsError.message?.includes('not found')) {
        console.error("Error loading Eleven Labs API key:", elevenLabsError);
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

    if (!replicateApiKey.trim() && !elevenLabsApiKey.trim()) {
      toast.error("Veuillez remplir au moins une clé API");
      return;
    }

    setIsSaving(true);
    try {
      // Store API keys securely in Vault
      const promises = [];
      
      if (replicateApiKey.trim()) {
        promises.push(
          supabase.rpc('store_user_api_key', {
            key_name: 'replicate',
            key_value: replicateApiKey.trim()
          })
        );
      }
      
      if (elevenLabsApiKey.trim()) {
        promises.push(
          supabase.rpc('store_user_api_key', {
            key_name: 'eleven_labs',
            key_value: elevenLabsApiKey.trim()
          })
        );
      }

      const results = await Promise.all(promises);
      
      // Check for errors
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        throw errors[0].error;
      }

      toast.success("Clés API sauvegardées avec succès !");
    } catch (error: any) {
      console.error("Error saving API keys:", error);
      toast.error(`Erreur lors de la sauvegarde: ${error.message || 'Erreur inconnue'}`);
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              VidéoFlow
            </span>
          </Link>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </Button>
        </div>
      </header>

      <div className="container max-w-4xl mx-auto py-8 px-4">

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
                  disabled={isSaving || (!replicateApiKey.trim() && !elevenLabsApiKey.trim())}
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
