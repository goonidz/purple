import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Channel {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

interface ChannelManagerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onChannelsUpdated: () => void;
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f43f5e", // rose
];

export default function ChannelManager({
  isOpen,
  onClose,
  userId,
  onChannelsUpdated,
}: ChannelManagerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelColor, setNewChannelColor] = useState("#3b82f6");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadChannels();
    }
  }, [isOpen]);

  const loadChannels = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("user_id", userId)
        .order("name", { ascending: true });

      if (error) throw error;
      setChannels(data || []);
    } catch (error) {
      console.error("Error loading channels:", error);
      toast.error("Erreur lors du chargement des chaînes");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) {
      toast.error("Le nom de la chaîne est requis");
      return;
    }

    setIsCreating(true);
    try {
      const { error } = await supabase.from("channels").insert({
        user_id: userId,
        name: newChannelName.trim(),
        color: newChannelColor,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("Une chaîne avec ce nom existe déjà");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Chaîne créée");
      setNewChannelName("");
      setNewChannelColor("#3b82f6");
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error creating channel:", error);
      toast.error("Erreur lors de la création de la chaîne");
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateChannel = async (id: string) => {
    if (!editingName.trim()) {
      toast.error("Le nom de la chaîne est requis");
      return;
    }

    try {
      const { error } = await supabase
        .from("channels")
        .update({
          name: editingName.trim(),
          color: editingColor,
        })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          toast.error("Une chaîne avec ce nom existe déjà");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Chaîne mise à jour");
      setEditingId(null);
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error updating channel:", error);
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm("Supprimer cette chaîne ? Les vidéos associées ne seront plus liées à aucune chaîne.")) {
      return;
    }

    try {
      const { error } = await supabase.from("channels").delete().eq("id", id);

      if (error) throw error;

      toast.success("Chaîne supprimée");
      loadChannels();
      onChannelsUpdated();
    } catch (error) {
      console.error("Error deleting channel:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const startEditing = (channel: Channel) => {
    setEditingId(channel.id);
    setEditingName(channel.name);
    setEditingColor(channel.color);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gérer les chaînes</DialogTitle>
          <DialogDescription>
            Créez et organisez vos chaînes pour différencier vos vidéos
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Create new channel */}
          <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
            <Label className="font-medium">Nouvelle chaîne</Label>
            <div className="flex gap-2">
              <Input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="Nom de la chaîne"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreateChannel()}
              />
              <Button
                onClick={handleCreateChannel}
                disabled={isCreating || !newChannelName.trim()}
                size="icon"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    "h-6 w-6 rounded-full transition-all hover:scale-110",
                    newChannelColor === color && "ring-2 ring-offset-2 ring-primary"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewChannelColor(color)}
                />
              ))}
            </div>
          </div>

          {/* Existing channels */}
          <div className="space-y-2">
            <Label className="font-medium">Vos chaînes</Label>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : channels.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aucune chaîne créée
              </p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center gap-2 p-3 border rounded-lg bg-card"
                  >
                    {editingId === channel.id ? (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {PRESET_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={cn(
                                "h-5 w-5 rounded-full transition-all hover:scale-110",
                                editingColor === color && "ring-2 ring-offset-1 ring-primary"
                              )}
                              style={{ backgroundColor: color }}
                              onClick={() => setEditingColor(color)}
                            />
                          ))}
                        </div>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="flex-1 h-8"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdateChannel(channel.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleUpdateChannel(channel.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div
                          className="h-4 w-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: channel.color }}
                        />
                        <span
                          className="flex-1 cursor-pointer hover:text-primary transition-colors"
                          onClick={() => startEditing(channel)}
                        >
                          {channel.name}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteChannel(channel.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}



