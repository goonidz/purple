import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import CompetitorVideoList from "@/components/CompetitorVideoList";
import CompetitorSidebar from "@/components/CompetitorSidebar";
import AddCompetitorModal from "@/components/AddCompetitorModal";
import CalendarVideoModal from "@/components/CalendarVideoModal";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

interface Channel {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_avatar: string | null;
  subscriber_count: number;
  avg_views_per_video: number;
  is_active: boolean;
  folder_id: string | null;
  updated_at: string;
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

interface Video {
  id: string;
  video_id: string;
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string;
  view_count: number;
  duration_seconds: number | null;
  views_per_hour: number;
  outlier_score: number;
}

export default function Competitors() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [channelFolders, setChannelFolders] = useState<ChannelFolder[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  // null = nothing selected, "__all__" = all competitors
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>('30d');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [selectedVideoForCalendar, setSelectedVideoForCalendar] = useState<Video | null>(null);

  // Check authentication
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
      } else {
        setUser(user);
      }
    };
    checkAuth();
  }, [navigate]);

  // Load folders
  const loadFolders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('competitor_folders')
        .select('*')
        .order('position', { ascending: true });

      if (error) throw error;

      setFolders(data || []);
    } catch (error) {
      console.error("Error loading folders:", error);
      toast.error("Erreur lors du chargement des dossiers");
    }
  }, []);

  // Load channel-folder associations
  const loadChannelFolders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('competitor_channel_folders')
        .select('*');

      if (error) throw error;

      setChannelFolders(data || []);
    } catch (error) {
      console.error("Error loading channel folders:", error);
      // Silently fail - might not exist yet
    }
  }, []);

  // Load channels
  const loadChannels = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('competitor_channels')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setChannels(data || []);
    } catch (error) {
      console.error("Error loading channels:", error);
      toast.error("Erreur lors du chargement des chaînes");
    }
  }, []);

  // Load videos
  const loadVideos = useCallback(async () => {
    if (channels.length === 0) {
      setVideos([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      // Calculate period date
      const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      const periodDate = new Date();
      periodDate.setDate(periodDate.getDate() - periodDays);

      // Filter channels by selected folder (using associations)
      let channelsToUse = channels;
      if (selectedFolderId && selectedFolderId !== "__all__") {
        const channelIdsInFolder = channelFolders
          .filter(cf => cf.folder_id === selectedFolderId)
          .map(cf => cf.channel_id);
        
        console.log("Filtering by folder:", {
          selectedFolderId,
          channelIdsInFolder,
          allChannels: channels.map(c => ({ id: c.id, channel_id: c.channel_id, name: c.channel_name }))
        });
        
        // Also include channels with folder_id for backward compatibility
        channelsToUse = channels.filter(c => 
          channelIdsInFolder.includes(c.id) || c.folder_id === selectedFolderId
        );
        
        console.log("Channels after folder filter:", channelsToUse.map(c => ({ id: c.id, channel_id: c.channel_id, name: c.channel_name })));
      }

      // Get videos for selected channels
      const channelsToFetch = selectedChannels.length > 0 
        ? selectedChannels.filter(id => channelsToUse.some(c => c.channel_id === id))
        : channelsToUse.map(c => c.channel_id);

      console.log("Channels to fetch videos for:", {
        channelsToFetch,
        channelsToUseCount: channelsToUse.length,
        selectedChannelsCount: selectedChannels.length
      });

      if (channelsToFetch.length === 0) {
        console.warn("No channels to fetch videos for!");
        setVideos([]);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('competitor_videos')
        .select('*')
        .in('channel_id', channelsToFetch)
        .gte('published_at', periodDate.toISOString())
        .order('outlier_score', { ascending: false });

      if (error) {
        console.error("Error fetching videos:", error);
        throw error;
      }

      console.log("Videos fetched from DB:", {
        total: data?.length || 0,
        period: period,
        periodDate: periodDate.toISOString(),
        channelsToFetch: channelsToFetch.length
      });

      // Filter out shorts (videos < 2 minutes = 120 seconds)
      const filteredVideos = (data || []).filter(video => {
        // If duration is null or >= 120 seconds (2 minutes), keep it
        return !video.duration_seconds || video.duration_seconds >= 120;
      });

      console.log("Videos after filtering shorts:", {
        before: data?.length || 0,
        after: filteredVideos.length
      });

      setVideos(filteredVideos);
    } catch (error) {
      console.error("Error loading videos:", error);
      toast.error("Erreur lors du chargement des vidéos");
    } finally {
      setIsLoading(false);
    }
  }, [channels, selectedChannels, period, selectedFolderId, channelFolders]);

  // Initial load
  useEffect(() => {
    loadFolders();
    loadChannels();
    loadChannelFolders();
  }, [loadFolders, loadChannels, loadChannelFolders]);

  // Load videos when channels or filters change
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // Sync videos
  const handleSync = async () => {
    if (channels.length === 0) {
      toast.error("Aucun concurrent à synchroniser");
      return;
    }

    setIsSyncing(true);
    toast.info("Synchronisation en cours...", { duration: 2000 });
    
    try {
      console.log("Starting sync with:", { period, folderId: selectedFolderId, channelsCount: channels.length });
      
      const { data, error } = await supabase.functions.invoke('sync-competitor-videos', {
        body: { 
          period,
          folderId: selectedFolderId && selectedFolderId !== "__all__" ? selectedFolderId : undefined
        }
      });

      console.log("Sync response:", { data, error });

      if (error) {
        console.error("Supabase function error:", error);
        throw error;
      }

      if (data?.error) {
        console.error("Function returned error:", data.error);
        throw new Error(data.error);
      }

      const syncedCount = data?.synced || 0;
      const errors = data?.errors || [];
      
      if (errors.length > 0) {
        console.warn("Sync completed with errors:", errors);
        toast.warning(`${syncedCount} vidéos synchronisées, mais ${errors.length} erreur(s)`, {
          description: errors.slice(0, 2).join(", "),
          duration: 5000
        });
      } else {
        toast.success(`${syncedCount} vidéos synchronisées`);
      }
      
      // Reload videos after a short delay to ensure DB is updated
      setTimeout(async () => {
        await loadVideos();
      }, 1000);
    } catch (error) {
      console.error("Error syncing:", error);
      const errorMessage = error instanceof Error ? error.message : "Erreur lors de la synchronisation";
      toast.error(errorMessage, {
        description: "Vérifiez la console pour plus de détails",
        duration: 5000
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle channel added
  const handleChannelAdded = async () => {
    await loadChannels();
    // Auto-sync the new channel
    handleSync();
  };

  // Handle channel selection change
  const handleSelectionChange = (channelIds: string[]) => {
    setSelectedChannels(channelIds);
  };

  // Handle add video to calendar
  const handleAddToCalendar = (video: Video) => {
    setSelectedVideoForCalendar(video);
    setShowCalendarModal(true);
  };

  // Handle calendar modal close
  const handleCalendarModalClose = () => {
    setShowCalendarModal(false);
    setSelectedVideoForCalendar(null);
  };

  // Handle calendar entry saved
  const handleCalendarEntrySaved = () => {
    toast.success("Vidéo ajoutée au calendrier");
    handleCalendarModalClose();
  };

  // Set page title
  useEffect(() => {
    document.title = "Competitors";
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <AppHeader>
        <span className="text-muted-foreground hidden sm:inline">/</span>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span className="font-medium">Competitors</span>
        </div>
      </AppHeader>

      <div className="flex h-[calc(100vh-73px)] overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">Top Videos From Your Competitors</h1>
                  {selectedFolderId && selectedFolderId !== "__all__" && (
                    <span className="text-sm px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                      {folders.find(f => f.id === selectedFolderId)?.name || 'Dossier sélectionné'}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">
                  {videos.length} vidéos de {selectedChannels.length || channels.length} chaînes
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">7 derniers jours</SelectItem>
                    <SelectItem value="30d">30 derniers jours</SelectItem>
                    <SelectItem value="90d">90 derniers jours</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  onClick={handleSync}
                  disabled={isSyncing || channels.length === 0}
                  variant="outline"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Sync...' : 'Synchroniser'}
                </Button>
              </div>
            </div>

            {/* Video list */}
            <CompetitorVideoList
              videos={videos}
              channels={channels}
              isLoading={isLoading}
              onAddToCalendar={handleAddToCalendar}
            />
          </div>
        </div>

        {/* Sidebar */}
        <CompetitorSidebar
          channels={channels}
          folders={folders}
          channelFolders={channelFolders}
          selectedChannels={selectedChannels}
          selectedFolderId={selectedFolderId}
          onSelectionChange={handleSelectionChange}
          onFolderSelect={setSelectedFolderId}
          onAddClick={() => setShowAddModal(true)}
          onRefresh={() => {
            loadFolders();
            loadChannels();
            loadChannelFolders();
          }}
        />
      </div>

      {/* Add modal */}
      <AddCompetitorModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onSuccess={handleChannelAdded}
      />

      {/* Calendar modal */}
      {user && (
        <CalendarVideoModal
          isOpen={showCalendarModal}
          onClose={handleCalendarModalClose}
          entry={null}
          selectedDate={new Date()}
          userId={user.id}
          onSaved={handleCalendarEntrySaved}
          initialSourceUrl={selectedVideoForCalendar ? `https://youtube.com/watch?v=${selectedVideoForCalendar.video_id}` : undefined}
          initialSourceThumbnailUrl={selectedVideoForCalendar?.thumbnail_url || undefined}
          initialTitle={selectedVideoForCalendar?.title || undefined}
        />
      )}
    </div>
  );
}
