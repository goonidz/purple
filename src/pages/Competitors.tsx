import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import CompetitorVideoList from "@/components/CompetitorVideoList";
import CompetitorSidebar from "@/components/CompetitorSidebar";
import AddCompetitorModal from "@/components/AddCompetitorModal";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

interface Video {
  id: string;
  video_id: string;
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string;
  view_count: number;
  views_per_hour: number;
  outlier_score: number;
}

export default function Competitors() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>('30d');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Check authentication
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
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

  // Load channels
  const loadChannels = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('competitor_channels')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setChannels(data || []);
      
      // Select all channels by default
      if (selectedChannels.length === 0 && data && data.length > 0) {
        setSelectedChannels(data.map(c => c.channel_id));
      }
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

      // Get videos for selected channels
      const channelsToFetch = selectedChannels.length > 0 ? selectedChannels : channels.map(c => c.channel_id);

      const { data, error } = await supabase
        .from('competitor_videos')
        .select('*')
        .in('channel_id', channelsToFetch)
        .gte('published_at', periodDate.toISOString())
        .order('outlier_score', { ascending: false });

      if (error) throw error;

      setVideos(data || []);
    } catch (error) {
      console.error("Error loading videos:", error);
      toast.error("Erreur lors du chargement des vidéos");
    } finally {
      setIsLoading(false);
    }
  }, [channels, selectedChannels, period]);

  // Initial load
  useEffect(() => {
    loadFolders();
    loadChannels();
  }, [loadFolders, loadChannels]);

  // Load videos when channels or filters change
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // Sync videos
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-competitor-videos', {
        body: { period }
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      toast.success(`${data.synced} vidéos synchronisées`);
      
      // Reload videos
      await loadVideos();
    } catch (error) {
      console.error("Error syncing:", error);
      toast.error(error instanceof Error ? error.message : "Erreur lors de la synchronisation");
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <AppHeader>
        <span className="text-muted-foreground hidden sm:inline">/</span>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span className="font-medium">Competitors</span>
        </div>
      </AppHeader>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Main content */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold">Top Videos From Your Competitors</h1>
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
            />
          </div>
        </div>

        {/* Sidebar */}
        <CompetitorSidebar
          channels={channels}
          folders={folders}
          selectedChannels={selectedChannels}
          onSelectionChange={handleSelectionChange}
          onAddClick={() => setShowAddModal(true)}
          onRefresh={() => {
            loadFolders();
            loadChannels();
          }}
        />
      </div>

      {/* Add modal */}
      <AddCompetitorModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onSuccess={handleChannelAdded}
      />
    </div>
  );
}
