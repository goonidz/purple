import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Key, LogOut, Eye, EyeOff, Shield, Lock } from "lucide-react";
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
  const [braveApiKey, setBraveApiKey] = useState("");
  const [keiApiKey, setKeiApiKey] = useState("");
  const [apifyApiKey, setApifyApiKey] = useState("");
  const [inworldApiKey, setInworldApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [genaiproApiKey, setGenaiproApiKey] = useState("");
  const [ai33ApiKey, setAi33ApiKey] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  
  // Track original values to detect changes
  const [originalKeys, setOriginalKeys] = useState({
    replicate: "",
    eleven_labs: "",
    minimax: "",
    anthropic: "",
    brave: "",
    kei: "",
    apify: "",
    inworld: "",
    gemini: "",
    genaipro: "",
    ai33: "",
    youtube: ""
  });
  const [showKeys, setShowKeys] = useState({
    replicate: false,
    eleven_labs: false,
    minimax: false,
    anthropic: false,
    brave: false,
    kei: false,
    apify: false,
    inworld: false,
    gemini: false,
    genaipro: false,
    ai33: false,
    youtube: false
  });

  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

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
      const [replicateResult, elevenLabsResult, minimaxResult, anthropicResult, braveResult, keiResult, apifyResult, inworldResult, geminiResult, genaiproResult, ai33Result, youtubeResult] = await Promise.all([
        supabase.rpc('get_user_api_key', { key_name: 'replicate' }),
        supabase.rpc('get_user_api_key', { key_name: 'eleven_labs' }),
        supabase.rpc('get_user_api_key', { key_name: 'minimax' }),
        supabase.rpc('get_user_api_key', { key_name: 'anthropic' }),
        supabase.rpc('get_user_api_key', { key_name: 'brave' }),
        supabase.rpc('get_user_api_key', { key_name: 'kei' }),
        supabase.rpc('get_user_api_key', { key_name: 'apify' }),
        supabase.rpc('get_user_api_key', { key_name: 'inworld' }),
        supabase.rpc('get_user_api_key', { key_name: 'gemini' }),
        supabase.rpc('get_user_api_key', { key_name: 'genaipro' }),
        supabase.rpc('get_user_api_key', { key_name: 'ai33' }),
        supabase.rpc('get_user_api_key', { key_name: 'youtube' }),
      ]);

      const replicateValue = replicateResult.data || "";
      const elevenLabsValue = elevenLabsResult.data || "";
      const minimaxValue = minimaxResult.data || "";
      const anthropicValue = anthropicResult.data || "";
      const braveValue = braveResult.data || "";
      const keiValue = keiResult.data || "";
      const apifyValue = apifyResult.data || "";
      const inworldValue = inworldResult.data || "";
      const geminiValue = geminiResult.data || "";
      const genaiproValue = genaiproResult.data || "";
      const ai33Value = ai33Result.data || "";
      const youtubeValue = youtubeResult.data || "";

      // Set current values
      setReplicateApiKey(replicateValue);
      setElevenLabsApiKey(elevenLabsValue);
      setMinimaxApiKey(minimaxValue);
      setAnthropicApiKey(anthropicValue);
      setBraveApiKey(braveValue);
      setKeiApiKey(keiValue);
      setApifyApiKey(apifyValue);
      setInworldApiKey(inworldValue);
      setGeminiApiKey(geminiValue);
      setGenaiproApiKey(genaiproValue);
      setAi33ApiKey(ai33Value);
      setYoutubeApiKey(youtubeValue);
      
      // Store original values to track changes
      setOriginalKeys({
        replicate: replicateValue,
        eleven_labs: elevenLabsValue,
        minimax: minimaxValue,
        anthropic: anthropicValue,
        brave: braveValue,
        kei: keiValue,
        apify: apifyValue,
        inworld: inworldValue,
        gemini: geminiValue,
        genaipro: genaiproValue,
        ai33: ai33Value,
        youtube: youtubeValue
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
      if (keiResult.error && !keiResult.error.message?.includes('not found')) {
        console.error("Error loading Kei.ai API key:", keiResult.error);
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
    if (braveApiKey.trim() !== originalKeys.brave) {
      changedKeys.push({ key_name: 'brave', key_value: braveApiKey.trim() });
    }
    if (keiApiKey.trim() !== originalKeys.kei) {
      changedKeys.push({ key_name: 'kei', key_value: keiApiKey.trim() });
    }
    if (apifyApiKey.trim() !== originalKeys.apify) {
      changedKeys.push({ key_name: 'apify', key_value: apifyApiKey.trim() });
    }
    if (inworldApiKey.trim() !== originalKeys.inworld) {
      changedKeys.push({ key_name: 'inworld', key_value: inworldApiKey.trim() });
    }
    if (geminiApiKey.trim() !== originalKeys.gemini) {
      changedKeys.push({ key_name: 'gemini', key_value: geminiApiKey.trim() });
    }
    if (genaiproApiKey.trim() !== originalKeys.genaipro) {
      changedKeys.push({ key_name: 'genaipro', key_value: genaiproApiKey.trim() });
    }
    if (ai33ApiKey.trim() !== originalKeys.ai33) {
      changedKeys.push({ key_name: 'ai33', key_value: ai33ApiKey.trim() });
    }
    if (youtubeApiKey.trim() !== originalKeys.youtube) {
      changedKeys.push({ key_name: 'youtube', key_value: youtubeApiKey.trim() });
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
        minimax: minimaxApiKey.trim(),
        anthropic: anthropicApiKey.trim(),
        brave: braveApiKey.trim(),
        kei: keiApiKey.trim(),
        apify: apifyApiKey.trim(),
        inworld: inworldApiKey.trim(),
        gemini: geminiApiKey.trim(),
        genaipro: genaiproApiKey.trim(),
        ai33: ai33ApiKey.trim(),
        youtube: youtubeApiKey.trim()
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

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        throw error;
      }

      toast.success("Mot de passe modifié avec succès !");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      console.error("Error changing password:", error);
      if (error.message?.includes("same as")) {
        toast.error("Le nouveau mot de passe doit être différent de l'ancien");
      } else {
        toast.error(`Erreur: ${error.message || 'Impossible de changer le mot de passe'}`);
      }
    } finally {
      setIsChangingPassword(false);
    }
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
                      Utilisée pour Claude 3.5 Sonnet via API Anthropic directe (plus rapide, pas de limite Replicate).{" "}
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

                  <div className="space-y-2">
                    <Label htmlFor="brave-key">
                      Brave Search API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="brave-key"
                        type={showKeys.brave ? "text" : "password"}
                        value={braveApiKey}
                        onChange={(e) => setBraveApiKey(e.target.value)}
                        placeholder="BSA..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, brave: !prev.brave }))}
                      >
                        {showKeys.brave ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour rechercher des images sur le web (alternative à la génération IA).{" "}
                      <a
                        href="https://brave.com/search/api/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="kei-key">
                      Kei.ai API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="kei-key"
                        type={showKeys.kei ? "text" : "password"}
                        value={keiApiKey}
                        onChange={(e) => setKeiApiKey(e.target.value)}
                        placeholder="kei_..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, kei: !prev.kei }))}
                      >
                        {showKeys.kei ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la génération d'images avec Kei.ai.{" "}
                      <a
                        href="https://kei.ai/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="apify-key">
                      Apify API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="apify-key"
                        type={showKeys.apify ? "text" : "password"}
                        value={apifyApiKey}
                        onChange={(e) => setApifyApiKey(e.target.value)}
                        placeholder="apify_api_..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, apify: !prev.apify }))}
                      >
                        {showKeys.apify ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour récupérer les transcriptions YouTube.{" "}
                      <a
                        href="https://console.apify.com/account/integrations"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="inworld-key">
                      Inworld AI API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="inworld-key"
                        type={showKeys.inworld ? "text" : "password"}
                        value={inworldApiKey}
                        onChange={(e) => setInworldApiKey(e.target.value)}
                        placeholder="..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, inworld: !prev.inworld }))}
                      >
                        {showKeys.inworld ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la génération vocale TTS avec Inworld.{" "}
                      <a
                        href="https://platform.inworld.ai/v2/documentation"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gemini-key">
                      Google Gemini API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="gemini-key"
                        type={showKeys.gemini ? "text" : "password"}
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, gemini: !prev.gemini }))}
                      >
                        {showKeys.gemini ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour le contrôle qualité automatique des images générées.{" "}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="genaipro-key">
                      GenAIPro.vn API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="genaipro-key"
                        type={showKeys.genaipro ? "text" : "password"}
                        value={genaiproApiKey}
                        onChange={(e) => setGenaiproApiKey(e.target.value)}
                        placeholder="eyJ..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, genaipro: !prev.genaipro }))}
                      >
                        {showKeys.genaipro ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la génération vocale TTS via GenAIPro (ElevenLabs proxy).{" "}
                      <a
                        href="https://genaipro.vn"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai33-key">
                      AI33 Pro API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="ai33-key"
                        type={showKeys.ai33 ? "text" : "password"}
                        value={ai33ApiKey}
                        onChange={(e) => setAi33ApiKey(e.target.value)}
                        placeholder="sk_..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, ai33: !prev.ai33 }))}
                      >
                        {showKeys.ai33 ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour la génération d'images via AI33 Pro (Gemini Pro Image).{" "}
                      <a
                        href="https://ai33.pro"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Obtenir une clé
                      </a>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="youtube-key">
                      YouTube Data API v3 Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="youtube-key"
                        type={showKeys.youtube ? "text" : "password"}
                        value={youtubeApiKey}
                        onChange={(e) => setYoutubeApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowKeys(prev => ({ ...prev, youtube: !prev.youtube }))}
                      >
                        {showKeys.youtube ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Utilisée pour le scraping de miniatures et les competitors.{" "}
                      <a
                        href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Activer YouTube Data API v3
                      </a>
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleSave}
                  disabled={isSaving || (!replicateApiKey.trim() && !elevenLabsApiKey.trim() && !minimaxApiKey.trim() && !anthropicApiKey.trim() && !braveApiKey.trim() && !keiApiKey.trim() && !apifyApiKey.trim() && !inworldApiKey.trim() && !geminiApiKey.trim() && !genaiproApiKey.trim() && !ai33ApiKey.trim() && !youtubeApiKey.trim())}
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

                {/* Security Section */}
                <div className="space-y-6 pt-6 mt-6 border-t">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="h-5 w-5 text-primary" />
                    <h2 className="text-xl font-semibold">Sécurité</h2>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-password">
                        Nouveau mot de passe
                      </Label>
                      <div className="relative">
                        <Input
                          id="new-password"
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="pr-10"
                          minLength={6}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                        >
                          {showNewPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Minimum 6 caractères
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">
                        Confirmer le mot de passe
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          className="pr-10"
                          minLength={6}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      </div>
                    </div>

                    <Button
                      onClick={handleChangePassword}
                      disabled={isChangingPassword || !newPassword || !confirmPassword}
                      variant="outline"
                      className="w-full gap-2"
                      size="lg"
                    >
                      {isChangingPassword ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Modification...
                        </>
                      ) : (
                        <>
                          <Lock className="h-4 w-4" />
                          Changer le mot de passe
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Profile;
