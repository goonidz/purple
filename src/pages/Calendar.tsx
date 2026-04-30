import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, Filter, Calendar as CalendarIcon, LayoutGrid, Plus, Link2, Link2Off, Youtube, Check, Search, X, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import AppHeader from "@/components/AppHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, eachDayOfInterval, isSameMonth, isSameDay, addDays, startOfWeek, addWeeks, subWeeks } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import CalendarVideoModal from "@/components/CalendarVideoModal";
import CalendarDayCell from "@/components/CalendarDayCell";
import KanbanBoard from "@/components/KanbanBoard";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Channel {
  id: string;
  name: string;
  color: string;
  script_preset_id?: string | null;
  tts_preset_id?: string | null;
  project_preset_id?: string | null;
  thumbnail_preset_id?: string | null;
  thumbnail_preset_enabled?: boolean | null;
}

interface ContentCalendarEntry {
  id: string;
  user_id: string;
  title: string;
  scheduled_date: string;
  status: string;
  script: string | null;
  audio_url: string | null;
  notes: string | null;
  project_id: string | null;
  youtube_url: string | null;
  channel_id: string | null;
  channel?: Channel | null;
  created_at: string;
  updated_at: string;
}

const defaultColors: Record<string, string> = {
  incomplete: "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-l-[3px] border-orange-500",
  completed: "bg-green-500/20 text-green-600 dark:text-green-400 border-l-[3px] border-green-500",
};

function getEntryStyle(entry: ContentCalendarEntry): React.CSSProperties {
  const isCompleted = entry.status === 'completed';
  const channelColor = entry.channel?.color;
  if (channelColor) {
    return {
      backgroundColor: `${channelColor}20`,
      color: channelColor,
      borderLeft: isCompleted ? '3px solid rgb(34 197 94)' : `3px solid ${channelColor}`,
    };
  }
  return {};
}

