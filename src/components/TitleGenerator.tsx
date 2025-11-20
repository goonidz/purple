import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Copy, Check, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TitleGeneratorProps {
  projectId: string;
  videoScript: string;
}

interface TitlePreset {
  id: string;
  name: string;
  example_titles: string[];
}

interface GeneratedTitleHistory {
  id: string;
  titles: string[];
  created_at: string;
}

export const TitleGenerator = ({ projectId, videoScript }: TitleGeneratorProps) => {
  const [exampleTitles, setExampleTitles] = useState<string[]>(["", "", ""]);
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([]);
  const [titleHistory, setTitleHistory] = useState<GeneratedTitleHistory[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [presets, setPresets] = useState<TitlePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [newPresetName, setNewPresetName] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    loadPresets();
    loadTitleHistory();
  }, [projectId]);

  const loadPresets = async () => {
    try {
      const { data, error } = await supabase
        .from("title_presets")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPresets((data || []) as TitlePreset[]);
    } catch (error: any) {
      console.error("Error loading presets:", error);
    }
  };

  const loadTitleHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("generated_titles")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTitleHistory((data || []) as GeneratedTitleHistory[]);
    } catch (error: any) {
      console.error("Error loading history:", error);
    }
  };

  const loadPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      setExampleTitles(preset.example_titles);
      toast.success(`Preset "${preset.name}" chargé !`);
    }
  };

  const saveAsPreset = async () => {
    if (!newPresetName.trim()) {
      toast.error("Donne un nom au preset");
      return;
    }

    const filteredTitles = exampleTitles.filter(t => t.trim() !== "");
    if (filteredTitles.length === 0) {
      toast.error("Ajoute au moins un exemple de titre");
      return;
    }

    setIsSavingPreset(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase.from("title_presets").insert({
        name: newPresetName,
        example_titles: filteredTitles,
        user_id: user.id,
      });

      if (error) throw error;

      toast.success("Preset sauvegardé !");
      setNewPresetName("");
      await loadPresets();
    } catch (error: any) {
      console.error("Error saving preset:", error);
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const deletePreset = async (presetId: string) => {
    try {
      const { error } = await supabase
        .from("title_presets")
        .delete()
        .eq("id", presetId);

      if (error) throw error;

      toast.success("Preset supprimé !");
      await loadPresets();
      if (selectedPresetId === presetId) {
        setSelectedPresetId("");
      }
    } catch (error: any) {
      console.error("Error deleting preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const generateTitles = async () => {
    const filteredTitles = exampleTitles.filter(t => t.trim() !== "");
    if (filteredTitles.length === 0) {
      toast.error("Ajoute au moins un exemple de titre");
      return;
    }

    setIsGenerating(true);
    const generated: string[] = [];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      toast.info("Génération de 5 titres avec Gemini...");
      const { data: titlesData, error: titlesError } = await supabase.functions.invoke("generate-titles", {
        body: { 
          videoScript,
          exampleTitles: filteredTitles
        }
      });

      if (titlesError) throw titlesError;
      if (!titlesData?.titles || titlesData.titles.length === 0) {
        throw new Error("Failed to generate titles");
      }

      const generatedTitlesList = titlesData.titles as string[];
      setGeneratedTitles(generatedTitlesList);
      toast.success("Titres générés !");

      // Sauvegarder dans l'historique
      const { error: saveError } = await supabase
        .from("generated_titles")
        .insert({
          project_id: projectId,
          user_id: user.id,
          titles: generatedTitlesList,
        });

      if (saveError) {
        console.error("Error saving to history:", saveError);
      } else {
        await loadTitleHistory();
      }
    } catch (error: any) {
      console.error("Error generating titles:", error);
      toast.error("Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const { error } = await supabase
        .from("generated_titles")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Génération supprimée !");
      await loadTitleHistory();
    } catch (error: any) {
      console.error("Error deleting history item:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    toast.success("Titre copié !");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Générer des titres YouTube optimisés</h3>
      
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generate">Générer</TabsTrigger>
          <TabsTrigger value="history">Historique ({titleHistory.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
          {/* Gestion des presets */}
          <Card className="p-4 bg-muted/30">
            <Label className="text-sm font-medium mb-2 block">Presets</Label>
            <div className="flex gap-2">
              <Select value={selectedPresetId} onValueChange={(value) => {
                setSelectedPresetId(value);
                loadPreset(value);
              }}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Sélectionner un preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPresetId && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => deletePreset(selectedPresetId)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="flex gap-2 mt-3">
              <Input
                placeholder="Nom du nouveau preset"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={saveAsPreset}
                disabled={isSavingPreset}
              >
                <Save className="w-4 h-4 mr-2" />
                Sauvegarder
              </Button>
            </div>
          </Card>

          {/* Exemples de titres */}
          <div className="space-y-4">
            <Label>Exemples de titres qui marchent bien (3 minimum)</Label>
            <p className="text-sm text-muted-foreground">
              Ajoute des exemples de titres à succès pour que l'IA comprenne le style et la structure à reproduire
            </p>
            {exampleTitles.map((title, index) => (
              <Textarea
                key={index}
                placeholder={`Exemple ${index + 1}: "Comment j'ai gagné 10k€ en 30 jours (méthode complète)"`}
                value={title}
                onChange={(e) => {
                  const newTitles = [...exampleTitles];
                  newTitles[index] = e.target.value;
                  setExampleTitles(newTitles);
                }}
                rows={2}
              />
            ))}
            <Button
              variant="outline"
              onClick={() => setExampleTitles([...exampleTitles, ""])}
            >
              + Ajouter un exemple
            </Button>
          </div>

          {/* Bouton de génération */}
          <Button
            onClick={generateTitles}
            disabled={isGenerating}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Générer 5 titres
              </>
            )}
          </Button>

          {/* Résultats de génération */}
          {generatedTitles.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-semibold">Titres générés</h4>
              <div className="space-y-3">
                {generatedTitles.map((title, index) => (
                  <Card key={index} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {title.length} caractères
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(title, index)}
                      >
                        {copiedIndex === index ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {titleHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Aucune génération précédente</p>
            </Card>
          ) : (
            titleHistory.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString('fr-FR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryItem(item.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="space-y-3">
                  {item.titles.map((title, index) => (
                    <Card key={index} className="p-3 bg-muted/30">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-sm">{title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {title.length} caractères
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(title, index)}
                        >
                          {copiedIndex === index ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
