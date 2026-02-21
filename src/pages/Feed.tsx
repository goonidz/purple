import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  RefreshCw,
  CalendarDays,
} from "lucide-react";

const ADMIN_UID = "b5ea24ac-499a-4cff-bd6f-a946b0f017fd";

const RANGE_OPTIONS = [
  { value: "1", label: "24 heures" },
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
  { value: "90", label: "3 mois" },
  { value: "365", label: "1 an" },
  { value: "all", label: "Tout" },
];

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
  const [rangeDays, setRangeDays] = useState("7");
  const liveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const isAdmin = user?.id === ADMIN_UID;

  // Load data when range changes
  useEffect(() => {
    if (!isAdmin) return;
    loadProjects();
  }, [isAdmin, rangeDays]);

  const loadProjects = async () => {
    setIsLoading(true);

    let query = supabase
      .from("projects")
      .select("id, name, user_id, created_at, updated_at, scenes, prompts, image_model, preset_id")
      .order("created_at", { ascending: false });

    if (rangeDays !== "all") {
      const since = new Date(Date.now() - parseInt(rangeDays) * 86400000).toISOString();
      query = query.gte("created_at", since);
    }

    const { data: projectsData, error } = await query.limit(500);

    if (error) {
      console.error("Feed load error:", error.message);
      setIsLoading(false);
      return;
    }

    if (projectsData) {
      setProjects(projectsData as ProjectRow[]);

      const userIds = [...new Set(projectsData.map((p) => p.user_id))];
      const userMap = new Map<string, UserInfo>();
      userIds.forEach((uid) => userMap.set(uid, { id: uid, email: uid.substring(0, 8) + "..." }));

      // Load preset names
      const presetIds = [...new Set(projectsData.map((p) => p.preset_id).filter(Boolean))] as string[];
      if (presetIds.length > 0) {
        const { data: presetsData } = await supabase.from("presets").select("id, name").in("id", presetIds);
        if (presetsData) {
          const pm = new Map<string, string>();
          presetsData.forEach((p: any) => pm.set(p.id, p.name));
          setPresets(pm);
        }
      }

      // Resolve emails
      for (const uid of userIds) {
        try {
          const { data } = await supabase.rpc("get_user_email", { p_user_id: uid }) as any;
          if (data) userMap.set(uid, { id: uid, email: data });
        } catch { /* ignore */ }
      }
      setUsers(new Map(userMap));
    }

    setIsLoading(false);
  };

  // Realtime
  useEffect(() => {
    if (!isAdmin) return;

    const channel = supabase
      .channel("admin-feed-projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setProjects((prev) => [payload.new as ProjectRow, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          const updated = payload.new as ProjectRow;
          setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
        } else if (payload.eventType === "DELETE") {
          const deletedId = (payload.old as any).id;
          setProjects((prev) => prev.filter((p) => p.id !== deletedId));
        }
        flashLive();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAdmin]);

  const flashLive = () => {
    setLiveIndicator(true);
    if (liveRef.current) clearTimeout(liveRef.current);
    liveRef.current = setTimeout(() => setLiveIndicator(false), 1500);
  };

  const getSceneCount = (p: ProjectRow) => Array.isArray(p.scenes) ? p.scenes.length : 0;
  const getPromptCount = (p: ProjectRow) => Array.isArray(p.prompts) ? p.prompts.filter((x: any) => x?.prompt).length : 0;
  const getImageCount = (p: ProjectRow) => Array.isArray(p.prompts) ? p.prompts.filter((x: any) => x?.imageUrl).length : 0;

  const timeAgo = (date: string) => {
    const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (sec < 60) return "maintenant";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}j`;
  };

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // Group by date
  const grouped = useMemo(() => {
    let list = projects;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => {
        const email = users.get(p.user_id)?.email || "";
        return p.name?.toLowerCase().includes(q) || email.toLowerCase().includes(q) || p.id.includes(q);
      });
    }

    const groups: { label: string; projects: ProjectRow[] }[] = [];
    const buckets = new Map<string, ProjectRow[]>();

    for (const p of list) {
      const d = new Date(p.created_at);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
      let label: string;
      if (diffDays === 0) label = "Aujourd'hui";
      else if (diffDays === 1) label = "Hier";
      else if (diffDays < 7) label = `Il y a ${diffDays} jours`;
      else label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label)!.push(p);
    }

    for (const [label, items] of buckets) {
      groups.push({ label, projects: items });
    }

    return groups;
  }, [projects, search, users]);

  const totalFiltered = grouped.reduce((sum, g) => sum + g.projects.length, 0);

  // Stats
  const stats = useMemo(() => {
    const uniqueUsers = new Set(projects.map((p) => p.user_id)).size;
    const today = projects.filter((p) => new Date(p.created_at).toDateString() === new Date().toDateString()).length;
    const active24h = projects.filter((p) => Date.now() - new Date(p.updated_at).getTime() < 86400000).length;
    const totalImages = projects.reduce((s, p) => s + getImageCount(p), 0);
    return { total: projects.length, uniqueUsers, today, active24h, totalImages };
  }, [projects]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Feed" />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <ShieldAlert className="h-16 w-16 mx-auto text-destructive/50 mb-4" />
          <h1 className="text-2xl font-bold mb-2">{!user ? "Connexion requise" : "Acces refuse"}</h1>
          <p className="text-muted-foreground">{!user ? "Connecte-toi pour acceder a cette page." : "Cette page est reservee a l'administrateur."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Admin Feed" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Feed</h1>
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${liveIndicator ? "bg-green-400 animate-pulse" : "bg-green-500/60"}`} />
              <span className="text-xs text-muted-foreground font-medium">LIVE</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={rangeDays} onValueChange={setRangeDays}>
              <SelectTrigger className="w-[140px] h-9 text-sm">
                <CalendarDays className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={loadProjects} title="Rafraichir">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher par nom, email, ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-9" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatsCard icon={<FolderOpen className="h-4 w-4" />} label="Projets" value={stats.total} />
          <StatsCard icon={<UserIcon className="h-4 w-4" />} label="Utilisateurs" value={stats.uniqueUsers} />
          <StatsCard icon={<Clock className="h-4 w-4" />} label="Aujourd'hui" value={stats.today} />
          <StatsCard icon={<Activity className="h-4 w-4" />} label="Actifs 24h" value={stats.active24h} />
          <StatsCard icon={<Image className="h-4 w-4" />} label="Images" value={stats.totalImages} />
        </div>

        {/* Project list, grouped by date */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
            ))}
          </div>
        ) : totalFiltered === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {search ? "Aucun resultat" : "Aucun projet dans cette periode"}
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">{group.projects.length}</span>
                </div>

                <div className="space-y-1.5">
                  {group.projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      userEmail={users.get(project.user_id)?.email || project.user_id.substring(0, 8)}
                      presetName={project.preset_id ? presets.get(project.preset_id) || null : null}
                      sceneCount={getSceneCount(project)}
                      promptCount={getPromptCount(project)}
                      imageCount={getImageCount(project)}
                      timeAgo={timeAgo(project.updated_at)}
                      formattedDate={formatDate(project.created_at)}
                      onClick={() => navigate(`/project?id=${project.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project, userEmail, presetName, sceneCount, promptCount, imageCount, timeAgo, formattedDate, onClick,
}: {
  project: ProjectRow;
  userEmail: string;
  presetName: string | null;
  sceneCount: number;
  promptCount: number;
  imageCount: number;
  timeAgo: string;
  formattedDate: string;
  onClick: () => void;
}) {
  return (
    <Card className="p-3.5 hover:bg-accent/50 transition-colors cursor-pointer" onClick={onClick}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm truncate">{project.name || "Sans titre"}</h3>
            {project.image_model && (
              <Badge variant="outline" className="text-[10px] shrink-0 py-0">{project.image_model}</Badge>
            )}
            {presetName && (
              <Badge variant="secondary" className="text-[10px] shrink-0 py-0">{presetName}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <UserIcon className="h-3 w-3" />
              {userEmail}
            </span>
            <span>{formattedDate}</span>
            <span className="text-muted-foreground/40 font-mono">{project.id.substring(0, 8)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          <Pill icon={<Film className="h-3 w-3" />} value={sceneCount} />
          <Pill icon={<FileText className="h-3 w-3" />} value={promptCount} />
          <Pill icon={<Image className="h-3 w-3" />} value={imageCount} />
          <span className="text-[11px] w-10 text-right tabular-nums">{timeAgo}</span>
        </div>
      </div>
    </Card>
  );
}

function StatsCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary">{icon}</div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function Pill({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <div className="flex items-center gap-1" title={`${value}`}>
      {icon}
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
