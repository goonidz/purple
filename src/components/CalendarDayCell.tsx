import { format } from "date-fns";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

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

interface CalendarDayCellProps {
  date: Date;
  entries: ContentCalendarEntry[];
  isToday: boolean;
  onDayClick: (date: Date) => void;
  onEntryClick: (entry: ContentCalendarEntry) => void;
}

const statusColors: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  scripted: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  audio_ready: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
  generating: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  completed: "bg-green-500/20 text-green-600 dark:text-green-400",
};

const statusLabels: Record<string, string> = {
  planned: "Planifié",
  scripted: "Script",
  audio_ready: "Audio",
  generating: "En cours",
  completed: "Terminé",
};

export default function CalendarDayCell({
  date,
  entries,
  isToday,
  onDayClick,
  onEntryClick,
}: CalendarDayCellProps) {
  return (
    <div 
      className={cn(
        "min-h-[120px] border-b border-r p-2 group cursor-pointer hover:bg-muted/50 transition-colors",
        isToday && "bg-primary/5"
      )}
      onClick={() => onDayClick(date)}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={cn(
            "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
            isToday && "bg-primary text-primary-foreground"
          )}
        >
          {format(date, "d")}
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
          onClick={(e) => {
            e.stopPropagation();
            onDayClick(date);
          }}
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-1">
        {entries.slice(0, 3).map((entry) => (
          <div
            key={entry.id}
            className={cn(
              "text-xs p-1.5 rounded truncate cursor-pointer hover:ring-1 hover:ring-primary transition-all",
              statusColors[entry.status]
            )}
            onClick={(e) => {
              e.stopPropagation();
              onEntryClick(entry);
            }}
            title={entry.title}
          >
            {entry.title}
          </div>
        ))}
        {entries.length > 3 && (
          <div className="text-xs text-muted-foreground pl-1">
            +{entries.length - 3} autres
          </div>
        )}
      </div>
    </div>
  );
}
