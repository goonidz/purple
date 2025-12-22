import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trash2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Channel {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_avatar: string | null;
  subscriber_count: number;
  is_active: boolean;
}

interface CompetitorSidebarProps {
  channels: Channel[];
  selectedChannels: string[];
  onSelectionChange: (channelIds: string[]) => void;
  onAddClick: () => void;
  onRefresh: () => void;
  maxChannels?: number;
}

function formatSubscribers(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(0)}K`;
  }
  return count.toString();
}

export default function CompetitorSidebar({
  channels,
  selectedChannels,
  onSelectionChange,
  onAddClick,
  onRefresh,
  maxChannels = 20
}: CompetitorSidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSelectAll = () => {
    if (selectedChannels.length === channels.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(channels.map(c => c.channel_id));
    }
  };

  const handleToggleChannel = (channelId: string) => {
    if (selectedChannels.includes(channelId)) {
      onSelectionChange(selectedChannels.filter(id => id !== channelId));
    } else {
      onSelectionChange([...selectedChannels, channelId]);
    }
  };

  const handleDeleteChannel = async (channel: Channel) => {
    setDeletingId(channel.id);
    try {
      const { error } = await supabase
        .from('competitor_channels')
        .delete()
        .eq('id', channel.id);

      if (error) throw error;

      toast.success(`${channel.channel_name} supprimé`);
      onRefresh();
    } catch (error) {
      console.error("Error deleting channel:", error);
      toast.error("Erreur lors de la suppression");
    } finally {
      setDeletingId(null);
    }
  };

  const allSelected = channels.length > 0 && selectedChannels.length === channels.length;

  return (
    <div className="w-72 border-l bg-card/50 flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Competitors</h3>
          <span className="text-xs text-muted-foreground">
            {channels.length}/{maxChannels}
          </span>
        </div>
        
        <Button 
          onClick={onAddClick} 
          size="sm" 
          className="w-full"
          disabled={channels.length >= maxChannels}
        >
          <Plus className="h-4 w-4 mr-2" />
          Ajouter
        </Button>
        
        {channels.length >= maxChannels && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Limite de {maxChannels} concurrents atteinte
          </p>
        )}
      </div>

      <div className="p-3 border-b">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={allSelected}
            onCheckedChange={handleSelectAll}
          />
          <span className="text-sm">Tout sélectionner</span>
        </label>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 group"
            >
              <Checkbox
                checked={selectedChannels.includes(channel.channel_id)}
                onCheckedChange={() => handleToggleChannel(channel.channel_id)}
              />
              
              <Avatar className="h-8 w-8">
                <AvatarImage src={channel.channel_avatar || undefined} />
                <AvatarFallback className="text-xs">
                  {channel.channel_name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {channel.channel_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSubscribers(channel.subscriber_count)} subscribers
                </p>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleDeleteChannel(channel)}
                    disabled={deletingId === channel.id}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}

          {channels.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">Aucun concurrent</p>
              <p className="text-xs mt-1">Ajoutez des chaînes YouTube à suivre</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
