import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface GeneratedPrompt {
  scene: string;
  prompt: string;
}

const Index = () => {
  const [text, setText] = useState("");
  const [examplePrompt, setExamplePrompt] = useState("");
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast.error("Veuillez entrer du texte à analyser");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-prompts", {
        body: { text, examplePrompt },
      });

      if (error) throw error;

      setGeneratedPrompts(data.prompts);
      toast.success(`${data.prompts.length} prompts générés avec succès !`);
    } catch (error: any) {
      console.error("Error generating prompts:", error);
      toast.error(error.message || "Erreur lors de la génération des prompts");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (prompt: string, index: number) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    toast.success("Prompt copié !");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-warm">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">ScenePrompt AI</h1>
              <p className="text-sm text-muted-foreground">Transformez vos histoires en prompts visuels</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Section */}
          <div className="space-y-6">
            <Card className="p-6 shadow-card">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Votre texte</h2>
              <Textarea
                placeholder="Entrez votre histoire, scénario ou description narrative ici. L'IA analysera le texte et créera un prompt pour chaque scène..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[300px] resize-none text-base"
              />
            </Card>

            <Card className="p-6 shadow-card">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Prompt d'exemple (optionnel)</h2>
              <Input
                placeholder="Ex: cinematic photograph, 8k ultra detailed, dramatic lighting, --ar 16:9"
                value={examplePrompt}
                onChange={(e) => setExamplePrompt(e.target.value)}
                className="text-base"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Donnez un exemple de style de prompt pour guider l'IA
              </p>
            </Card>

            <Button
              onClick={handleGenerate}
              disabled={isLoading}
              className="w-full h-12 text-base font-semibold shadow-glow bg-gradient-warm hover:opacity-90 transition-opacity"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Génération en cours...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Générer les prompts
                </>
              )}
            </Button>
          </div>

          {/* Output Section */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <span className="h-px flex-1 bg-gradient-warm"></span>
              Prompts générés
              <span className="h-px flex-1 bg-gradient-warm"></span>
            </h2>

            {generatedPrompts.length === 0 ? (
              <Card className="p-12 shadow-card">
                <div className="text-center text-muted-foreground">
                  <Sparkles className="h-16 w-16 mx-auto mb-4 opacity-30" />
                  <p className="text-lg">Les prompts générés apparaîtront ici</p>
                  <p className="text-sm mt-2">Entrez votre texte et cliquez sur "Générer les prompts"</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-4 animate-fade-in">
                {generatedPrompts.map((item, index) => (
                  <Card key={index} className="p-6 shadow-card hover:shadow-glow transition-shadow">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                            {index + 1}
                          </span>
                          <h3 className="font-semibold text-foreground">{item.scene}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.prompt}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(item.prompt, index)}
                        className="shrink-0 hover:bg-primary/10"
                      >
                        {copiedIndex === index ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 py-8 border-t border-border/50">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Propulsé par l'IA • Transformez vos idées en images</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
