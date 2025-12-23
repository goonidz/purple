import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Key, LogOut, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [replicateApiKey, setReplicateApiKey] = useState("");
  const [minimaxApiKey, setMinimaxApiKey] = useState("");
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  
  // Track original values to detect changes
  const [originalKeys, setOriginalKeys] = useState({
    replicate: "",
    eleven_labs: "",
    minimax: "",
    anthropic: ""
  });
  const [showKeys, setShowKeys] = useState({
    replicate: false,
    eleven_labs: false,
    minimax: false,
    anthropic: false
  });

  useEffect(() => {
    document.title = "Profil";
  }, []);

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
      const [replicateResult, elevenLabsResult, minimaxResult, anthropicResult] = await Promise.all([
        supabase.rpc('get_user_api_key', { key_name: 'replicate' }),
        supabase.rpc('get_user_api_key', { key_name: 'eleven_labs' }),
        supabase.rpc('get_user_api_key', { key_name: 'minimax' }),
        supabase.rpc('get_user_api_key', { key_name: 'anthropic' }),
      ]);

      const replicateValue = replicateResult.data || "";
      const elevenLabsValue = elevenLabsResult.data || "";
      const minimaxValue = minimaxResult.data || "";
      const anthropicValue = anthropicResult.data || "";

      // Set current values
      setReplicateApiKey(replicateValue);
      setElevenLabsApiKey(elevenLabsValue);
      setMinimaxApiKey(minimaxValue);
      setAnthropicApiKey(anthropicValue);
      
      // Store original values to track changes
      setOriginalKeys({
        replicate: replicateValue,
        eleven_labs: elevenLabsValue,
        minimax: minimaxValue,
        anthropic: anthropicValue
      });
      
      if (replicateResult.error && !replicateResult.error.message?.includes('not found')) {
        console.error("Error loading Replicate API key:", replicateResult.error);
      }
      if (elevenLabsResult.error && !elevenLabsResult.error.message?.includes('not found')) {
        console.error("Error loading Eleven Labs API key:", elevenLabsResult.error);
      }
      if (minimaxResult.error && !minimaxResult.error.message?.includes('not found')) {
        console.error("Error loading MiniMax API key:", minimaxResult.error);
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

    // Only save keys that have changed
    const changedKeys: { key_name: string; key_value: string }[] = [];
    
    if (replicateApiKey.trim() !== originalKeys.replicate) {
      changedKeys.push({ key_name: 'replicate', key_value: replicateApiKey.trim() });
    }
    if (elevenLabsApiKey.trim() !== originalKeys.eleven_labs) {
      changedKeys.push({ key_name: 'eleven_labs', key_value: elevenLabsApiKey.trim() });
    }
    if (minimaxApiKey.trim() !== originalKeys.minimax) {
      changedKeys.push({ key_name: 'minimax', key_value: minimaxApiKey.trim() });
    }
    if (anthropicApiKey.trim() !== originalKeys.anthropic) {
      changedKeys.push({ key_name: 'anthropic', key_value: anthropicApiKey.trim() });
    }

    if (changedKeys.length === 0) {
      toast.info("Aucune modification détectée");
      return;
    }

    setIsSaving(true);
    try {
      // Only store changed keys
      const promises = changedKeys
        .filter(k => k.key_value) // Only non-empty values
        .map(k => supabase.rpc('store_user_api_key', k));

      const results = await Promise.all(promises);
      
      // Check for errors
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        throw errors[0].error;
      }

      // Update original keys to reflect saved state
      setOriginalKeys({
        replicate: replicateApiKey.trim(),
        eleven_labs: elevenLabsApiKey.trim(),
        minimax: minimaxApiKey.trim()
      });

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
      <AppHeader title="Profil">
        <Button
          variant="outline"
          onClick={handleLogout}
          className="gap-2 ml-4"
          size="sm"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </Button>
      </AppHeader>

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
                    <div className="relative">
                      <Input
                        id="replicate-key"
                        type={showKeys.replicate ? "text" : "password"}
                        value={replicateApiKey}
                        onChange={(e) => setReplicateApiKey(e.target.value)}
                        placeholder="r8_..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, replicate: !prev.replicate }))}
                      >
                        {showKeys.replicate ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
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
                    </Label>
                    <div className="relative">
                      <Input
                        id="elevenlabs-key"
                        type={showKeys.eleven_labs ? "text" : "password"}
                        value={elevenLabsApiKey}
                        onChange={(e) => setElevenLabsApiKey(e.target.value)}
                        placeholder="sk_..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, eleven_labs: !prev.eleven_labs }))}
                      >
                        {showKeys.eleven_labs ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la transcription audio et TTS.{" "}
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

                  <div className="space-y-2">
                    <Label htmlFor="minimax-key">
                      MiniMax API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="minimax-key"
                        type={showKeys.minimax ? "text" : "password"}
                        value={minimaxApiKey}
                        onChange={(e) => setMinimaxApiKey(e.target.value)}
                        placeholder="eyJ..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, minimax: !prev.minimax }))}
                      >
                        {showKeys.minimax ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la génération vocale TTS.{" "}
                      <a
                        href="https://platform.minimax.io/user-center/basic-information/interface-key"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="anthropic-key">
                      Anthropic API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="anthropic-key"
                        type={showKeys.anthropic ? "text" : "password"}
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, anthropic: !prev.anthropic }))}
                      >
                        {showKeys.anthropic ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour Claude Sonnet 4 avec Extended Thinking (meilleure qualité, moins d'erreurs).{" "}
                      <a
                        href="https://console.anthropic.com/settings/keys"
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
                  disabled={isSaving || (!replicateApiKey.trim() && !elevenLabsApiKey.trim() && !minimaxApiKey.trim() && !anthropicApiKey.trim())}
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
