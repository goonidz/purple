import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Youtube, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AddCompetitorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function AddCompetitorModal({ open, onOpenChange, onSuccess }: AddCompetitorModalProps) {
  const [channelUrl, setChannelUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!channelUrl.trim()) {
      toast.error("Veuillez entrer une URL ou un ID de chaîne YouTube");
      return;
    }

    setIsLoading(true);

    try {
      const response = await supabase.functions.invoke('add-competitor', {
        body: { channelUrl: channelUrl.trim() }
      });

      const { data, error } = response;
      
      console.log("Add competitor response:", { data, error, response });

      // Extract error message - check multiple sources
      let errorMsg: string | null = null;
      
      // Check data.error first (Edge Function returns JSON with error field)
      if (data?.error) {
        errorMsg = data.error;
      }
      
      // Check if there's a FunctionsHttpError with context
      if (!errorMsg && error) {
        // Try to get the response body from the error
        if ((error as any).context) {
          try {
            // context might have the response
            const ctx = (error as any).context;
            if (typeof ctx === 'object' && ctx.json) {
              const jsonBody = await ctx.json();
              if (jsonBody?.error) errorMsg = jsonBody.error;
            } else if (typeof ctx === 'string') {
              const parsed = JSON.parse(ctx);
              if (parsed?.error) errorMsg = parsed.error;
            }
          } catch {
            // Ignore parsing errors
          }
        }
        
        // If still no message, use the error message if it's not the generic one
        if (!errorMsg && error.message && !error.message.includes("non-2xx")) {
          errorMsg = error.message;
        }
      }

      if (error && !errorMsg) {
        errorMsg = "Erreur lors de l'ajout du concurrent";
      }

      if (errorMsg) {
        throw new Error(errorMsg);
      }

      if (!data?.channel) {
        throw new Error("Réponse invalide du serveur");
      }

      toast.success(`${data.channel.channel_name} ajouté aux concurrents`);
      setChannelUrl("");
      onSuccess();
      onOpenChange(false);

    } catch (error) {
      console.error("Error adding competitor:", error);
      toast.error(error instanceof Error ? error.message : "Erreur lors de l'ajout du concurrent");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-500" />
            Ajouter un concurrent
          </DialogTitle>
          <DialogDescription>
            Entrez l'URL d'une chaîne YouTube ou son identifiant pour la suivre.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channelUrl">URL ou ID de la chaîne</Label>
            <Input
              id="channelUrl"
              placeholder="https://youtube.com/@channel ou UCxxxxx"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Formats acceptés: URL de chaîne, @handle, ou ID (UC...)
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Ajout en cours...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
