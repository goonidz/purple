import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Star, Settings2, Pencil } from "lucide-react";

interface ExportPathPreset {
  id: string;
  name: string;
  path: string;
  is_default: boolean;
}

interface ExportPathPresetManagerProps {
  currentPath: string;
  onPathChange: (path: string) => void;
}

export const ExportPathPresetManager = ({
  currentPath,
  onPathChange,
}: ExportPathPresetManagerProps) => {
  const [presets, setPresets] = useState<ExportPathPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetPath, setNewPresetPath] = useState("");
  const [editingPreset, setEditingPreset] = useState<ExportPathPreset | null>(null);

  // Load presets
  const loadPresets = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('export_path_presets')
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;

      setPresets((data as ExportPathPreset[]) || []);

      // If there's a default preset and no current path, use it
      const defaultPreset = data?.find((p: ExportPathPreset) => p.is_default);
      if (defaultPreset && !currentPath) {
        onPathChange(defaultPreset.path);
      }
    } catch (error) {
      console.error("Error loading export path presets:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPresets();
  }, []);

  // Create or update preset
  const handleSavePreset = async () => {
    if (!newPresetName.trim() || !newPresetPath.trim()) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Vous devez être connecté");
        return;
      }

      if (editingPreset) {
        // Update existing preset
        const { error } = await supabase
          .from('export_path_presets')
          .update({
            name: newPresetName.trim(),
            path: newPresetPath.trim(),
          })
          .eq('id', editingPreset.id);

        if (error) throw error;
        toast.success("Preset modifié");
      } else {
        // Create new preset
        const { error } = await supabase
          .from('export_path_presets')
          .insert({
            user_id: user.id,
            name: newPresetName.trim(),
            path: newPresetPath.trim(),
            is_default: presets.length === 0, // First preset is default
          });

        if (error) throw error;
        toast.success("Preset créé");
      }

      setNewPresetName("");
      setNewPresetPath("");
      setEditingPreset(null);
      setIsDialogOpen(false);
      loadPresets();
    } catch (error) {
      console.error("Error saving preset:", error);
      toast.error("Erreur lors de la sauvegarde");
    }
  };

  // Delete preset
  const handleDeletePreset = async (presetId: string) => {
    try {
      const { error } = await supabase
        .from('export_path_presets')
        .delete()
        .eq('id', presetId);

      if (error) throw error;
      toast.success("Preset supprimé");
      loadPresets();
    } catch (error) {
      console.error("Error deleting preset:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  // Set as default
  const handleSetDefault = async (presetId: string) => {
    try {
      const { error } = await supabase
        .from('export_path_presets')
        .update({ is_default: true })
        .eq('id', presetId);

      if (error) throw error;
      toast.success("Preset défini par défaut");
      loadPresets();
    } catch (error) {
      console.error("Error setting default:", error);
      toast.error("Erreur lors de la définition par défaut");
    }
  };

  // Open edit dialog
  const handleEditPreset = (preset: ExportPathPreset) => {
    setEditingPreset(preset);
    setNewPresetName(preset.name);
    setNewPresetPath(preset.path);
    setIsDialogOpen(true);
  };

  // Save current path as new preset
  const handleSaveCurrentAsPreset = () => {
    setEditingPreset(null);
    setNewPresetName("");
    setNewPresetPath(currentPath);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select
            value={presets.find(p => p.path === currentPath)?.id || "custom"}
            onValueChange={(value) => {
              if (value === "custom") return;
              const preset = presets.find(p => p.id === value);
              if (preset) {
                onPathChange(preset.path);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Sélectionner un preset..." />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  <div className="flex items-center gap-2">
                    {preset.is_default && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                    <span>{preset.name}</span>
                  </div>
                </SelectItem>
              ))}
              {presets.length === 0 && (
                <SelectItem value="none" disabled>
                  Aucun preset
                </SelectItem>
              )}
              {currentPath && !presets.find(p => p.path === currentPath) && (
                <SelectItem value="custom">
                  Chemin personnalisé
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {currentPath && !presets.find(p => p.path === currentPath) && (
          <Button
            variant="outline"
            size="icon"
            onClick={handleSaveCurrentAsPreset}
            title="Sauvegarder comme preset"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingPreset(null);
            setNewPresetName("");
            setNewPresetPath("");
          }
        }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" title="Gérer les presets">
              <Settings2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingPreset ? "Modifier le preset" : "Gérer les presets de chemin d'export"}
              </DialogTitle>
              <DialogDescription>
                {editingPreset 
                  ? "Modifiez les informations du preset"
                  : "Créez et gérez vos chemins d'export favoris"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Create/Edit form */}
              <div className="space-y-3 p-4 bg-muted rounded-lg">
                <div className="space-y-2">
                  <Label>Nom du preset</Label>
                  <Input
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="Ex: Downloads, Projets Vidéo..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Chemin</Label>
                  <Input
                    value={newPresetPath}
                    onChange={(e) => setNewPresetPath(e.target.value)}
                    placeholder="/Users/VotreNom/Downloads"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSavePreset} className="flex-1">
                    {editingPreset ? "Modifier" : "Créer le preset"}
                  </Button>
                  {editingPreset && (
                    <Button variant="outline" onClick={() => {
                      setEditingPreset(null);
                      setNewPresetName("");
                      setNewPresetPath("");
                    }}>
                      Annuler
                    </Button>
                  )}
                </div>
              </div>

              {/* Existing presets list */}
              {presets.length > 0 && !editingPreset && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Presets existants</Label>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex items-center gap-2 p-3 bg-background border rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {preset.is_default && (
                              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                            )}
                            <span className="font-medium truncate">{preset.name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {preset.path}
                          </p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {!preset.is_default && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleSetDefault(preset.id)}
                              title="Définir par défaut"
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleEditPreset(preset)}
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeletePreset(preset.id)}
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Manual input */}
      <Input
        value={currentPath}
        onChange={(e) => onPathChange(e.target.value)}
        placeholder="/Users/VotreNom/Downloads"
        className="font-mono text-sm"
      />
    </div>
  );
};
