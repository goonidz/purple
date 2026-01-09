import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { DndContext, DragEndEvent, DragStartEvent, closestCenter, PointerSensor, useSensor, useSensors, useDroppable, useDraggable, DragOverlay } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  onEntryUpdate?: (entryId: string, newStatus: string) => void;
}

interface DraggableCardProps {
  entry: ContentCalendarEntry;
  column: typeof statusColumns[0];
  onClick: () => void;
}

interface DroppableColumnProps {
  column: typeof statusColumns[0];
  entries: ContentCalendarEntry[];
  onEntryClick: (entry: ContentCalendarEntry) => void;
}

function DroppableColumn({ column, entries, onEntryClick }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.value,
  });

  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 bg-card rounded-lg border-2 p-3 shadow-sm transition-colors ${
        isOver ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20' : 'border-border'
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b">
        <h3 className="font-semibold text-sm truncate">{column.label}</h3>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
          {entries.length}
        </span>
      </div>

      {/* Column Cards */}
      <div 
        className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1 min-h-[100px]"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'hsl(16 90% 58% / 0.3) transparent'
        }}
      >
        {entries.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            {isOver ? 'Déposer ici' : 'Aucune vidéo'}
          </div>
        ) : (
          entries.map((entry) => (
            <DraggableCard
              key={entry.id}
              entry={entry}
              column={column}
              onClick={() => onEntryClick(entry)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableCard({ entry, column, onClick }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
    data: {
      entry,
      currentStatus: entry.status,
    },
  });

  const style = {
    opacity: isDragging ? 0.3 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`
        p-3 rounded-lg border-l-4 cursor-pointer
        transition-all hover:shadow-md hover:scale-[1.01]
        ${column.color} ${column.borderColor}
      `}
    >
      {/* Card Header - Title */}
      <h4 className="font-medium text-sm mb-2 line-clamp-2 leading-tight">
        {entry.title}
      </h4>

      {/* Channel Badge */}
      {entry.channel && (
        <div className="flex items-center gap-1.5 mb-2">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.channel.color }}
          />
          <span className="text-xs text-muted-foreground truncate">
            {entry.channel.name}
          </span>
        </div>
      )}

      {/* Scheduled Date */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
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
        <span>{format(new Date(entry.scheduled_date), "dd MMM", { locale: fr })}</span>
      </div>

      {/* Project Link */}
      {entry.project_id && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          <span>Projet lié</span>
        </div>
      )}
    </div>
  );
}

const statusColumns = [
  { value: "planned", label: "Planifié", color: "bg-muted", borderColor: "border-muted-foreground/20" },
  { value: "scripted", label: "Script prêt", color: "bg-blue-500/20", borderColor: "border-blue-500" },
  { value: "audio_ready", label: "Audio prêt", color: "bg-yellow-500/20", borderColor: "border-yellow-500" },
  { value: "generating", label: "En génération", color: "bg-purple-500/20", borderColor: "border-purple-500" },
  { value: "thumbnail", label: "Miniature", color: "bg-pink-500/20", borderColor: "border-pink-500" },
  { value: "completed", label: "Terminé", color: "bg-green-500/20", borderColor: "border-green-500" },
];

export default function KanbanBoard({ entries, onEntryClick, onEntryUpdate }: KanbanBoardProps) {
  const [activeEntry, setActiveEntry] = useState<ContentCalendarEntry | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px de mouvement avant de commencer le drag
      },
    })
  );

  // Group entries by status and sort by scheduled_date (earliest first)
  const groupedEntries = statusColumns.reduce((acc, column) => {
    acc[column.value] = entries
      .filter(entry => entry.status === column.value)
      .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime());
    return acc;
  }, {} as Record<string, ContentCalendarEntry[]>);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const entry = entries.find(e => e.id === active.id);
    setActiveEntry(entry || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveEntry(null); // Reset active entry

    if (!over) return;

    const entryId = active.id as string;
    const newStatus = over.id as string;

    // Trouver l'entrée déplacée
    const entry = entries.find(e => e.id === entryId);
    if (!entry || entry.status === newStatus) return;

    // Optimistic update
    if (onEntryUpdate) {
      onEntryUpdate(entryId, newStatus);
    }

    // Update in database
    try {
      const { error } = await supabase
        .from('content_calendar')
        .update({ status: newStatus })
        .eq('id', entryId);

      if (error) throw error;

      toast.success(`Statut mis à jour : ${statusColumns.find(c => c.value === newStatus)?.label}`);
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Erreur lors de la mise à jour du statut');
      // Revert optimistic update if needed
      if (onEntryUpdate && entry) {
        onEntryUpdate(entryId, entry.status);
      }
    }
  };

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCenter} 
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="w-full">
        <div className="grid grid-cols-6 gap-3">
          {statusColumns.map((column) => {
            const columnEntries = groupedEntries[column.value] || [];
            
            return (
              <DroppableColumn
                key={column.value}
                column={column}
                entries={columnEntries}
                onEntryClick={onEntryClick}
              />
            );
          })}
        </div>
      </div>
      
      <DragOverlay>
        {activeEntry ? (
          <div className="p-3 rounded-lg border-l-4 bg-card shadow-2xl border-orange-500 cursor-grabbing rotate-3 scale-105">
            <h4 className="font-medium text-sm mb-2 line-clamp-2 leading-tight">
              {activeEntry.title}
            </h4>
            {activeEntry.channel && (
              <div className="flex items-center gap-1.5 mb-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: activeEntry.channel.color }}
                />
                <span className="text-xs text-muted-foreground truncate">
                  {activeEntry.channel.name}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>{format(new Date(activeEntry.scheduled_date), "dd MMM", { locale: fr })}</span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
