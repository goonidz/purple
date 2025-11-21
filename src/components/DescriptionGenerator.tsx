import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Copy, Check, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DescriptionGeneratorProps {
  projectId: string;
  videoScript: string;
}

interface GeneratedDescriptionHistory {
  id: string;
  descriptions: string[];
  created_at: string;
}

export const DescriptionGenerator = ({ projectId, videoScript }: DescriptionGeneratorProps) => {
  const [generatedDescriptions, setGeneratedDescriptions] = useState<string[]>([]);
  const [descriptionHistory, setDescriptionHistory] = useState<GeneratedDescriptionHistory[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | string | null>(null);

  useEffect(() => {
    loadDescriptionHistory();
  }, [projectId]);

  const loadDescriptionHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("generated_descriptions")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDescriptionHistory((data || []) as GeneratedDescriptionHistory[]);
    } catch (error: any) {
      console.error("Error loading history:", error);
    }
  };

  const generateDescriptions = async () => {
    setIsGenerating(true);
    setGeneratedDescriptions([]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");
      
      const { data, error } = await supabase.functions.invoke("generate-descriptions", {
        body: {
          videoScript,
        },
      });

      if (error) throw error;

      const descriptions = data.descriptions || [];
      setGeneratedDescriptions(descriptions);

      // Save to history
      const { error: insertError } = await supabase.from("generated_descriptions").insert({
        project_id: projectId,
        user_id: user.id,
        descriptions: descriptions,
      });

      if (insertError) throw insertError;

      await loadDescriptionHistory();
      toast.success("3 descriptions générées avec succès !");
    } catch (error: any) {
      console.error("Error generating descriptions:", error);
      toast.error(error.message || "Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteHistoryItem = async (historyId: string) => {
    try {
      const { error } = await supabase
        .from("generated_descriptions")
        .delete()
        .eq("id", historyId);

      if (error) throw error;

      toast.success("Historique supprimé !");
      await loadDescriptionHistory();
    } catch (error: any) {
      console.error("Error deleting history:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const copyToClipboard = async (text: string, index: number | string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      toast.success("Description copiée !");
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
            onClick={generateDescriptions}
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
                Générer 3 descriptions réalistes
              </>
            )}
          </Button>

          {/* Generated Descriptions */}
          {generatedDescriptions.length > 0 && (
            <Card className="p-6 space-y-4">
              <h3 className="font-semibold text-lg">Descriptions générées</h3>
              <div className="space-y-3">
                {generatedDescriptions.map((description, index) => (
                  <div
                    key={index}
                    className="p-4 bg-muted rounded-lg flex items-start justify-between gap-3 group hover:bg-muted/80 transition-colors"
                  >
                    <p className="flex-1 text-sm leading-relaxed">{description}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(description, index)}
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
          {descriptionHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Aucun historique de génération</p>
            </Card>
          ) : (
            descriptionHistory.map((history) => (
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
                  {(history.descriptions as string[]).map((description, index) => (
                    <div
                      key={index}
                      className="p-4 bg-muted rounded-lg flex items-start justify-between gap-3 group hover:bg-muted/80 transition-colors"
                    >
                      <p className="flex-1 text-sm leading-relaxed">{description}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(description, `${history.id}-${index}`)}
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
