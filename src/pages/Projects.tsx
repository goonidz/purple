import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Eye, ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PresetManager } from "@/components/PresetManager";

interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  scenes: any;
  prompts: any;
}

const Projects = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [workflowStep, setWorkflowStep] = useState<"upload" | "transcription" | "review" | "scene-config" | "prompt-config" | "image-config" | "final">("upload");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [transcriptData, setTranscriptData] = useState<any>(null);
  const [sceneDuration0to1, setSceneDuration0to1] = useState(4);
  const [sceneDuration1to3, setSceneDuration1to3] = useState(6);
  const [sceneDuration3plus, setSceneDuration3plus] = useState(8);
  const [examplePrompts, setExamplePrompts] = useState<string[]>(["", "", ""]);
  const [imageWidth, setImageWidth] = useState(1920);
  const [imageHeight, setImageHeight] = useState(1080);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [styleReferenceFile, setStyleReferenceFile] = useState<File | null>(null);
  const [styleReferenceUrl, setStyleReferenceUrl] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      } else {
        loadProjects();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error: any) {
      console.error("Error loading projects:", error);
      toast.error("Erreur lors du chargement des projets");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAudioUpload = async (file: File) => {
    if (!newProjectName.trim()) {
      toast.error("Veuillez entrer un nom de projet");
      return;
    }

    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Upload audio to storage with user ID in path
      const audioFileName = `${user.id}/${Date.now()}_${file.name}`;
      const { data: audioData, error: audioError } = await supabase.storage
        .from("audio-files")
        .upload(audioFileName, file);

      if (audioError) throw audioError;

      const { data: { publicUrl } } = supabase.storage
        .from("audio-files")
        .getPublicUrl(audioFileName);

      // Create project with audio URL
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .insert([
          {
            user_id: user.id,
            name: newProjectName.trim(),
            audio_url: publicUrl,
          },
        ])
        .select()
        .single();

      if (projectError) throw projectError;

      setCurrentProjectId(projectData.id);
      setWorkflowStep("transcription");
      toast.success("Audio importé, transcription en cours...");

      // Call transcription edge function
      const { data: transcriptionResult, error: transcriptError } = await supabase.functions.invoke(
        "transcribe-audio",
        {
          body: { audioUrl: publicUrl },
        }
      );

      if (transcriptError) throw transcriptError;

      // Update project with transcript
      const { error: updateError } = await supabase
        .from("projects")
        .update({ transcript_json: transcriptionResult })
        .eq("id", projectData.id);

      if (updateError) throw updateError;

      setTranscriptData(transcriptionResult);
      setWorkflowStep("review");
      toast.success("Transcription terminée !");
    } catch (error: any) {
      console.error("Error creating project:", error);
      toast.error("Erreur : " + (error.message || "Erreur inconnue"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleStyleImageUpload = async (file: File) => {
    if (!currentProjectId) return;
    
    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const fileName = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("style-references")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("style-references")
        .getPublicUrl(fileName);

      setStyleReferenceUrl(publicUrl);
      toast.success("Image de référence uploadée !");
    } catch (error: any) {
      console.error("Error uploading style image:", error);
      toast.error("Erreur lors de l'upload de l'image");
    } finally {
      setIsCreating(false);
    }
  };

  const handleFinalizeConfiguration = async () => {
    if (!currentProjectId) return;
    
    setIsCreating(true);
    try {
      // Save all configuration to database
      const { error } = await supabase
        .from("projects")
        .update({
          scene_duration_0to1: sceneDuration0to1,
          scene_duration_1to3: sceneDuration1to3,
          scene_duration_3plus: sceneDuration3plus,
          example_prompts: examplePrompts,
          image_width: imageWidth,
          image_height: imageHeight,
          aspect_ratio: aspectRatio,
          style_reference_url: styleReferenceUrl || null,
        })
        .eq("id", currentProjectId);

      if (error) throw error;

      toast.success("Configuration enregistrée !");
      setIsDialogOpen(false);
      setWorkflowStep("upload");
      setNewProjectName("");
      setTranscriptData(null);
      setCurrentProjectId(null);
      await loadProjects();
      navigate(`/?project=${currentProjectId}`);
    } catch (error: any) {
      console.error("Error saving configuration:", error);
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le projet "${projectName}" ?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) throw error;

      toast.success("Projet supprimé");
      await loadProjects();
    } catch (error: any) {
      console.error("Error deleting project:", error);
      toast.error("Erreur lors de la suppression du projet");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getSceneCount = (scenes: any) => {
    if (!scenes) return 0;
    return Array.isArray(scenes) ? scenes.length : 0;
  };

  const getPromptCount = (prompts: any) => {
    if (!prompts) return 0;
    return Array.isArray(prompts) ? prompts.length : 0;
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <div className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Retour
              </Button>
              <h1 className="text-xl font-bold">Mes Projets</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{user.email}</span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Déconnexion
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold">
              Tous les projets ({projects.length})
            </h2>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nouveau projet
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {workflowStep === "upload" && "Créer un nouveau projet"}
                    {workflowStep === "transcription" && "Transcription en cours..."}
                    {workflowStep === "review" && "Transcription terminée"}
                    {workflowStep === "scene-config" && "Configuration des scènes"}
                    {workflowStep === "prompt-config" && "Configuration des prompts"}
                    {workflowStep === "image-config" && "Configuration des images"}
                  </DialogTitle>
                  <DialogDescription>
                    {workflowStep === "upload" && "Importez un fichier audio (MP3 ou WAV) pour créer votre vidéo"}
                    {workflowStep === "transcription" && "Veuillez patienter pendant que nous transcrivons votre audio"}
                    {workflowStep === "review" && "Vérifiez la transcription et continuez vers la configuration"}
                    {workflowStep === "scene-config" && "Définissez les durées de scènes selon le contenu"}
                    {workflowStep === "prompt-config" && "Ajoutez 2-3 exemples de prompts pour guider l'IA"}
                    {workflowStep === "image-config" && "Configurez les dimensions et le style des images"}
                  </DialogDescription>
                </DialogHeader>

                {workflowStep === "upload" && (
                  <div className="space-y-4 py-4">
                    <Input
                      placeholder="Nom du projet"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      disabled={isCreating}
                    />
                    <div className="border-2 border-dashed rounded-lg p-8 text-center">
                      <Input
                        type="file"
                        accept="audio/mp3,audio/wav,audio/mpeg"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleAudioUpload(file);
                          }
                        }}
                        className="hidden"
                        id="audio-upload-mobile"
                        disabled={isCreating}
                      />
                      <label htmlFor="audio-upload-mobile" className="cursor-pointer">
                        <div className="flex flex-col items-center gap-2">
                          <Plus className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            Cliquez pour importer un fichier audio
                          </p>
                          <p className="text-xs text-muted-foreground">
                            MP3 ou WAV
                          </p>
                        </div>
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setNewProjectName("");
                        }}
                        disabled={isCreating}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "transcription" && (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Transcription en cours...
                    </p>
                  </div>
                )}

                {workflowStep === "review" && transcriptData && (
                  <div className="space-y-4 py-4">
                    <div className="rounded-lg border p-4 max-h-60 overflow-y-auto bg-muted/30">
                      <h3 className="font-semibold mb-2 text-sm">Transcription :</h3>
                      {transcriptData.full_text ? (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {transcriptData.full_text}
                        </p>
                      ) : transcriptData.segments && transcriptData.segments.length > 0 ? (
                        <div className="space-y-2 text-sm">
                          {transcriptData.segments.map((segment: any, index: number) => (
                            <p key={index} className="text-muted-foreground">
                              {segment.text}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          Aucune transcription disponible
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setWorkflowStep("upload");
                          setNewProjectName("");
                          setTranscriptData(null);
                          setCurrentProjectId(null);
                        }}
                      >
                        Annuler
                      </Button>
                      <Button onClick={() => setWorkflowStep("scene-config")}>
                        Continuer la configuration
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "scene-config" && (
                  <div className="space-y-4 py-4">
                    <div className="mb-4">
                      <PresetManager
                        currentConfig={{
                          sceneDuration0to1,
                          sceneDuration1to3,
                          sceneDuration3plus,
                          examplePrompts,
                          imageWidth,
                          imageHeight,
                          aspectRatio,
                          styleReferenceUrl,
                        }}
                        onLoadPreset={(preset) => {
                          setSceneDuration0to1(preset.scene_duration_0to1);
                          setSceneDuration1to3(preset.scene_duration_1to3);
                          setSceneDuration3plus(preset.scene_duration_3plus);
                          setExamplePrompts(preset.example_prompts);
                          setImageWidth(preset.image_width);
                          setImageHeight(preset.image_height);
                          setAspectRatio(preset.aspect_ratio);
                          setStyleReferenceUrl(preset.style_reference_url || "");
                          toast.success("Preset chargé !");
                        }}
                      />
                    </div>
                    <div className="space-y-4">
                      <div>
                        <Label>Durée pour scènes de 0-1 seconde</Label>
                        <Input
                          type="number"
                          value={sceneDuration0to1}
                          onChange={(e) => setSceneDuration0to1(parseInt(e.target.value))}
                          min={1}
                          max={30}
                        />
                      </div>
                      <div>
                        <Label>Durée pour scènes de 1-3 secondes</Label>
                        <Input
                          type="number"
                          value={sceneDuration1to3}
                          onChange={(e) => setSceneDuration1to3(parseInt(e.target.value))}
                          min={1}
                          max={30}
                        />
                      </div>
                      <div>
                        <Label>Durée pour scènes de 3+ secondes</Label>
                        <Input
                          type="number"
                          value={sceneDuration3plus}
                          onChange={(e) => setSceneDuration3plus(parseInt(e.target.value))}
                          min={1}
                          max={30}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setWorkflowStep("review")}>
                        Précédent
                      </Button>
                      <Button onClick={() => setWorkflowStep("prompt-config")}>
                        Suivant
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "prompt-config" && (
                  <div className="space-y-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      Ajoutez 2-3 exemples de prompts pour que l'IA comprenne le style souhaité
                    </p>
                    {examplePrompts.map((prompt, index) => (
                      <div key={index}>
                        <Label>Exemple de prompt {index + 1}</Label>
                        <Textarea
                          value={prompt}
                          onChange={(e) => {
                            const newPrompts = [...examplePrompts];
                            newPrompts[index] = e.target.value;
                            setExamplePrompts(newPrompts);
                          }}
                          placeholder="Exemple: Un paysage montagneux au coucher du soleil, style photographique réaliste"
                          rows={3}
                        />
                      </div>
                    ))}
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setWorkflowStep("scene-config")}>
                        Précédent
                      </Button>
                      <Button onClick={() => setWorkflowStep("image-config")}>
                        Suivant
                      </Button>
                    </div>
                  </div>
                )}

                {workflowStep === "image-config" && (
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Aspect Ratio</Label>
                      <Select 
                        value={aspectRatio} 
                        onValueChange={(value) => {
                          setAspectRatio(value);
                          const ratios: Record<string, [number, number]> = {
                            "16:9": [1920, 1080],
                            "9:16": [1080, 1920],
                            "1:1": [1080, 1080],
                            "4:3": [1440, 1080],
                          };
                          if (ratios[value]) {
                            const [w, h] = ratios[value];
                            setImageWidth(w);
                            setImageHeight(h);
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16:9">16:9 (Paysage)</SelectItem>
                          <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                          <SelectItem value="1:1">1:1 (Carré)</SelectItem>
                          <SelectItem value="4:3">4:3 (Standard)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Largeur (px)</Label>
                        <Input
                          type="number"
                          value={imageWidth}
                          onChange={(e) => setImageWidth(parseInt(e.target.value))}
                          min={512}
                          max={1920}
                        />
                      </div>
                      <div>
                        <Label>Hauteur (px)</Label>
                        <Input
                          type="number"
                          value={imageHeight}
                          onChange={(e) => setImageHeight(parseInt(e.target.value))}
                          min={512}
                          max={1920}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Image de référence de style (optionnel)</Label>
                      <div className="border-2 border-dashed rounded-lg p-4 text-center">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleStyleImageUpload(file);
                            }
                          }}
                          className="hidden"
                          id="style-upload"
                          disabled={isCreating}
                        />
                        <label htmlFor="style-upload" className="cursor-pointer">
                          <div className="flex flex-col items-center gap-2">
                            {isCreating ? (
                              <>
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">Upload en cours...</p>
                              </>
                            ) : styleReferenceUrl ? (
                              <>
                                <img src={styleReferenceUrl} alt="Style reference" className="h-24 w-24 object-cover rounded" />
                                <p className="text-xs text-muted-foreground">Cliquez pour changer</p>
                              </>
                            ) : (
                              <>
                                <Plus className="h-6 w-6 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Cliquez pour uploader une image</p>
                              </>
                            )}
                          </div>
                        </label>
                      </div>
                    </div>
                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setWorkflowStep("prompt-config")}>
                        Précédent
                      </Button>
                      <Button onClick={handleFinalizeConfiguration} disabled={isCreating}>
                        {isCreating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Création du projet...
                          </>
                        ) : (
                          "Créer le projet"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">Aucun projet pour le moment</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Créer votre premier projet
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Scènes</TableHead>
                  <TableHead>Prompts</TableHead>
                  <TableHead>Créé le</TableHead>
                  <TableHead>Modifié le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">{project.name}</TableCell>
                    <TableCell>{getSceneCount(project.scenes)}</TableCell>
                    <TableCell>{getPromptCount(project.prompts)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(project.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(project.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/?project=${project.id}`)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Ouvrir
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteProject(project.id, project.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Projects;
