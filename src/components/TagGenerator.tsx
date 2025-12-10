import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Copy, Check, Trash2, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TagGeneratorProps {
  projectId: string;
  videoScript: string;
  videoTitle: string;
}

interface GeneratedTagHistory {
  id: string;
  tags: string[];
  created_at: string;
}

export const TagGenerator = ({ projectId, videoScript, videoTitle }: TagGeneratorProps) => {
  const [generatedTags, setGeneratedTags] = useState<string[]>([]);
  const [tagHistory, setTagHistory] = useState<GeneratedTagHistory[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | string | null>(null);

  useEffect(() => {
    loadTagHistory();
  }, [projectId]);

  const loadTagHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("generated_tags")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTagHistory((data || []) as GeneratedTagHistory[]);
    } catch (error: any) {
      console.error("Error loading history:", error);
    }
  };

  const generateTags = async () => {
    setIsGenerating(true);
    setGeneratedTags([]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");
      
      const { data, error } = await supabase.functions.invoke("generate-tags", {
        body: {
          videoScript,
          videoTitle,
        },
      });

      if (error) throw error;

      const tags = data.tags || [];
      setGeneratedTags(tags);

      // Save to history
      const { error: insertError } = await supabase.from("generated_tags").insert({
        project_id: projectId,
        user_id: user.id,
        tags: tags,
      });

      if (insertError) throw insertError;

      await loadTagHistory();
      toast.success("10 tags générés avec succès !");
    } catch (error: any) {
      console.error("Error generating tags:", error);
      toast.error(error.message || "Erreur lors de la génération");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteHistoryItem = async (historyId: string) => {
    try {
      const { error } = await supabase
        .from("generated_tags")
        .delete()
        .eq("id", historyId);

      if (error) throw error;

      toast.success("Historique supprimé !");
      await loadTagHistory();
    } catch (error: any) {
      console.error("Error deleting history:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const copyTag = async (text: string, index: number | string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      toast.success("Tag copié !");
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      toast.error("Erreur lors de la copie");
    }
  };

  const copyAllTags = async (tags: string[]) => {
    try {
      await navigator.clipboard.writeText(tags.join(", "));
      setCopiedIndex("all");
      toast.success("Tous les tags copiés !");
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
            onClick={generateTags}
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
                <Hash className="mr-2 h-5 w-5" />
                Générer 10 tags
              </>
            )}
          </Button>

          {/* Generated Tags */}
          {generatedTags.length > 0 && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Tags générés</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyAllTags(generatedTags)}
                >
                  {copiedIndex === "all" ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Copier tous
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {generatedTags.map((tag, index) => (
                  <button
                    key={index}
                    onClick={() => copyTag(tag, index)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors cursor-pointer"
                  >
                    <Hash className="h-3 w-3" />
                    {tag}
                    {copiedIndex === index ? (
                      <Check className="h-3 w-3 ml-1" />
                    ) : (
                      <Copy className="h-3 w-3 ml-1 opacity-50" />
                    )}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {tagHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">Aucun tag généré pour ce projet</p>
            </Card>
          ) : (
            tagHistory.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString("fr-FR", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyAllTags(item.tags)}
                    >
                      {copiedIndex === `all-${item.id}` ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryItem(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag, tagIndex) => (
                    <button
                      key={tagIndex}
                      onClick={() => copyTag(tag, `${item.id}-${tagIndex}`)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-sm font-medium transition-colors cursor-pointer"
                    >
                      <Hash className="h-3 w-3" />
                      {tag}
                    </button>
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
