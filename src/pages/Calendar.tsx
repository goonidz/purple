import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight, Home, FolderOpen, User as UserIcon } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import CalendarVideoModal from "@/components/CalendarVideoModal";
import CalendarDayCell from "@/components/CalendarDayCell";

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
  created_at: string;
  updated_at: string;
}

export default function Calendar() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [entries, setEntries] = useState<ContentCalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<ContentCalendarEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

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
    }
  }, [user, currentMonth]);

  const fetchEntries = async () => {
    if (!user) return;
    
    setIsLoading(true);
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    const { data, error } = await supabase
      .from("content_calendar")
      .select("*")
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

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const startDay = startOfMonth(currentMonth).getDay();
  const adjustedStartDay = startDay === 0 ? 6 : startDay - 1;

  const getEntriesForDay = (date: Date) => {
    return entries.filter(entry => 
      isSameDay(new Date(entry.scheduled_date), date)
    );
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
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => navigate("/")} 
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                  <CalendarIcon className="h-5 w-5 text-primary-foreground" />
                </div>
                <span className="font-semibold text-lg">Calendrier</span>
              </button>
            </div>
            <nav className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
                <Home className="h-4 w-4 mr-2" />
                Accueil
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Projets
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate("/profile")}>
                <UserIcon className="h-4 w-4 mr-2" />
                Profil
              </Button>
            </nav>
          </div>
        </div>
      </header>

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
