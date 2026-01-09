import { format } from "date-fns";
import { fr } from "date-fns/locale";

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
  status: 'planned' | 'scripted' | 'audio_ready' | 'generating' | 'thumbnail' | 'completed';
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

interface KanbanBoardProps {
  entries: ContentCalendarEntry[];
  onEntryClick: (entry: ContentCalendarEntry) => void;
}

const statusColumns = [
  { value: "planned", label: "Planifié", color: "bg-muted", borderColor: "border-muted-foreground/20" },
  { value: "scripted", label: "Script prêt", color: "bg-blue-500/20", borderColor: "border-blue-500" },
  { value: "audio_ready", label: "Audio prêt", color: "bg-yellow-500/20", borderColor: "border-yellow-500" },
  { value: "generating", label: "En génération", color: "bg-purple-500/20", borderColor: "border-purple-500" },
  { value: "thumbnail", label: "Miniature", color: "bg-pink-500/20", borderColor: "border-pink-500" },
  { value: "completed", label: "Terminé", color: "bg-green-500/20", borderColor: "border-green-500" },
];

export default function KanbanBoard({ entries, onEntryClick }: KanbanBoardProps) {
  // Group entries by status and sort by scheduled_date (earliest first)
  const groupedEntries = statusColumns.reduce((acc, column) => {
    acc[column.value] = entries
      .filter(entry => entry.status === column.value)
      .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime());
    return acc;
  }, {} as Record<string, ContentCalendarEntry[]>);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {statusColumns.map((column) => {
        const columnEntries = groupedEntries[column.value] || [];
        
        return (
          <div
            key={column.value}
            className="flex-shrink-0 w-80 bg-card rounded-lg border border-border p-4"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{column.label}</h3>
              <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-full">
                {columnEntries.length}
              </span>
            </div>

            {/* Column Cards */}
            <div className="space-y-3">
              {columnEntries.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Aucune vidéo
                </div>
              ) : (
                columnEntries.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => onEntryClick(entry)}
                    className={`
                      p-4 rounded-lg border-l-4 cursor-pointer
                      transition-all hover:shadow-lg hover:scale-[1.02]
                      ${column.color} ${column.borderColor}
                    `}
                  >
                    {/* Card Header - Title */}
                    <h4 className="font-medium text-sm mb-2 line-clamp-2">
                      {entry.title}
                    </h4>

                    {/* Channel Badge */}
                    {entry.channel && (
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: entry.channel.color }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {entry.channel.name}
                        </span>
                      </div>
                    )}

                    {/* Scheduled Date */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <span>
                        {format(new Date(entry.scheduled_date), "dd MMM yyyy", { locale: fr })}
                      </span>
                    </div>

                    {/* Project Link */}
                    {entry.project_id && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                        <span>Projet lié</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
