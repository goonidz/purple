import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Pencil,
  Copy,
  Trash2,
  MoreHorizontal,
  Upload,
  Video,
  FolderOpen,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface RenderPreset {
  id: string;
  name: string;
  framerate: number;
  effect_type: string;
  use_gpu: boolean;
  blackscreen_url: string | null;
  blackscreen_opacity: number;
  created_at?: string;
  updated_at?: string;
}

interface RenderPresetManagerProps {
  presetIdToEdit?: string | null;
  onEditDialogClose?: () => void;
  onPresetsChanged?: () => void;
}

export function RenderPresetManager({
  presetIdToEdit,
  onEditDialogClose,
  onPresetsChanged,
}: RenderPresetManagerProps) {
  const [presets, setPresets] = useState<RenderPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formFramerate, setFormFramerate] = useState(25);
  const [formEffectType, setFormEffectType] = useState("opencv_zoom");
  const [formUseGpu, setFormUseGpu] = useState(true);
  const [formBlackscreenUrl, setFormBlackscreenUrl] = useState<string | null>(null);
  const [formBlackscreenOpacity, setFormBlackscreenOpacity] = useState(0.45);

  // Blackscreen upload
  const [bsUploading, setBsUploading] = useState(false);
  const [bsUploadProgress, setBsUploadProgress] = useState<{ filename: string; percent: number } | null>(null);
  const [bsServerFiles, setBsServerFiles] = useState<{ filename: string; url: string; sizeMB: number }[]>([]);
  const [bsLoadingFiles, setBsLoadingFiles] = useState(false);

  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("render_presets" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPresets((data as any[]) || []);
    } catch (err: any) {
      console.error("Error loading render presets:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  // External edit trigger
  useEffect(() => {
    if (!presetIdToEdit) return;
    const preset = presets.find((p) => p.id === presetIdToEdit);
    if (preset) {
      openEdit(preset);
    } else {
      (async () => {
        const { data } = await supabase
          .from("render_presets" as any)
          .select("*")
          .eq("id", presetIdToEdit)
          .single();
        if (data) openEdit(data as any);
      })();
    }
  }, [presetIdToEdit, presets]);

  const resetForm = () => {
    setFormName("");
    setFormFramerate(25);
    setFormEffectType("opencv_zoom");
    setFormUseGpu(true);
    setFormBlackscreenUrl(null);
    setFormBlackscreenOpacity(0.45);
    setEditId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (preset: RenderPreset) => {
    setEditId(preset.id);
    setFormName(preset.name);
    setFormFramerate(preset.framerate);
    setFormEffectType(preset.effect_type);
    setFormUseGpu(preset.use_gpu);
    setFormBlackscreenUrl(preset.blackscreen_url);
    setFormBlackscreenOpacity(preset.blackscreen_opacity);
    setDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      resetForm();
      onEditDialogClose?.();
    }
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Veuillez entrer un nom");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const payload = {
        user_id: user.id,
        name: formName.trim(),
        framerate: formFramerate,
        effect_type: formEffectType,
        use_gpu: formUseGpu,
        blackscreen_url: formBlackscreenUrl || null,
        blackscreen_opacity: formBlackscreenOpacity,
      };

      if (editId) {
        const { error } = await supabase
          .from("render_presets" as any)
          .update(payload)
          .eq("id", editId);
        if (error) throw error;
        toast.success("Preset mis à jour");
      } else {
        const { error } = await supabase
          .from("render_presets" as any)
          .insert([payload]);
        if (error) throw error;
        toast.success("Preset créé");
      }

      setDialogOpen(false);
      resetForm();
      await loadPresets();
      onPresetsChanged?.();
    } catch (err: any) {
      console.error("Error saving render preset:", err);
      toast.error("Erreur: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (preset: RenderPreset) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const { error } = await supabase.from("render_presets" as any).insert([{
        user_id: user.id,
        name: `${preset.name} (copie)`,
        framerate: preset.framerate,
        effect_type: preset.effect_type,
        use_gpu: preset.use_gpu,
        blackscreen_url: preset.blackscreen_url,
        blackscreen_opacity: preset.blackscreen_opacity,
      }]);
      if (error) throw error;
      toast.success("Preset dupliqué");
      await loadPresets();
      onPresetsChanged?.();
    } catch (err: any) {
      toast.error("Erreur: " + err.message);
    }
  };

  const handleDelete = async (preset: RenderPreset) => {
    if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return;
    try {
      const { error } = await supabase
        .from("render_presets" as any)
        .delete()
        .eq("id", preset.id);
      if (error) throw error;
      toast.success("Preset supprimé");
      await loadPresets();
      onPresetsChanged?.();
    } catch (err: any) {
      toast.error("Erreur: " + err.message);
    }
  };

  const loadBlackscreenFiles = async () => {
    setBsLoadingFiles(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch("/api/list-blackscreen", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (resp.ok) {
        const { files } = await resp.json();
        setBsServerFiles(files || []);
      }
    } catch {}
    finally { setBsLoadingFiles(false); }
  };

  const uploadBlackscreen = async (file: File) => {
    setBsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Non authentifié"); return; }

      await new Promise<void>((resolve) => {
        const formData = new FormData();
        formData.append("video", file);
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (ev) => {
          if (!ev.lengthComputable) return;
          setBsUploadProgress({ filename: file.name, percent: Math.round((ev.loaded / ev.total) * 100) });
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              toast.success(`${file.name} uploadé (${result.sizeMB} MB)`);
              setBsServerFiles((prev) => [{ filename: result.filename, url: result.url, sizeMB: result.sizeMB }, ...prev]);
              setFormBlackscreenUrl(result.url);
            } catch {}
          } else {
            toast.error(`Erreur upload: HTTP ${xhr.status}`);
          }
          resolve();
        });
        xhr.addEventListener("error", () => { toast.error("Erreur réseau"); resolve(); });
        xhr.open("POST", "/api/upload-blackscreen");
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.send(formData);
      });
    } catch (err: any) {
      toast.error(`Erreur: ${err.message}`);
    } finally {
      setBsUploading(false);
      setBsUploadProgress(null);
    }
  };

  const deleteBlackscreenFile = async (filename: string, url: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`/api/delete-blackscreen/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setBsServerFiles((prev) => prev.filter((f) => f.filename !== filename));
      if (formBlackscreenUrl === url) setFormBlackscreenUrl(null);
      toast.success(`${filename} supprimé`);
    } catch (err: any) {
      toast.error(`Erreur: ${err.message}`);
    }
  };

  const getSubtitle = (p: RenderPreset) => {
    const parts = [
      `${p.framerate} fps`,
      p.effect_type === "none" ? "Aucun effet" : p.effect_type === "pan" ? "Pan" : "Zoom GPU",
      p.use_gpu ? "GPU" : "VPS",
    ];
    if (p.blackscreen_url) parts.push(`Particles ${Math.round(p.blackscreen_opacity * 100)}%`);
    return parts.join(" · ");
  };

  return (
    <>
      {/* List */}
      {!presetIdToEdit && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Créer un preset
            </Button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : presets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Aucun preset. Créez-en un avec le bouton ci-dessus.
            </p>
          ) : (
            <ul className="space-y-2">
              {presets.map((p) => (
                <li key={p.id}>
                  <Card className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{getSubtitle(p)}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Modifier">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDuplicate(p)}>
                            <Copy className="h-4 w-4 mr-2" /> Dupliquer
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(p)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Edit/Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier le preset rendu" : "Nouveau preset rendu"}</DialogTitle>
            <DialogDescription>Paramètres de rendu vidéo (fps, effet, GPU, overlay).</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            {/* Name */}
            <div>
              <Label>Nom</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Ma chaîne YouTube" />
            </div>

            {/* Framerate */}
            <div>
              <Label>Framerate</Label>
              <Select value={formFramerate.toString()} onValueChange={(v) => setFormFramerate(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 fps</SelectItem>
                  <SelectItem value="5">5 fps</SelectItem>
                  <SelectItem value="10">10 fps</SelectItem>
                  <SelectItem value="15">15 fps</SelectItem>
                  <SelectItem value="23.976">23.976 fps</SelectItem>
                  <SelectItem value="24">24 fps</SelectItem>
                  <SelectItem value="25">25 fps</SelectItem>
                  <SelectItem value="29.97">29.97 fps</SelectItem>
                  <SelectItem value="30">30 fps</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Effect Type */}
            <div>
              <Label>Effet vidéo</Label>
              <Select value={formEffectType} onValueChange={setFormEffectType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun effet</SelectItem>
                  <SelectItem value="pan">Pan (Vitesse constante)</SelectItem>
                  <SelectItem value="opencv_zoom">Zoom GPU</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* GPU toggle */}
            <div className="flex items-center justify-between">
              <Label>Rendu GPU (RunPod)</Label>
              <Switch checked={formUseGpu} onCheckedChange={setFormUseGpu} />
            </div>

            {/* Blackscreen overlay */}
            <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
              <Label className="text-sm font-medium">Overlay Particles (Blackscreen)</Label>

              {/* Upload */}
              {bsUploading && bsUploadProgress ? (
                <div className="p-2 border rounded-md space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate flex-1 mr-2">{bsUploadProgress.filename}</span>
                    <span>{bsUploadProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${bsUploadProgress.percent}%` }} />
                  </div>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-md cursor-pointer hover:border-primary hover:bg-muted/30 transition-colors">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Uploader un blackscreen MP4</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    className="hidden"
                    disabled={bsUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadBlackscreen(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}

              {/* Server files */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Fichiers sur le serveur</span>
                  <Button variant="ghost" size="sm" onClick={loadBlackscreenFiles} disabled={bsLoadingFiles}>
                    {bsLoadingFiles ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
                    <span className="text-xs ml-1">Charger</span>
                  </Button>
                </div>
                {bsServerFiles.length > 0 && (
                  <div className="mt-1 max-h-32 overflow-y-auto border rounded-md divide-y">
                    {bsServerFiles.map((f) => (
                      <div key={f.filename} className="flex items-center justify-between px-2 py-1.5 text-xs">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Video className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{f.filename}</span>
                          <span className="text-muted-foreground shrink-0">{f.sizeMB} MB</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant={formBlackscreenUrl === f.url ? "default" : "ghost"}
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setFormBlackscreenUrl(formBlackscreenUrl === f.url ? null : f.url)}
                          >
                            {formBlackscreenUrl === f.url ? "Actif" : "Utiliser"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteBlackscreenFile(f.filename, f.url)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected blackscreen */}
              {formBlackscreenUrl && (
                <div className="flex items-center gap-2 text-xs p-2 bg-primary/10 rounded-md">
                  <Video className="h-3 w-3 shrink-0" />
                  <span className="truncate flex-1 font-mono">{formBlackscreenUrl.split("/").pop()}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-destructive hover:text-destructive shrink-0"
                    onClick={() => setFormBlackscreenUrl(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Opacity slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">Opacité de l'overlay</Label>
                  <span className="text-xs font-medium">{Math.round(formBlackscreenOpacity * 100)}%</span>
                </div>
                <Slider
                  value={[formBlackscreenOpacity * 100]}
                  onValueChange={([v]) => setFormBlackscreenOpacity(v / 100)}
                  min={5}
                  max={100}
                  step={5}
                  disabled={!formBlackscreenUrl}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleDialogClose(false)}>Annuler</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
