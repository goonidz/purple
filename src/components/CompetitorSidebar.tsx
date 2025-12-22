import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trash2, MoreHorizontal, Folder, ChevronDown, ChevronRight, FolderPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Channel {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_avatar: string | null;
  subscriber_count: number;
  is_active: boolean;
  folder_id: string | null;
}

interface Folder {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface CompetitorSidebarProps {
  channels: Channel[];
  folders: Folder[];
  selectedChannels: string[];
  selectedFolderId: string | null;
  onSelectionChange: (channelIds: string[]) => void;
  onFolderSelect: (folderId: string | null) => void;
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
  folders,
  selectedChannels,
  selectedFolderId,
  onSelectionChange,
  onFolderSelect,
  onAddClick,
  onRefresh,
  maxChannels = 20
}: CompetitorSidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);

  // Organiser les chaînes par dossier
  const channelsByFolder = channels.reduce((acc, channel) => {
    const folderId = channel.folder_id || "none";
    if (!acc[folderId]) acc[folderId] = [];
    acc[folderId].push(channel);
    return acc;
  }, {} as Record<string, Channel[]>);

  const channelsWithoutFolder = channelsByFolder["none"] || [];
  const sortedFolders = [...folders].sort((a, b) => a.position - b.position);

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

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error("Le nom du dossier est requis");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const { data: folders } = await supabase
        .from('competitor_folders')
        .select('position')
        .eq('user_id', user.id)
        .order('position', { ascending: false })
        .limit(1);

      const nextPosition = folders && folders.length > 0 ? folders[0].position + 1 : 0;

      const { error } = await supabase
        .from('competitor_folders')
        .insert({
          user_id: user.id,
          name: newFolderName.trim(),
          position: nextPosition,
        });

      if (error) throw error;

      toast.success(`Dossier "${newFolderName}" créé`);
      setNewFolderName("");
      setShowAddFolder(false);
      onRefresh();
    } catch (error) {
      console.error("Error creating folder:", error);
      toast.error("Erreur lors de la création du dossier");
    }
  };

  const handleDeleteFolder = async (folder: Folder) => {
    setDeletingFolderId(folder.id);
    try {
      // Déplacer les chaînes hors du dossier
      await supabase
        .from('competitor_channels')
        .update({ folder_id: null })
        .eq('folder_id', folder.id);

      // Supprimer le dossier
      const { error } = await supabase
        .from('competitor_folders')
        .delete()
        .eq('id', folder.id);

      if (error) throw error;

      toast.success(`Dossier "${folder.name}" supprimé`);
      onRefresh();
    } catch (error) {
      console.error("Error deleting folder:", error);
      toast.error("Erreur lors de la suppression");
    } finally {
      setDeletingFolderId(null);
    }
  };

  const handleMoveChannelToFolder = async (channelId: string, folderId: string | null) => {
    try {
      const { error } = await supabase
        .from('competitor_channels')
        .update({ folder_id: folderId })
        .eq('id', channelId);

      if (error) throw error;
      onRefresh();
    } catch (error) {
      console.error("Error moving channel:", error);
      toast.error("Erreur lors du déplacement");
    }
  };

  const toggleFolder = (folderId: string) => {
    const newOpen = new Set(openFolders);
    if (newOpen.has(folderId)) {
      newOpen.delete(folderId);
    } else {
      newOpen.add(folderId);
    }
    setOpenFolders(newOpen);
  };

  const allSelected = channels.length > 0 && selectedChannels.length === channels.length;

  return (
    <>
      <div className="w-72 border-l bg-card/50 flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Competitors</h3>
            <span className="text-xs text-muted-foreground">
              {channels.length}/{maxChannels}
            </span>
          </div>
          
          <div className="flex gap-2">
            <Button 
              onClick={onAddClick} 
              size="sm" 
              className="flex-1"
              disabled={channels.length >= maxChannels}
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
            <Button 
              onClick={() => setShowAddFolder(true)} 
              size="sm" 
              variant="outline"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          
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
            {/* Bouton "Tous" */}
            <button
              onClick={() => onFolderSelect(null)}
              className={`w-full flex items-center gap-2 p-2 rounded-lg text-sm font-medium transition-colors ${
                selectedFolderId === null 
                  ? 'bg-primary text-primary-foreground' 
                  : 'hover:bg-accent/50 text-foreground'
              }`}
            >
              <Folder className="h-4 w-4" />
              Tous les concurrents
            </button>

            {/* Dossiers */}
            {sortedFolders.map((folder) => {
              const folderChannels = channelsByFolder[folder.id] || [];
              const isOpen = openFolders.has(folder.id);
              const isSelected = selectedFolderId === folder.id;
              
              return (
                <Collapsible
                  key={folder.id}
                  open={isOpen}
                  onOpenChange={() => toggleFolder(folder.id)}
                >
                  <div className="space-y-1">
                    <div 
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors group ${
                        isSelected 
                          ? 'bg-primary text-primary-foreground' 
                          : 'hover:bg-accent/50'
                      }`}
                      onClick={() => onFolderSelect(isSelected ? null : folder.id)}
                    >
                      <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button className="flex items-center gap-2 flex-1 min-w-0">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 flex-shrink-0" />
                          )}
                          <Folder className="h-4 w-4 flex-shrink-0" style={{ color: isSelected ? 'currentColor' : folder.color }} />
                          <span className="text-sm font-medium flex-1 text-left truncate">
                            {folder.name}
                          </span>
                          <span className={`text-xs flex-shrink-0 ${isSelected ? 'opacity-80' : 'text-muted-foreground'}`}>
                            {folderChannels.length}
                          </span>
                        </button>
                      </CollapsibleTrigger>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDeleteFolder(folder)}
                            disabled={deletingFolderId === folder.id}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  <CollapsibleContent>
                    <div className="pl-6 space-y-1">
                      {folderChannels.map((channel) => (
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
                                onClick={() => handleMoveChannelToFolder(channel.id, null)}
                              >
                                Retirer du dossier
                              </DropdownMenuItem>
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
                      {folderChannels.length === 0 && (
                        <p className="text-xs text-muted-foreground p-2">Aucune chaîne</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            {/* Chaînes sans dossier */}
            {channelsWithoutFolder.length > 0 && (
              <div className="space-y-1">
                {channelsWithoutFolder.map((channel) => (
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
                        {sortedFolders.map((folder) => (
                          <DropdownMenuItem
                            key={folder.id}
                            onClick={() => handleMoveChannelToFolder(channel.id, folder.id)}
                          >
                            <Folder className="h-4 w-4 mr-2" style={{ color: folder.color }} />
                            Déplacer vers {folder.name}
                          </DropdownMenuItem>
                        ))}
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
              </div>
            )}

            {channels.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Aucun concurrent</p>
                <p className="text-xs mt-1">Ajoutez des chaînes YouTube à suivre</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Modal créer dossier */}
      <Dialog open={showAddFolder} onOpenChange={setShowAddFolder}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Créer un dossier</DialogTitle>
            <DialogDescription>
              Organisez vos chaînes concurrentes en dossiers
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folderName">Nom du dossier</Label>
              <Input
                id="folderName"
                placeholder="Ex: Finance, Tech, Gaming..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateFolder();
                  }
                }}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddFolder(false)}
              >
                Annuler
              </Button>
              <Button onClick={handleCreateFolder}>
                <Plus className="h-4 w-4 mr-2" />
                Créer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
