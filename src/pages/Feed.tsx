import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import AppHeader from "@/components/AppHeader";
import type { User } from "@supabase/supabase-js";
import {
  Loader2,
  Search,
  ShieldAlert,
  FolderOpen,
  Clock,
  Image,
  FileText,
  User as UserIcon,
  Activity,
  Film,
} from "lucide-react";

const ADMIN_EMAIL = "tehdazz@gmail.com";

interface ProjectRow {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  scenes: any;
  prompts: any;
  image_model: string | null;
  preset_id: string | null;
}

interface UserInfo {
  id: string;
  email: string;
}

export default function Feed() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [users, setUsers] = useState<Map<string, UserInfo>>(new Map());
  const [presets, setPresets] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [liveIndicator, setLiveIndicator] = useState(false);
  const liveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const isAdmin = user?.email === ADMIN_EMAIL;

  // Load projects + users
  useEffect(() => {
    if (!isAdmin) return;

    const loadData = async () => {
      setIsLoading(true);

      const { data: projectsData } = await supabase
        .from("projects")
        .select("id, name, user_id, created_at, updated_at, scenes, prompts, image_model, preset_id")
        .order("created_at", { ascending: false })
        .limit(200);

      if (projectsData) {
        setProjects(projectsData as ProjectRow[]);

        // Load unique user emails via edge-compatible approach
        const userIds = [...new Set(projectsData.map((p) => p.user_id))];
        const userMap = new Map<string, UserInfo>();
        for (const uid of userIds) {
          // Use a direct query to auth.users via RPC or just show user_id
          // Since we can't query auth.users from client, we'll use the service role on first load
          userMap.set(uid, { id: uid, email: uid.substring(0, 8) + "..." });
        }
        setUsers(userMap);

        // Load preset names
        const presetIds = [...new Set(projectsData.map((p) => p.preset_id).filter(Boolean))];
        if (presetIds.length > 0) {
          const { data: presetsData } = await supabase
            .from("presets")
            .select("id, name")
            .in("id", presetIds);
          if (presetsData) {
            const pm = new Map<string, string>();
            presetsData.forEach((p: any) => pm.set(p.id, p.name));
            setPresets(pm);
          }
        }

        // Now load user emails from a custom RPC or fallback
        await loadUserEmails(userIds, userMap);
      }

      setIsLoading(false);
    };

    loadData();
  }, [isAdmin]);

  const loadUserEmails = async (userIds: string[], currentMap: Map<string, UserInfo>) => {
    try {
      for (const uid of userIds) {
        const { data } = await supabase.rpc("get_user_email", { p_user_id: uid }) as any;
        if (data) {
          currentMap.set(uid, { id: uid, email: data });
        }
      }
      setUsers(new Map(currentMap));
    } catch {
      // RPC not available — user IDs shown truncated
    }
  };

  // Real-time subscription
  useEffect(() => {
    if (!isAdmin) return;

    const channel = supabase
      .channel("admin-feed-projects")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "projects" },
        (payload) => {
          const newProject = payload.new as ProjectRow;
          setProjects((prev) => [newProject, ...prev]);
          flashLive();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects" },
        (payload) => {
          const updated = payload.new as ProjectRow;
          setProjects((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
          );
          flashLive();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "projects" },
        (payload) => {
          const deletedId = (payload.old as any).id;
          setProjects((prev) => prev.filter((p) => p.id !== deletedId));
          flashLive();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const flashLive = () => {
    setLiveIndicator(true);
    if (liveRef.current) clearTimeout(liveRef.current);
    liveRef.current = setTimeout(() => setLiveIndicator(false), 1500);
  };

  // Helpers
  const getSceneCount = (project: ProjectRow) => {
    if (Array.isArray(project.scenes)) return project.scenes.length;
    return 0;
  };

  const getPromptCount = (project: ProjectRow) => {
    if (!Array.isArray(project.prompts)) return 0;
    return project.prompts.filter((p: any) => p?.prompt).length;
  };

  const getImageCount = (project: ProjectRow) => {
    if (!Array.isArray(project.prompts)) return 0;
    return project.prompts.filter((p: any) => p?.imageUrl).length;
  };

  const timeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "maintenant";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    return `il y a ${days}j`;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filtered = projects.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const userEmail = users.get(p.user_id)?.email || "";
    return (
      p.name?.toLowerCase().includes(q) ||
      userEmail.toLowerCase().includes(q) ||
      p.id.includes(q)
    );
  });

  // Loading / auth states
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Feed" />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <ShieldAlert className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Connexion requise</h1>
          <p className="text-muted-foreground">Connecte-toi pour acceder a cette page.</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Feed" />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <ShieldAlert className="h-16 w-16 mx-auto text-destructive/50 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Acces refuse</h1>
          <p className="text-muted-foreground">Cette page est reservee a l'administrateur.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Admin Feed" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Feed projets</h1>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
                  liveIndicator ? "bg-green-400 animate-pulse" : "bg-green-500/60"
                }`}
              />
              <span className="text-xs text-muted-foreground font-medium">LIVE</span>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">
            {projects.length} projets
          </Badge>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, email, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatsCard
            icon={<FolderOpen className="h-4 w-4" />}
            label="Projets"
            value={projects.length}
          />
          <StatsCard
            icon={<UserIcon className="h-4 w-4" />}
            label="Utilisateurs"
            value={new Set(projects.map((p) => p.user_id)).size}
          />
          <StatsCard
            icon={<Clock className="h-4 w-4" />}
            label="Aujourd'hui"
            value={projects.filter((p) => {
              const d = new Date(p.created_at);
              const now = new Date();
              return d.toDateString() === now.toDateString();
            }).length}
          />
          <StatsCard
            icon={<Activity className="h-4 w-4" />}
            label="Actifs (24h)"
            value={projects.filter((p) => {
              return Date.now() - new Date(p.updated_at).getTime() < 24 * 60 * 60 * 1000;
            }).length}
          />
        </div>

        {/* Projects list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {search ? "Aucun resultat" : "Aucun projet"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((project) => {
              const sceneCount = getSceneCount(project);
              const promptCount = getPromptCount(project);
              const imageCount = getImageCount(project);
              const userEmail = users.get(project.user_id)?.email || project.user_id.substring(0, 8);
              const presetName = project.preset_id ? presets.get(project.preset_id) : null;

              return (
                <Card
                  key={project.id}
                  className="p-4 hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/project?id=${project.id}`)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                          {project.name || "Sans titre"}
                        </h3>
                        {project.image_model && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {project.image_model}
                          </Badge>
                        )}
                        {presetName && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {presetName}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserIcon className="h-3 w-3" />
                          {userEmail}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(project.created_at)}
                        </span>
                        <span className="text-muted-foreground/50">
                          ID: {project.id.substring(0, 8)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <StatPill icon={<Film className="h-3 w-3" />} value={sceneCount} label="scenes" />
                      <StatPill icon={<FileText className="h-3 w-3" />} value={promptCount} label="prompts" />
                      <StatPill icon={<Image className="h-3 w-3" />} value={imageCount} label="images" />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(project.updated_at)}
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatsCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function StatPill({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" title={`${value} ${label}`}>
      {icon}
      <span className="font-medium">{value}</span>
    </div>
  );
}
