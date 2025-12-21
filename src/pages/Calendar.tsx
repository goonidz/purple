import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Filter } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import CalendarVideoModal from "@/components/CalendarVideoModal";
import CalendarDayCell from "@/components/CalendarDayCell";

interface Channel {
  id: string;
  name: string;
  color: string;
}

interface ContentCalendarEntry {
  id: string;
  user_id: string;
  title: string;
  scheduled_date: string;
  status: 'planned' | 'scripted' | 'audio_ready' | 'generating' | 'completed';
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

  useEffect(() => {
    document.title = "Calendrier | VideoFlow";
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
  }, [user, currentMonth]);

  // Subscribe to realtime updates for calendar entries and projects
  useEffect(() => {
    if (!user) return;

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
          console.log('Calendar entry changed:', payload);
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
          console.log('Project changed:', payload);
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
      .subscribe();

    return () => {
      supabase.removeChannel(calendarChannel);
    };
  }, [user]);

  const fetchChannels = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("channels")
      .select("*")
      .eq("user_id", user.id)
      .order("name", { ascending: true });

    if (!error && data) {
      setChannels(data);
    }
  };

  const fetchEntries = async () => {
    if (!user) return;
    
    setIsLoading(true);
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    const { data, error } = await supabase
      .from("content_calendar")
      .select(`
        *,
        channel:channels(id, name, color)
      `)
      .eq("user_id", user.id)
      .gte("scheduled_date", format(start, "yyyy-MM-dd"))
      .lte("scheduled_date", format(end, "yyyy-MM-dd"))
      .order("scheduled_date", { ascending: true });

    if (error) {
      console.error("Error fetching calendar entries:", error);
      toast.error("Erreur lors du chargement du calendrier");
    } else {
      setEntries(data as ContentCalendarEntry[]);
    }
    setIsLoading(false);
  };

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
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

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const startDay = startOfMonth(currentMonth).getDay();
  const adjustedStartDay = startDay === 0 ? 6 : startDay - 1;

  const getEntriesForDay = (date: Date) => {
    return entries.filter(entry => {
      const matchesDate = isSameDay(new Date(entry.scheduled_date), date);
      const matchesChannel = selectedChannelId === "all" 
        || (selectedChannelId === "none" && !entry.channel_id)
        || entry.channel_id === selectedChannelId;
      return matchesDate && matchesChannel;
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Calendar Controls */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold capitalize">
              {format(currentMonth, "MMMM yyyy", { locale: fr })}
            </h1>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleToday}>
                Aujourd'hui
              </Button>
              <Button variant="outline" size="icon" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Channel Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
              <SelectTrigger className="w-[180px]">
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

        {/* Calendar Grid */}
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 border-b bg-muted/50">
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
              <div key={day} className="py-3 text-center text-sm font-medium text-muted-foreground">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7">
            {/* Empty cells for days before month starts */}
            {Array.from({ length: adjustedStartDay }).map((_, index) => (
              <div key={`empty-${index}`} className="min-h-[120px] border-b border-r bg-muted/20" />
            ))}

            {/* Days of the month */}
            {daysInMonth.map((day) => (
              <CalendarDayCell
                key={day.toISOString()}
                date={day}
                entries={getEntriesForDay(day)}
                isToday={isSameDay(day, new Date())}
                onDayClick={handleDayClick}
                onEntryClick={handleEntryClick}
                onEntryDrop={handleEntryDrop}
              />
            ))}

            {/* Empty cells to complete the grid */}
            {Array.from({ length: (7 - ((adjustedStartDay + daysInMonth.length) % 7)) % 7 }).map((_, index) => (
              <div key={`empty-end-${index}`} className="min-h-[120px] border-b border-r bg-muted/20" />
            ))}
          </div>
        </div>
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
