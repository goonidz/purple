import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExternalLink, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import OutlierBadge from "./OutlierBadge";

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

interface Channel {
  channel_id: string;
  channel_name: string;
  subscriber_count: number;
}

interface CompetitorVideoListProps {
  videos: Video[];
  channels: Channel[];
  isLoading?: boolean;
}

type SortField = 'view_count' | 'outlier_score' | 'views_per_hour' | 'published_at';
type SortDirection = 'asc' | 'desc';

function formatViews(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(0)}K`;
  }
  return count.toLocaleString();
}

function formatViewsPerHour(vph: number): string {
  if (vph >= 1000) {
    return `${(vph / 1000).toFixed(1)}K`;
  }
  return vph.toFixed(1);
}

function formatSubscribers(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M subs`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(0)}K subs`;
  }
  return `${count} subs`;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays === 1) return "hier";
  if (diffDays < 7) return `il y a ${diffDays} jours`;
  if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)} semaines`;
  if (diffDays < 365) return `il y a ${Math.floor(diffDays / 30)} mois`;
  return `il y a ${Math.floor(diffDays / 365)} ans`;
}

export default function CompetitorVideoList({ videos, channels, isLoading }: CompetitorVideoListProps) {
  const [sortField, setSortField] = useState<SortField>('outlier_score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedVideos = [...videos].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    switch (sortField) {
      case 'view_count':
        return (a.view_count - b.view_count) * multiplier;
      case 'outlier_score':
        return (a.outlier_score - b.outlier_score) * multiplier;
      case 'views_per_hour':
        return (a.views_per_hour - b.views_per_hour) * multiplier;
      case 'published_at':
        return (new Date(a.published_at).getTime() - new Date(b.published_at).getTime()) * multiplier;
      default:
        return 0;
    }
  });

  const getChannelInfo = (channelId: string) => {
    return channels.find(c => c.channel_id === channelId);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Chargement des vidéos...</p>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">Aucune vidéo</p>
          <p className="text-sm">Ajoutez des concurrents et synchronisez pour voir leurs vidéos</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[400px]">Vidéo</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 -ml-2 font-medium"
                onClick={() => handleSort('view_count')}
              >
                Vues
                <SortIcon field="view_count" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 -ml-2 font-medium"
                onClick={() => handleSort('outlier_score')}
              >
                Outlier Score
                <SortIcon field="outlier_score" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 -ml-2 font-medium"
                onClick={() => handleSort('views_per_hour')}
              >
                Vues/Heure
                <SortIcon field="views_per_hour" />
              </Button>
            </TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedVideos.map((video) => {
            const channel = getChannelInfo(video.channel_id);
            
            return (
              <TableRow key={video.id} className="hover:bg-muted/30">
                <TableCell>
                  <div className="flex gap-3">
                    {video.thumbnail_url && (
                      <div className="w-32 aspect-video rounded overflow-hidden flex-shrink-0 bg-muted">
                        <img
                          src={video.thumbnail_url}
                          alt={video.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm line-clamp-2 mb-1">
                        {video.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {channel?.channel_name || 'Unknown'} • {channel ? formatSubscribers(channel.subscriber_count) : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeAgo(video.published_at)}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  {formatViews(video.view_count)}
                </TableCell>
                <TableCell>
                  <OutlierBadge score={video.outlier_score} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatViewsPerHour(video.views_per_hour)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    asChild
                  >
                    <a
                      href={`https://youtube.com/watch?v=${video.video_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
