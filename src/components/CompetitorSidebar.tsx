import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trash2, MoreHorizontal, Folder, ChevronDown, ChevronRight } from "lucide-react";
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
  onRefresh
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
      
      // Ouvrir le dossier pour que l'utilisateur voie la chaîne ajoutée
      const newOpen = new Set(openFolders);
      newOpen.add(folderId);
      setOpenFolders(newOpen);
      
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


  // Drag and Drop handlers
  const [draggedChannel, setDraggedChannel] = useState<Channel | null>(null);
  const [draggedFromFolder, setDraggedFromFolder] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, channel: Channel, fromFolderId: string | null) => {
    setDraggedChannel(channel);
    setDraggedFromFolder(fromFolderId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", channel.id);
    // Style visuel pendant le drag
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDraggedChannel(null);
    setDraggedFromFolder(null);
    setDragOverFolder(null);
    setIsDuplicating(false);
  };

  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDragOver = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    // Si Ctrl est pressé, c'est une duplication (copy), sinon c'est un déplacement (move)
    const isDup = e.ctrlKey || e.metaKey;
    setIsDuplicating(isDup);
    e.dataTransfer.dropEffect = isDup ? "copy" : "move";
    setDragOverFolder(folderId);
  };

  const handleDragLeave = () => {
    setDragOverFolder(null);
    setIsDuplicating(false);
  };

  const handleDrop = async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    setDragOverFolder(null);

    if (!draggedChannel) return;

    const channelId = draggedChannel.id;
    const isDuplicating = e.ctrlKey || e.metaKey; // Ctrl ou Cmd pour duplication

    // Si on dépose dans un dossier
    if (targetFolderId) {
      // Vérifier si la chaîne est déjà dans ce dossier
      const existing = channelFolders.find(
        cf => cf.channel_id === channelId && cf.folder_id === targetFolderId
      );

      if (existing) {
        toast.info("Cette chaîne est déjà dans ce dossier");
        setDraggedChannel(null);
        setDraggedFromFolder(null);
        return;
      }

      if (isDuplicating) {
        // DUPLICATION : Ajouter au dossier cible sans retirer du dossier source
        await handleAddChannelToFolder(channelId, targetFolderId);
        toast.success("Chaîne dupliquée dans le dossier");
      } else {
        // DÉPLACEMENT : Retirer du dossier source et ajouter au dossier cible
        // Si la chaîne était dans un dossier, la retirer
        if (draggedFromFolder) {
          await handleRemoveChannelFromFolder(channelId, draggedFromFolder);
        }
        // Ajouter au nouveau dossier
        await handleAddChannelToFolder(channelId, targetFolderId);
        toast.success("Chaîne déplacée");
      }
    } else {
      // Déposer dans "sans dossier" = retirer de tous les dossiers
      const currentFolders = channelFolders
        .filter(cf => cf.channel_id === channelId)
        .map(cf => cf.folder_id);

      for (const folderId of currentFolders) {
        await handleRemoveChannelFromFolder(channelId, folderId);
      }
      toast.success("Chaîne retirée de tous les dossiers");
    }

    setDraggedChannel(null);
    setDraggedFromFolder(null);
    setIsDuplicating(false);
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
      <div className="w-72 border-l bg-card/50 flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Competitors</h3>
            <span className="text-xs text-muted-foreground">
              {channels.length}
            </span>
          </div>
          
          <div className="flex gap-2">
            <Button 
              onClick={onAddClick} 
              size="sm" 
              className="flex-1"
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
            <Button 
              onClick={() => setShowAddFolder(true)} 
              size="sm" 
              variant="outline"
            >
              <Folder className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="p-3 border-b flex-shrink-0">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={allSelected}
              onCheckedChange={handleSelectAll}
            />
            <span className="text-sm">Tout sélectionner</span>
          </label>
        </div>

        <ScrollArea className="flex-1 min-h-0 w-full">
          <div className="p-2 space-y-1 w-full">
            {/* Bouton "Tous" - Zone de drop */}
            <div 
              className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                selectedFolderId === "__all__"
                  ? 'bg-primary/10 border border-primary/20' 
                  : 'hover:bg-accent/50'
              } ${
                dragOverFolder === null && draggedChannel 
                  ? `ring-2 ${isDuplicating ? 'ring-green-500 bg-green-50/50' : 'ring-primary'}` 
                  : ''
              }`}
              onDragOver={(e) => handleDragOver(e, null)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, null)}
            >
              <Checkbox
                checked={selectedFolderId === "__all__"}
                onCheckedChange={() => onFolderSelect(selectedFolderId === "__all__" ? null : "__all__")}
              />
              <button
                onClick={() => onFolderSelect(selectedFolderId === "__all__" ? null : "__all__")}
                className="flex items-center gap-2 flex-1 text-left"
              >
                <Folder className="h-4 w-4" />
                <span className={`text-sm font-medium ${selectedFolderId === "__all__" ? 'text-primary' : ''}`}>
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
                      <DropdownMenuContent align="end" sideOffset={5}>
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
                    <div 
                      className={`pl-4 space-y-1 min-h-[20px] overflow-hidden ${
                        dragOverFolder === folder.id && draggedChannel 
                          ? `ring-2 rounded ${isDuplicating ? 'ring-green-500 bg-green-50/50' : 'ring-primary'}` 
                          : ''
                      }`}
                      onDragOver={(e) => handleDragOver(e, folder.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, folder.id)}
                    >
                      {folderChannels.map((channel) => (
                        <div
                          key={channel.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, channel, folder.id)}
                          onDragEnd={handleDragEnd}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 group cursor-move min-w-0 overflow-hidden"
                        >
                          <Checkbox
                            checked={selectedChannels.includes(channel.channel_id)}
                            onCheckedChange={() => handleToggleChannel(channel.channel_id)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          />
                          
                          <Avatar className="h-8 w-8 flex-shrink-0">
                            <AvatarImage src={channel.channel_avatar || undefined} />
                            <AvatarFallback className="text-xs">
                              {channel.channel_name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          
                          <div className="flex-1 w-0">
                            <p className="text-sm font-medium truncate" title={channel.channel_name}>
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
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={5}>
                              <DropdownMenuItem
                                onClick={() => handleRemoveChannelFromFolder(channel.id, folder.id)}
                              >
                                Retirer de ce dossier
                              </DropdownMenuItem>
                              {sortedFolders
                                .filter(f => f.id !== folder.id)
                                .map((otherFolder) => {
                                  const isInOtherFolder = channelFolders.some(
                                    cf => cf.channel_id === channel.id && cf.folder_id === otherFolder.id
                                  );
                                  return (
                                    <DropdownMenuItem
                                      key={otherFolder.id}
                                      onClick={() => {
                                        if (isInOtherFolder) {
                                          handleRemoveChannelFromFolder(channel.id, otherFolder.id);
                                        } else {
                                          handleAddChannelToFolder(channel.id, otherFolder.id);
                                        }
                                      }}
                                    >
                                      <Folder className="h-4 w-4 mr-2" style={{ color: otherFolder.color }} />
                                      {isInOtherFolder ? `✓ Retirer de ${otherFolder.name}` : `Ajouter à ${otherFolder.name}`}
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
              <div 
                className="space-y-1 overflow-hidden"
                onDragOver={(e) => handleDragOver(e, null)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, null)}
              >
                {channelsWithoutFolder.map((channel) => (
                  <div
                    key={channel.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, channel, null)}
                    onDragEnd={handleDragEnd}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 group cursor-move min-w-0 overflow-hidden"
                  >
                    <Checkbox
                      checked={selectedChannels.includes(channel.channel_id)}
                      onCheckedChange={() => handleToggleChannel(channel.channel_id)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    />
                    
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={channel.channel_avatar || undefined} />
                      <AvatarFallback className="text-xs">
                        {channel.channel_name.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 w-0">
                      <p className="text-sm font-medium truncate" title={channel.channel_name}>
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
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={5}>
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
                              {isInFolder ? `✓ Retirer de ${folder.name}` : `Ajouter à ${folder.name}`}
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
