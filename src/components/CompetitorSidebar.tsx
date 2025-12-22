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

interface ChannelFolder {
  id: string;
  channel_id: string;
  folder_id: string;
}

interface CompetitorSidebarProps {
  channels: Channel[];
  folders: Folder[];
  channelFolders: ChannelFolder[];
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
  channelFolders,
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

  // Organiser les chaînes par dossier (utiliser les associations + folder_id pour compatibilité)
  const channelsByFolder = channels.reduce((acc, channel) => {
    // Trouver tous les dossiers de cette chaîne via les associations
    const folderIds = channelFolders
      .filter(cf => cf.channel_id === channel.id)
      .map(cf => cf.folder_id);
    
    // Ajouter aussi folder_id pour compatibilité avec anciennes données
    if (channel.folder_id && !folderIds.includes(channel.folder_id)) {
      folderIds.push(channel.folder_id);
    }

    if (folderIds.length === 0) {
      // Chaîne sans dossier
      if (!acc["none"]) acc["none"] = [];
      acc["none"].push(channel);
    } else {
      // Ajouter la chaîne à tous ses dossiers
      folderIds.forEach(folderId => {
        if (!acc[folderId]) acc[folderId] = [];
        acc[folderId].push(channel);
      });
    }
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
      // Supprimer les associations (CASCADE supprimera automatiquement via la FK)
      await supabase
        .from('competitor_channel_folders')
        .delete()
        .eq('folder_id', folder.id);

      // Supprimer aussi folder_id pour compatibilité avec anciennes données
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

  const handleAddChannelToFolder = async (channelId: string, folderId: string) => {
    try {
      // Vérifier si l'association existe déjà
      const existing = channelFolders.find(
        cf => cf.channel_id === channelId && cf.folder_id === folderId
      );

      if (existing) {
        toast.info("Cette chaîne est déjà dans ce dossier");
        return;
      }

      const { error } = await supabase
        .from('competitor_channel_folders')
        .insert({
          channel_id: channelId,
          folder_id: folderId,
        });

      if (error) throw error;
      toast.success("Chaîne ajoutée au dossier");
      onRefresh();
    } catch (error) {
      console.error("Error adding channel to folder:", error);
      toast.error("Erreur lors de l'ajout au dossier");
    }
  };

  const handleRemoveChannelFromFolder = async (channelId: string, folderId: string) => {
    try {
      const { error } = await supabase
        .from('competitor_channel_folders')
        .delete()
        .eq('channel_id', channelId)
        .eq('folder_id', folderId);

      if (error) throw error;
      toast.success("Chaîne retirée du dossier");
      onRefresh();
    } catch (error) {
      console.error("Error removing channel from folder:", error);
      toast.error("Erreur lors du retrait du dossier");
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
            <div 
              className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                selectedFolderId === null 
                  ? 'bg-primary/10 border border-primary/20' 
                  : 'hover:bg-accent/50'
              }`}
            >
              <Checkbox
                checked={selectedFolderId === null}
                onCheckedChange={() => onFolderSelect(null)}
              />
              <button
                onClick={() => onFolderSelect(null)}
                className="flex items-center gap-2 flex-1 text-left"
              >
                <Folder className="h-4 w-4" />
                <span className={`text-sm font-medium ${selectedFolderId === null ? 'text-primary' : ''}`}>
                  Tous les concurrents
                </span>
              </button>
            </div>

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
                  <div 
                    className={`flex items-center gap-2 p-2 rounded-lg transition-colors group ${
                      isSelected 
                        ? 'bg-primary/10 border border-primary/20' 
                        : 'hover:bg-accent/50'
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onFolderSelect(isSelected ? null : folder.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 flex-1 min-w-0">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        )}
                        <Folder className="h-4 w-4 flex-shrink-0" style={{ color: folder.color }} />
                        <span className={`text-sm font-medium flex-1 text-left truncate ${isSelected ? 'text-primary' : ''}`}>
                          {folder.name}
                        </span>
                        <span className={`text-xs flex-shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
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
                    <div className="pl-6 pr-2 space-y-1">
                      {folderChannels.map((channel) => (
                        <div
                          key={channel.id}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 group"
                        >
                          <Checkbox
                            checked={selectedChannels.includes(channel.channel_id)}
                            onCheckedChange={() => handleToggleChannel(channel.channel_id)}
                          />
                          
                          <Avatar className="h-8 w-8 flex-shrink-0">
                            <AvatarImage src={channel.channel_avatar || undefined} />
                            <AvatarFallback className="text-xs">
                              {channel.channel_name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {channel.channel_name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {formatSubscribers(channel.subscriber_count)} subscribers
                            </p>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleRemoveChannelFromFolder(channel.id, folder.id)}
                              >
                                Retirer de ce dossier
                              </DropdownMenuItem>
                              {sortedFolders
                                .filter(f => f.id !== folder.id)
                                .map((otherFolder) => (
                                  <DropdownMenuItem
                                    key={otherFolder.id}
                                    onClick={() => handleAddChannelToFolder(channel.id, otherFolder.id)}
                                  >
                                    <Folder className="h-4 w-4 mr-2" style={{ color: otherFolder.color }} />
                                    Ajouter à {otherFolder.name}
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
                        {sortedFolders.map((folder) => {
                          const isInFolder = channelFolders.some(
                            cf => cf.channel_id === channel.id && cf.folder_id === folder.id
                          );
                          return (
                            <DropdownMenuItem
                              key={folder.id}
                              onClick={() => {
                                if (isInFolder) {
                                  handleRemoveChannelFromFolder(channel.id, folder.id);
                                } else {
                                  handleAddChannelToFolder(channel.id, folder.id);
                                }
                              }}
                            >
                              <Folder className="h-4 w-4 mr-2" style={{ color: folder.color }} />
                              {isInFolder ? `Retirer de ${folder.name}` : `Ajouter à ${folder.name}`}
                            </DropdownMenuItem>
                          );
                        })}
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
