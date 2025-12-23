import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Plus, Link2, Link2Off, Youtube, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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

interface CalendarDayCellProps {
  date: Date;
  entries: ContentCalendarEntry[];
  isToday: boolean;
  onDayClick: (date: Date) => void;
  onEntryClick: (entry: ContentCalendarEntry) => void;
  onEntryDrop: (entryId: string, newDate: Date) => void;
}

// Default colors when no channel is set (based on completion status)
const defaultColors: Record<string, string> = {
  incomplete: "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-l-[3px] border-orange-500",
  completed: "bg-green-500/20 text-green-600 dark:text-green-400 border-l-[3px] border-green-500",
};

// Helper function to get inline style for channel color
function getEntryStyle(entry: ContentCalendarEntry): React.CSSProperties {
  const isCompleted = entry.status === 'completed';
  const channelColor = entry.channel?.color;
  
  if (channelColor) {
    // Has channel: use channel color for background, green border if completed
    return {
      backgroundColor: `${channelColor}20`,
      color: channelColor,
      borderLeft: isCompleted ? '3px solid rgb(34 197 94)' : `3px solid ${channelColor}`,
    };
  }
  
  return {};
}

export default function CalendarDayCell({
  date,
  entries,
  isToday,
  onDayClick,
  onEntryClick,
  onEntryDrop,
}: CalendarDayCellProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAllEntriesDialog, setShowAllEntriesDialog] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const entryId = e.dataTransfer.getData("entryId");
    if (entryId) {
      onEntryDrop(entryId, date);
    }
  };

  const handleDragStart = (e: React.DragEvent, entryId: string) => {
    e.dataTransfer.setData("entryId", entryId);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div 
      className={cn(
        "min-h-[120px] border-b border-r p-2 group cursor-pointer hover:bg-muted/50 transition-colors",
        isToday && "bg-primary/5",
        isDragOver && "bg-primary/10 ring-2 ring-primary ring-inset"
      )}
      onClick={() => onDayClick(date)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        {[...entries]
          .sort((a, b) => {
            const aCompleted = a.status === 'completed';
            const bCompleted = b.status === 'completed';
            
            // If completion status differs, completed first
            if (aCompleted !== bCompleted) {
              return aCompleted ? -1 : 1;
            }
            
            // Same completion status: sort by channel color
            const aColor = a.channel?.color || '#ffffff';
            const bColor = b.channel?.color || '#ffffff';
            return aColor.localeCompare(bColor);
          })
          .slice(0, 5)
          .map((entry) => {
          const hasChannel = !!entry.channel?.name;
          const isCompleted = entry.status === 'completed';
          const entryStyle = getEntryStyle(entry);
          
          return (
            <div
              key={entry.id}
              draggable
              onDragStart={(e) => handleDragStart(e, entry.id)}
              className={cn(
                "text-xs p-1.5 rounded cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-primary transition-all flex items-center gap-1",
                !hasChannel && (isCompleted ? defaultColors.completed : defaultColors.incomplete)
              )}
              style={hasChannel ? entryStyle : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onEntryClick(entry);
              }}
              title={entry.title}
            >
              {/* Completed indicator */}
              {isCompleted && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Check className="h-3 w-3 flex-shrink-0 text-green-600" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Terminée</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {entry.youtube_url && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Youtube className="h-3 w-3 flex-shrink-0 text-red-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Publiée sur YouTube</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {entry.project_id ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link2 className="h-3 w-3 flex-shrink-0 text-blue-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Lié à un projet</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link2Off className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Pas de projet lié</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {hasChannel && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div 
                      className="h-2 w-2 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: entry.channel!.color }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{entry.channel!.name}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <span className="truncate">{entry.title}</span>
            </div>
          );
        })}
        {entries.length > 5 && (
          <button
            className="text-xs text-muted-foreground pl-1 hover:text-primary transition-colors w-full text-left"
            onClick={(e) => {
              e.stopPropagation();
              setShowAllEntriesDialog(true);
            }}
          >
            +{entries.length - 5} autres
          </button>
        )}
      </div>

      {/* Dialog to show all entries */}
      <Dialog open={showAllEntriesDialog} onOpenChange={setShowAllEntriesDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              {format(date, "EEEE d MMMM yyyy", { locale: fr })}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-2">
              {[...entries]
                .sort((a, b) => {
                  const aCompleted = a.status === 'completed';
                  const bCompleted = b.status === 'completed';
                  
                  if (aCompleted !== bCompleted) {
                    return aCompleted ? -1 : 1;
                  }
                  
                  const aColor = a.channel?.color || '#ffffff';
                  const bColor = b.channel?.color || '#ffffff';
                  return aColor.localeCompare(bColor);
                })
                .map((entry) => {
                  const hasChannel = !!entry.channel?.name;
                  const isCompleted = entry.status === 'completed';
                  const entryStyle = getEntryStyle(entry);
                  
                  return (
                    <div
                      key={entry.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, entry.id)}
                      className={cn(
                        "text-sm p-3 rounded-lg cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary transition-all flex items-center gap-2 border",
                        !hasChannel && (isCompleted ? defaultColors.completed : defaultColors.incomplete)
                      )}
                      style={hasChannel ? { ...entryStyle, border: `1px solid ${entry.channel!.color}40` } : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAllEntriesDialog(false);
                        onEntryClick(entry);
                      }}
                      title={entry.title}
                    >
                      {/* Completed indicator */}
                      {isCompleted && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Check className="h-4 w-4 flex-shrink-0 text-green-600" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Terminée</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {entry.youtube_url && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Youtube className="h-4 w-4 flex-shrink-0 text-red-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Publiée sur YouTube</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {entry.project_id ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link2 className="h-4 w-4 flex-shrink-0 text-blue-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Lié à un projet</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link2Off className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Pas de projet lié</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {hasChannel && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div 
                              className="h-3 w-3 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: entry.channel!.color }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{entry.channel!.name}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <span className="flex-1">{entry.title}</span>
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
