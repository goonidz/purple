import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Copy, Check, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TitleGeneratorProps {
  projectId: string;
  videoScript: string;
}

interface GeneratedTitleHistory {
  id: string;
  titles: string[];
  created_at: string;
}

export const TitleGenerator = ({ projectId, videoScript }: TitleGeneratorProps) => {
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([]);
  const [titleHistory, setTitleHistory] = useState<GeneratedTitleHistory[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | string | null>(null);

  useEffect(() => {
    loadTitleHistory();
  }, [projectId]);

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

  const generateTitles = async () => {
    setIsGenerating(true);
    setGeneratedTitles([]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");
      
      const { data, error } = await supabase.functions.invoke("generate-titles", {
        body: {
          videoScript,
        },
      });

      if (error) throw error;

      const titles = data.titles || [];
      setGeneratedTitles(titles);

      // Save to history
      const { error: insertError } = await supabase.from("generated_titles").insert({
        project_id: projectId,
        user_id: user.id,
        titles: titles,
      });

      if (insertError) throw insertError;

      await loadTitleHistory();
      toast.success("5 titres générés avec succès !");
    } catch (error: any) {
      console.error("Error generating titles:", error);
      toast.error(error.message || "Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteHistoryItem = async (historyId: string) => {
    try {
      const { error } = await supabase
        .from("generated_titles")
        .delete()
        .eq("id", historyId);

      if (error) throw error;

      toast.success("Historique supprimé !");
      await loadTitleHistory();
    } catch (error: any) {
      console.error("Error deleting history:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const copyToClipboard = async (text: string, index: number | string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      toast.success("Titre copié !");
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      toast.error("Erreur lors de la copie");
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generate">Générer</TabsTrigger>
          <TabsTrigger value="history">Historique</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
          {/* Generate Button */}
          <Button
            onClick={generateTitles}
            disabled={isGenerating}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Générer 5 titres optimisés
              </>
            )}
          </Button>

          {/* Generated Titles */}
          {generatedTitles.length > 0 && (
            <Card className="p-6 space-y-4">
              <h3 className="font-semibold text-lg">Titres générés</h3>
              <div className="space-y-3">
                {generatedTitles.map((title, index) => (
                  <div
                    key={index}
                    className="p-4 bg-muted rounded-lg flex items-start justify-between gap-3 group hover:bg-muted/80 transition-colors"
                  >
                    <p className="flex-1 text-sm leading-relaxed">{title}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(title, index)}
                      className="shrink-0"
                    >
                      {copiedIndex === index ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {titleHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Aucun historique de génération</p>
            </Card>
          ) : (
            titleHistory.map((history) => (
              <Card key={history.id} className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {new Date(history.created_at).toLocaleString("fr-FR")}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryItem(history.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-3">
                  {(history.titles as string[]).map((title, index) => (
                    <div
                      key={index}
                      className="p-4 bg-muted rounded-lg flex items-start justify-between gap-3 group hover:bg-muted/80 transition-colors"
                    >
                      <p className="flex-1 text-sm leading-relaxed">{title}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(title, `${history.id}-${index}`)}
                        className="shrink-0"
                      >
                        {copiedIndex === `${history.id}-${index}` ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
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
