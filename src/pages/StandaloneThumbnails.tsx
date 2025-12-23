import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ImageIcon, Plus, Trash2, Clock, Edit, FolderOpen, ArrowLeft } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import { ThumbnailGenerator } from "@/components/ThumbnailGenerator";
import { toast } from "sonner";

interface ThumbnailProject {
  id: string;
  title: string;
  script: string;
  preset_id: string | null;
  created_at: string;
  updated_at: string;
  thumbnail_count?: number;
}

const StandaloneThumbnails = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get("project");

  const [projects, setProjects] = useState<ThumbnailProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ThumbnailProject | null>(null);
  
  // New project form
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newScript, setNewScript] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Edit mode
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editScript, setEditScript] = useState("");

  useEffect(() => {
    document.title = "Miniatures";
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      loadProjects();
    };
    checkAuth();
  }, [navigate]);

  // Load project from URL if specified
  useEffect(() => {
    if (projectIdFromUrl && projects.length > 0) {
      const project = projects.find(p => p.id === projectIdFromUrl);
      if (project) {
        setSelectedProject(project);
      }
    }
  }, [projectIdFromUrl, projects]);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get projects with thumbnail count
      const { data: projectsData, error } = await supabase
        .from("thumbnail_projects")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      // Get thumbnail counts for each project
      const projectsWithCounts = await Promise.all(
        (projectsData || []).map(async (project) => {
          const { count } = await supabase
            .from("generated_thumbnails")
            .select("*", { count: "exact", head: true })
            .eq("thumbnail_project_id", project.id);
          
          return { ...project, thumbnail_count: count || 0 };
        })
      );

      setProjects(projectsWithCounts);
    } catch (error) {
      console.error("Error loading projects:", error);
      toast.error("Erreur lors du chargement des projets");
    } finally {
      setIsLoading(false);
    }
  };

  const createProject = async () => {
    if (!newTitle.trim() || !newScript.trim()) {
      toast.error("Veuillez remplir le titre et le script");
      return;
    }

    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const { data, error } = await supabase
        .from("thumbnail_projects")
        .insert({
          user_id: user.id,
          title: newTitle.trim(),
          script: newScript.trim(),
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Projet créé !");
      setIsNewProjectDialogOpen(false);
      setNewTitle("");
      setNewScript("");
      
      // Add to list and select it
      const newProject = { ...data, thumbnail_count: 0 };
      setProjects([newProject, ...projects]);
      setSelectedProject(newProject);
      setSearchParams({ project: data.id });
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Erreur lors de la création du projet");
    } finally {
      setIsCreating(false);
    }
  };

  const updateProject = async () => {
    if (!selectedProject || !editTitle.trim() || !editScript.trim()) return;

    try {
      const { error } = await supabase
        .from("thumbnail_projects")
        .update({
          title: editTitle.trim(),
          script: editScript.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedProject.id);

      if (error) throw error;

      toast.success("Projet mis à jour !");
      setIsEditDialogOpen(false);
      
      // Update in state
      const updatedProject = { ...selectedProject, title: editTitle.trim(), script: editScript.trim() };
      setSelectedProject(updatedProject);
      setProjects(projects.map(p => p.id === selectedProject.id ? updatedProject : p));
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm("Supprimer ce projet et toutes ses miniatures ?")) return;

    try {
      const { error } = await supabase
        .from("thumbnail_projects")
        .delete()
        .eq("id", projectId);

      if (error) throw error;

      toast.success("Projet supprimé");
      setProjects(projects.filter(p => p.id !== projectId));
      
      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
        setSearchParams({});
      }
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const selectProject = (project: ThumbnailProject) => {
    setSelectedProject(project);
    setSearchParams({ project: project.id });
  };

  const backToList = () => {
    setSelectedProject(null);
    setSearchParams({});
  };

  const openEditDialog = () => {
    if (selectedProject) {
      setEditTitle(selectedProject.title);
      setEditScript(selectedProject.script);
      setIsEditDialogOpen(true);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <AppHeader title="Miniatures" />

      <div className="container py-8 max-w-6xl">
        {!selectedProject ? (
          // Project list view
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold">Mes projets de miniatures</h2>
                <p className="text-muted-foreground">
                  Gérez vos projets de génération de miniatures
                </p>
              </div>
              <Button onClick={() => setIsNewProjectDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Nouveau projet
              </Button>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="p-6 animate-pulse">
                    <div className="h-6 bg-muted rounded w-3/4 mb-4" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </Card>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <Card className="p-12 text-center">
                <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">Aucun projet</h3>
                <p className="text-muted-foreground mb-6">
                  Créez votre premier projet de miniatures pour commencer
                </p>
                <Button onClick={() => setIsNewProjectDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Créer un projet
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map(project => (
                  <Card
                    key={project.id}
                    className="p-6 hover:shadow-lg transition-shadow cursor-pointer group"
                    onClick={() => selectProject(project)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-lg line-clamp-2 group-hover:text-primary transition-colors">
                        {project.title}
                      </h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity -mt-1 -mr-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteProject(project.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                      {project.script.substring(0, 100)}...
                    </p>
                    
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        <span>{project.thumbnail_count || 0} miniatures</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(project.updated_at)}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Project detail view with ThumbnailGenerator
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={backToList}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Retour aux projets
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={openEditDialog}>
                <Edit className="h-4 w-4 mr-2" />
                Modifier
              </Button>
            </div>

            <div className="border-b pb-4">
              <h2 className="text-2xl font-bold">{selectedProject.title}</h2>
              <p className="text-muted-foreground text-sm mt-1">
                {selectedProject.script.length} caractères • Modifié le {formatDate(selectedProject.updated_at)}
              </p>
            </div>

            <ThumbnailGenerator
              projectId={selectedProject.id}
              videoScript={selectedProject.script}
              videoTitle={selectedProject.title}
              standalone={true}
              thumbnailProjectId={selectedProject.id}
            />
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={isNewProjectDialogOpen} onOpenChange={setIsNewProjectDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau projet de miniatures</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-title">Titre de la vidéo</Label>
              <Input
                id="new-title"
                placeholder="Ex: 10 conseils pour réussir sur YouTube"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-script">Script / Contenu de la vidéo</Label>
              <Textarea
                id="new-script"
                placeholder="Collez ici le script ou le contenu principal de votre vidéo..."
                value={newScript}
                onChange={(e) => setNewScript(e.target.value)}
                className="min-h-[250px]"
              />
              <p className="text-xs text-muted-foreground">
                Le script sera utilisé pour générer des miniatures pertinentes au contenu
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewProjectDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={createProject} disabled={isCreating || !newTitle.trim() || !newScript.trim()}>
              {isCreating ? "Création..." : "Créer le projet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifier le projet</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Titre de la vidéo</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-script">Script / Contenu de la vidéo</Label>
              <Textarea
                id="edit-script"
                value={editScript}
                onChange={(e) => setEditScript(e.target.value)}
                className="min-h-[250px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={updateProject} disabled={!editTitle.trim() || !editScript.trim()}>
              Sauvegarder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StandaloneThumbnails;
