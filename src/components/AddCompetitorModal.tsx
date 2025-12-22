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
      const { data, error } = await supabase.functions.invoke('add-competitor', {
        body: { channelUrl: channelUrl.trim() }
      });

      if (error) {
        throw new Error(error.message || "Failed to add competitor");
      }

      if (data.error) {
        throw new Error(data.error);
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