function MobileDayCard({
  date,
  entries,
  isToday,
  blurTitles = false,
  onDayClick,
  onEntryClick,
}: {
  date: Date;
  entries: ContentCalendarEntry[];
  isToday: boolean;
  blurTitles?: boolean;
  onDayClick: (date: Date) => void;
  onEntryClick: (entry: ContentCalendarEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxVisible = 3;
  const hasMore = entries.length > maxVisible;
  const visibleEntries = expanded ? entries : entries.slice(0, maxVisible);

  const sortedEntries = [...visibleEntries].sort((a, b) => {
    const aCompleted = a.status === 'completed';
    const bCompleted = b.status === 'completed';
    if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;
    const aColor = a.channel?.color || '#ffffff';
    const bColor = b.channel?.color || '#ffffff';
    return aColor.localeCompare(bColor);
  });

  return (
    <div className={cn(
      "bg-card rounded-lg border shadow-sm overflow-hidden",
      isToday && "ring-2 ring-primary"
    )}>
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted/50 cursor-pointer"
        onClick={() => onDayClick(date)}
      >
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full",
            isToday && "bg-primary text-primary-foreground"
          )}>
            {format(date, "d")}
          </span>
          <span className="text-sm text-muted-foreground capitalize">
            {format(date, "EEEE", { locale: fr })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {entries.length}
            </span>
          )}
          <Plus className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {sortedEntries.length > 0 && (
        <div className="p-2 space-y-1.5">
          {sortedEntries.map((entry) => {
            const hasChannel = !!entry.channel?.name;
            const isCompleted = entry.status === 'completed';
            const entryStyle = getEntryStyle(entry);

            return (
              <div
                key={entry.id}
                className={cn(
                  "text-sm p-2.5 rounded-md flex items-center gap-2 active:scale-[0.98] transition-transform",
                  !hasChannel && (isCompleted ? defaultColors.completed : defaultColors.incomplete)
                )}
                style={hasChannel ? entryStyle : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onEntryClick(entry);
                }}
              >
                {isCompleted && <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-600" />}
                {entry.youtube_url && <Youtube className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />}
                {entry.project_id ? (
                  <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                ) : (
                  <Link2Off className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />
                )}
                {hasChannel && (
                  <div
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: entry.channel!.color }}
                  />
                )}
                <span className={cn("truncate flex-1", blurTitles && "blur-[4px] select-none")}>{entry.title}</span>
              </div>
            );
          })}

          {hasMore && !expanded && (
            <button
              className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1 py-1.5 hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              <ChevronDown className="h-3 w-3" />
              Voir {entries.length - maxVisible} de plus
            </button>
          )}
          {expanded && hasMore && (
            <button
              className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1 py-1.5 hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              <ChevronDown className="h-3 w-3 rotate-180" />
              Réduire
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MobileDayList({
  daysInMonth,
  getEntriesForDay,
  blurTitles = false,
  onDayClick,
  onEntryClick,
  currentMonth,
  onPrevMonth,
  onNextMonth,
}: {
  daysInMonth: Date[];
  getEntriesForDay: (date: Date) => ContentCalendarEntry[];
  blurTitles?: boolean;
  onDayClick: (date: Date) => void;
  onEntryClick: (entry: ContentCalendarEntry) => void;
  currentMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const todayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const visibleDays = daysInMonth.filter((day) => {
    const dayEntries = getEntriesForDay(day);
    return dayEntries.length > 0 || isSameDay(day, new Date());
  });

  return (
    <div className="md:hidden space-y-2">
      {visibleDays.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          Aucune vidéo planifiée sur ces 3 semaines
        </div>
      ) : (
        visibleDays.map((day) => {
          const isToday = isSameDay(day, new Date());
          return (
            <div key={day.toISOString()} ref={isToday ? todayRef : undefined}>
              <MobileDayCard
                date={day}
                entries={getEntriesForDay(day)}
                isToday={isToday}
                blurTitles={blurTitles}
                onDayClick={onDayClick}
                onEntryClick={onEntryClick}
              />
            </div>
          );
        })
      )}

      {/* Week navigation: shifts the 3-week window by one week */}
      <div className="flex items-center gap-2 pt-4 pb-2">
        <Button variant="outline" className="flex-1 gap-2" onClick={onPrevMonth}>
          <ChevronLeft className="h-4 w-4" />
          Semaine précédente
        </Button>
        <Button variant="outline" className="flex-1 gap-2" onClick={onNextMonth}>
          Semaine suivante
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Calendar() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [entries, setEntries] = useState<ContentCalendarEntry[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<ContentCalendarEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'kanban'>('calendar');
  const [compactMode, setCompactMode] = useState(false);
  const [blurTitles, setBlurTitles] = useState(false);
  const [urlSearch, setUrlSearch] = useState("");
  const [urlSearchResult, setUrlSearchResult] = useState<ContentCalendarEntry | null>(null);
  const [urlSearchNotFound, setUrlSearchNotFound] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Ref to track current month for use in callbacks (avoids stale closures)
  const currentMonthRef = useRef(currentMonth);
  useEffect(() => {
    currentMonthRef.current = currentMonth;
  }, [currentMonth]);

  // Define fetch functions BEFORE useEffects that use them (to avoid "Cannot access before initialization")
  const fetchChannels = useCallback(async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("channels")
      .select("*")
      .eq("user_id", user.id)
      .order("name", { ascending: true });

    if (!error && data) {
      setChannels(data);
    }
  }, [user]);

  // Use useCallback to create a stable reference that always uses the current month from ref
  const fetchEntries = useCallback(async () => {
    if (!user) return;
    
    // Use ref to always get the current anchor date (avoids stale closures in subscriptions)
    const anchor = currentMonthRef.current;
    setIsLoading(true);
    // Match the 21-day visible window: prev week + current week + next week (Mon-start).
    const fetchStart = subWeeks(startOfWeek(anchor, { weekStartsOn: 1 }), 1);
    const fetchEnd = addDays(fetchStart, 20);

    const { data, error } = await supabase
      .from("content_calendar")
      .select(`
        id, user_id, title, scheduled_date, status,
        project_id, youtube_url, channel_id,
        created_at, updated_at,
        channel:channels(id, name, color)
      `)
      .eq("user_id", user.id)
      .gte("scheduled_date", format(fetchStart, "yyyy-MM-dd"))
      .lte("scheduled_date", format(fetchEnd, "yyyy-MM-dd"))
      .order("scheduled_date", { ascending: true });

    if (error) {
      console.error("Error fetching calendar entries:", error);
      toast.error("Erreur lors du chargement du calendrier");
    } else {
      setEntries(data as ContentCalendarEntry[]);
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    document.title = "Calendrier";
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
    };
    checkAuth();
  }, [navigate]);

  useEffect(() => {
    if (user) {
      fetchEntries();
      fetchChannels();
    }
  }, [user, currentMonth, fetchEntries, fetchChannels]);

  // Subscribe to realtime updates for calendar entries, projects, and channels
  useEffect(() => {
    if (!user) return;

    console.log('[Calendar] Setting up real-time subscriptions');

    // Subscribe to content_calendar changes
    const calendarChannel = supabase
      .channel(`calendar-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'content_calendar',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('[Calendar] Entry changed:', payload.eventType, payload);
          // Refresh entries when calendar changes
          fetchEntries();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('[Calendar] Project changed:', payload.eventType);
          // If a project name changed, update corresponding calendar entry
          if (payload.eventType === 'UPDATE' && payload.new) {
            const project = payload.new as any;
            if (project.name) {
              // Update calendar entry title if linked to this project
              supabase
                .from('content_calendar')
                .update({ title: project.name })
                .eq('project_id', project.id)
                .then(() => {
                  // Refresh entries to show updated title
                  fetchEntries();
                });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'channels',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('[Calendar] Channel changed:', payload.eventType);
          // Refresh channels list when a channel is added/updated/deleted
          fetchChannels();
          // Also refresh entries in case channel info changed
          fetchEntries();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Calendar] ✅ Real-time subscriptions active');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Calendar] ❌ Real-time subscription error');
        }
      });

    // Polling fallback: refresh every 30 seconds to catch any missed updates
    const pollInterval = setInterval(() => {
      console.log('[Calendar] Polling for updates...');
      fetchEntries();
      fetchChannels();
    }, 30000); // 30 seconds

    return () => {
      console.log('[Calendar] Cleaning up subscriptions');
      supabase.removeChannel(calendarChannel);
      clearInterval(pollInterval);
    };
  }, [user, fetchEntries, fetchChannels]);

  // Navigation slides the 3-week window by one week at a time.
  const handlePrevMonth = () => setCurrentMonth(subWeeks(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addWeeks(currentMonth, 1));
  const handleToday = () => setCurrentMonth(new Date());

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedEntry(null);
    setIsModalOpen(true);
  };

  const handleEntryClick = (entry: ContentCalendarEntry) => {
    setSelectedEntry(entry);
    setSelectedDate(null);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedEntry(null);
    setSelectedDate(null);
  };

  const handleEntrySaved = () => {
    fetchEntries();
    handleModalClose();
  };

  const handleEntryDrop = async (entryId: string, newDate: Date) => {
    const newDateStr = format(newDate, "yyyy-MM-dd");
    
    // Optimistically update the UI
    setEntries(prev => prev.map(entry => 
      entry.id === entryId 
        ? { ...entry, scheduled_date: newDateStr }
        : entry
    ));

    // Update in database
    const { error } = await supabase
      .from("content_calendar")
      .update({ scheduled_date: newDateStr })
      .eq("id", entryId);

    if (error) {
      console.error("Error moving entry:", error);
      toast.error("Erreur lors du déplacement");
      fetchEntries(); // Revert on error
    } else {
      toast.success("Vidéo déplacée");
    }
  };

  const handleAutoGenerateEntries = async (entriesToGenerate: ContentCalendarEntry[]) => {
    if (!user) return;
    let launched = 0;
    for (const entry of entriesToGenerate) {
      try {
        const ch = channels.find(c => c.id === entry.channel_id);
        if (!ch?.script_preset_id || !ch?.tts_preset_id) continue;

        const [scriptPresetRes, ttsPresetRes, projectPresetRes] = await Promise.all([
          supabase.from("script_presets").select("*").eq("id", ch.script_preset_id).single(),
          supabase.from("tts_presets").select("*").eq("id", ch.tts_preset_id).single(),
          ch.project_preset_id
            ? supabase.from("presets").select("*").eq("id", ch.project_preset_id).single()
            : Promise.resolve({ data: null }),
        ]);
        const scriptPreset = scriptPresetRes.data;
        const ttsPreset = ttsPresetRes.data;
        const projectPreset = projectPresetRes.data;
        if (!scriptPreset || !ttsPreset) continue;

        let ttsConfig: Record<string, any> = {
          provider: ttsPreset.provider, voice_id: ttsPreset.voice_id, model: ttsPreset.model,
          speed: ttsPreset.speed, pitch: ttsPreset.pitch, volume: ttsPreset.volume,
          languageBoost: ttsPreset.language_boost, englishNormalization: ttsPreset.english_normalization,
        };
        try {
          const extras = ttsPreset.emotion ? JSON.parse(ttsPreset.emotion) : {};
          if (extras.rvcEnabled) { ttsConfig.rvcEnabled = true; ttsConfig.rvcModelUrl = extras.rvcModelUrl; ttsConfig.rvcIndexUrl = extras.rvcIndexUrl; ttsConfig.rvcPitch = extras.rvcPitch; ttsConfig.rvcIndexRate = extras.rvcIndexRate; }
          if (extras.audioTagsEnabled) { ttsConfig.audioTagsEnabled = true; ttsConfig.audioTagsText = extras.audioTagsText; }
          if (typeof extras.style === "number") ttsConfig.style = extras.style;
          if (typeof extras.speakerBoost === "boolean") ttsConfig.useSpeakerBoost = extras.speakerBoost;
          if (extras.edgeTTSSpeed) ttsConfig.speed = extras.edgeTTSSpeed;
        } catch { /* not JSON */ }

        const projectConfig: Record<string, any> = {};
        if (projectPreset) {
          projectConfig.image_model = (projectPreset as any).image_model || "seedream-4.5";
          projectConfig.image_width = projectPreset.image_width || 1920;
          projectConfig.image_height = projectPreset.image_height || 1080;
          projectConfig.aspect_ratio = projectPreset.aspect_ratio || "16:9";
          projectConfig.duration_ranges = (projectPreset as any).duration_ranges || undefined;
          projectConfig.lora_url = (projectPreset as any).lora_url || undefined;
          projectConfig.lora_steps = (projectPreset as any).lora_steps || undefined;
          projectConfig.example_prompts = projectPreset.example_prompts || undefined;
          projectConfig.prompt_system_message = (projectPreset as any).prompt_system_message || undefined;
          projectConfig.style_reference_url = projectPreset.style_reference_url || undefined;
          projectConfig.visual_mode = (projectPreset as any).visual_mode || 'images';
          projectConfig.gameplay_urls = (projectPreset as any).gameplay_urls || undefined;
        }

        // Check for existing active pipeline on this calendar entry
        const { data: existingPipelines } = await supabase.from("auto_pipelines" as any)
          .select("id")
          .eq("calendar_entry_id", entry.id)
          .in("step_status", ["pending", "running"])
          .neq("current_step", "completed");
        if (existingPipelines && existingPipelines.length > 0) {
          console.warn(`Skipping entry ${entry.id}: already has an active pipeline`);
          continue;
        }

        await supabase.from("auto_pipelines" as any).insert({
          calendar_entry_id: entry.id,
          channel_id: entry.channel_id,
          user_id: user.id,
          current_step: "create_project",
          step_status: "pending",
          config: {
            script: {
              model: (scriptPreset as any).script_model || "glm5-openrouter",
              custom_prompt: scriptPreset.custom_prompt || "",
              use_batch: (scriptPreset as any).use_batch || false,
              use_web_search: (scriptPreset as any).use_web_search || false,
            },
            tts: ttsConfig,
            project: projectConfig,
          },
        });
        launched++;
      } catch (err) {
        console.error(`Auto-generate failed for entry ${entry.id}:`, err);
      }
    }
    if (launched > 0) {
      toast.success(`Auto-génération lancée pour ${launched} carte${launched > 1 ? 's' : ''}`);
      fetchEntries();
    } else {
      toast.error("Aucune carte éligible");
    }
  };

  const handleUrlSearch = async () => {
    const url = urlSearch.trim();
    if (!url || !user) return;
    setIsSearching(true);
    setUrlSearchResult(null);
    setUrlSearchNotFound(false);

    let videoId = "";
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) {
        videoId = u.pathname.slice(1);
      } else {
        videoId = u.searchParams.get("v") || "";
      }
    } catch {
      videoId = url;
    }

    const { data } = await supabase
      .from("content_calendar")
      .select(`id, user_id, title, scheduled_date, status, project_id, youtube_url, channel_id, created_at, updated_at, channel:channels(id, name, color)`)
      .eq("user_id", user.id)
      .not("youtube_url", "is", null)
      .order("scheduled_date", { ascending: false });

    const match = (data as ContentCalendarEntry[] | null)?.find(e => {
      if (!e.youtube_url) return false;
      if (e.youtube_url === url) return true;
      try {
        const eu = new URL(e.youtube_url);
        const eId = eu.hostname.includes("youtu.be") ? eu.pathname.slice(1) : eu.searchParams.get("v") || "";
        return eId === videoId;
      } catch { return false; }
    });

    if (match) {
      setUrlSearchResult(match);
      setUrlSearchNotFound(false);
    } else {
      setUrlSearchResult(null);
      setUrlSearchNotFound(true);
    }
    setIsSearching(false);
  };

  // Three-week sliding window centered on the anchor date (currentMonth):
  // previous week + current week + next week, always 21 days starting Monday.
  const currentWeekStart = startOfWeek(currentMonth, { weekStartsOn: 1 });
  const windowStart = subWeeks(currentWeekStart, 1);
  const windowEnd = addDays(windowStart, 20);
  const daysInMonth = eachDayOfInterval({ start: windowStart, end: windowEnd });

  const getEntriesForDay = (date: Date) => {
    return entries.filter(entry => {
      const matchesDate = isSameDay(new Date(entry.scheduled_date), date);
      const matchesChannel = selectedChannelId === "all" 
        || (selectedChannelId === "none" && !entry.channel_id)
        || entry.channel_id === selectedChannelId;
      return matchesDate && matchesChannel;
    });
  };

  const getFilteredEntries = () => {
    return entries.filter(entry => {
      const matchesChannel = selectedChannelId === "all" 
        || (selectedChannelId === "none" && !entry.channel_id)
        || entry.channel_id === selectedChannelId;
      return matchesChannel;
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Calendrier" />

      <main className={`${viewMode === 'kanban' ? 'max-w-[98%] mx-auto px-4' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'} py-6`}>
        {/* Calendar Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold capitalize">
              {viewMode === 'calendar'
                ? (() => {
                    const ws = subWeeks(startOfWeek(currentMonth, { weekStartsOn: 1 }), 1);
                    const we = addDays(ws, 20);
                    const sameMonth = isSameMonth(ws, we);
                    return sameMonth
                      ? `${format(ws, "d", { locale: fr })} – ${format(we, "d MMM yyyy", { locale: fr })}`
                      : `${format(ws, "d MMM", { locale: fr })} – ${format(we, "d MMM yyyy", { locale: fr })}`;
                  })()
                : "Vue Kanban"}
            </h1>
            {viewMode === 'calendar' && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={handlePrevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="text-xs sm:text-sm" onClick={handleToday}>
                  Aujourd'hui
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 sm:h-9 sm:w-9" onClick={handleNextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
              <Button
                variant={viewMode === 'calendar' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('calendar')}
                className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3"
              >
                <CalendarIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Calendrier</span>
              </Button>
              <Button
                variant={viewMode === 'kanban' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('kanban')}
                className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3"
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">Kanban</span>
              </Button>
            </div>

            {/* Calendar display options */}
            {viewMode === 'calendar' && (
              <label className="hidden sm:flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={compactMode}
                  onChange={(e) => setCompactMode(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                Max 5/jour
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
              <input
                type="checkbox"
                checked={blurTitles}
                onChange={(e) => setBlurTitles(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              Masquer titres
            </label>

            {/* URL Search */}
            <div className="relative">
              <div className="flex items-center gap-1">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={urlSearch}
                    onChange={(e) => { setUrlSearch(e.target.value); setUrlSearchNotFound(false); setUrlSearchResult(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleUrlSearch()}
                    placeholder="Coller une URL YouTube..."
                    className="pl-7 pr-7 h-8 w-[180px] sm:w-[240px] text-xs"
                  />
                  {urlSearch && (
                    <button onClick={() => { setUrlSearch(""); setUrlSearchResult(null); setUrlSearchNotFound(false); }} className="absolute right-2 top-1/2 -translate-y-1/2">
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>
                <Button variant="outline" size="sm" className="h-8 px-2" onClick={handleUrlSearch} disabled={!urlSearch.trim() || isSearching}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
              {(urlSearchResult || urlSearchNotFound) && (
                <div className="absolute top-full mt-1 right-0 z-50 bg-popover border rounded-lg shadow-lg p-3 w-[320px]">
                  {urlSearchNotFound && (
                    <p className="text-sm text-muted-foreground">Aucune vidéo trouvée pour cette URL.</p>
                  )}
                  {urlSearchResult && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium truncate">{urlSearchResult.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        <span>{format(new Date(urlSearchResult.scheduled_date), "d MMMM yyyy", { locale: fr })}</span>
                        {urlSearchResult.channel && (
                          <>
                            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: urlSearchResult.channel.color }} />
                            <span>{urlSearchResult.channel.name}</span>
                          </>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                          setCurrentMonth(new Date(urlSearchResult.scheduled_date));
                          setUrlSearch(""); setUrlSearchResult(null);
                        }}>
                          <CalendarIcon className="h-3 w-3 mr-1" />
                          Aller au jour
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                          handleEntryClick(urlSearchResult);
                          setUrlSearch(""); setUrlSearchResult(null);
                        }}>
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Ouvrir
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Channel Filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground hidden sm:block" />
              <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                <SelectTrigger className="w-[140px] sm:w-[180px] text-xs sm:text-sm">
                  <SelectValue placeholder="Filtrer par chaîne" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les chaînes</SelectItem>
                  <SelectItem value="none">Sans chaîne</SelectItem>
                  {channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="h-3 w-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: channel.color }}
                        />
                        <span>{channel.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Calendar or Kanban View */}
        {viewMode === 'calendar' ? (
          <>
            {/* Desktop: 7-column grid */}
            <div className="hidden md:block bg-card rounded-xl border shadow-sm overflow-hidden">
              {/* Weekday Headers */}
              <div className="grid grid-cols-7 border-b bg-muted/50">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
                  <div key={day} className="py-3 text-center text-sm font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}
              </div>

              {/* Three-week sliding window: previous + current + next */}
              <div className="grid grid-cols-7">
                {daysInMonth.map((day) => (
                  <CalendarDayCell
                    key={day.toISOString()}
                    date={day}
                    entries={getEntriesForDay(day)}
                    channels={channels}
                    isToday={isSameDay(day, new Date())}
                    isCurrentMonth={true}
                    maxPerDay={compactMode ? 5 : null}
                    blurTitles={blurTitles}
                    onDayClick={handleDayClick}
                    onEntryClick={handleEntryClick}
                    onEntryDrop={handleEntryDrop}
                    onAutoGenerateEntries={handleAutoGenerateEntries}
                  />
                ))}
              </div>
            </div>

            {/* Mobile: vertical day-by-day list */}
            <MobileDayList
              daysInMonth={daysInMonth}
              getEntriesForDay={getEntriesForDay}
              blurTitles={blurTitles}
              onDayClick={handleDayClick}
              onEntryClick={handleEntryClick}
              currentMonth={currentMonth}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
            />
          </>
        ) : (
          <KanbanBoard
            entries={getFilteredEntries()}
            onEntryClick={handleEntryClick}
            onEntryUpdate={(entryId, newStatus) => {
              // Optimistic update
              setEntries(prevEntries =>
                prevEntries.map(entry =>
                  entry.id === entryId
                    ? { ...entry, status: newStatus as any }
                    : entry
                )
              );
            }}
          />
        )}
      </main>

      {/* Video Modal */}
      <CalendarVideoModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        entry={selectedEntry}
        selectedDate={selectedDate}
        userId={user.id}
        onSaved={handleEntrySaved}
      />
    </div>
  );
}
