import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, RefreshCw, Check, MoreVertical, Clock, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface YouTubeTesterProps {
  projectId: string;
  videoTitle: string;
}

interface FakeVideo {
  id: string;
  thumbnail: string;
  title: string;
  channel: string;
  views: string;
  time: string;
}

const defaultFakeVideos: FakeVideo[] = [
  {
    id: "1",
    thumbnail: "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=225&fit=crop",
    title: "10 astuces pour améliorer votre productivité",
    channel: "Productivité Pro",
    views: "234K vues",
    time: "il y a 2 jours"
  },
  {
    id: "2",
    thumbnail: "https://images.unsplash.com/photo-1504805572947-34fad45aed93?w=400&h=225&fit=crop",
    title: "Comment réussir en 2024 - Guide complet",
    channel: "Success Academy",
    views: "1,2M vues",
    time: "il y a 1 semaine"
  },
  {
    id: "3",
    thumbnail: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=225&fit=crop",
    title: "Les secrets du marketing digital révélés",
    channel: "Marketing Expert",
    views: "89K vues",
    time: "il y a 3 jours"
  },
  {
    id: "4",
    thumbnail: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=225&fit=crop",
    title: "Tutoriel complet - Créer une app en 1 heure",
    channel: "Dev Tutorial",
    views: "456K vues",
    time: "il y a 5 jours"
  },
  {
    id: "5",
    thumbnail: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=225&fit=crop",
    title: "Pourquoi vous devez commencer maintenant",
    channel: "Motivation Daily",
    views: "678K vues",
    time: "il y a 1 jour"
  },
  {
    id: "6",
    thumbnail: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=400&h=225&fit=crop",
    title: "Les meilleurs outils IA pour créateurs",
    channel: "Tech Insights",
    views: "123K vues",
    time: "il y a 4 jours"
  },
  {
    id: "7",
    thumbnail: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=225&fit=crop",
    title: "Travailler de n'importe où - Le guide ultime",
    channel: "Nomad Life",
    views: "345K vues",
    time: "il y a 6 jours"
  },
  {
    id: "8",
    thumbnail: "https://images.unsplash.com/photo-1531973576160-7125cd663d86?w=400&h=225&fit=crop",
    title: "Comment j'ai doublé mes revenus en 6 mois",
    channel: "Finance & Liberté",
    views: "890K vues",
    time: "il y a 2 semaines"
  }
];

export const YouTubeTester = ({ projectId, videoTitle }: YouTubeTesterProps) => {
  const [userThumbnail, setUserThumbnail] = useState<string | null>(null);
  const [userTitle, setUserTitle] = useState(videoTitle);
  const [userChannel] = useState("Ma Chaîne");
  const [userPosition, setUserPosition] = useState(2); // Position in the grid (0-indexed)
  const [fakeVideos, setFakeVideos] = useState<FakeVideo[]>(defaultFakeVideos);
  const [isLoading, setIsLoading] = useState(false);

  // Load latest thumbnail from project history
  useEffect(() => {
    loadLatestThumbnail();
  }, [projectId]);

  useEffect(() => {
    setUserTitle(videoTitle);
  }, [videoTitle]);

  const loadLatestThumbnail = async () => {
    try {
      const { data, error } = await supabase
        .from("generated_thumbnails")
        .select("thumbnail_urls")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return;

      const urls = data.thumbnail_urls as string[];
      if (urls && urls.length > 0) {
        setUserThumbnail(urls[0]);
      }
    } catch (error) {
      console.error("Error loading thumbnail:", error);
    }
  };

  const handleThumbnailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUserThumbnail(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const shufflePosition = () => {
    const newPosition = Math.floor(Math.random() * 9);
    setUserPosition(newPosition);
  };

  const shuffleCompetitors = () => {
    setIsLoading(true);
    setTimeout(() => {
      const shuffled = [...defaultFakeVideos].sort(() => Math.random() - 0.5);
      setFakeVideos(shuffled);
      setIsLoading(false);
    }, 300);
  };

  // Create the video grid with user's video inserted at the specified position
  const getVideoGrid = () => {
    const userVideo: FakeVideo = {
      id: "user",
      thumbnail: userThumbnail || "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=225&fit=crop",
      title: userTitle || "Votre titre ici",
      channel: userChannel,
      views: "0 vues",
      time: "à l'instant"
    };

    const grid = [...fakeVideos.slice(0, 8)];
    grid.splice(userPosition, 0, userVideo);
    return grid.slice(0, 9);
  };

  const VideoCard = ({ video, isUser }: { video: FakeVideo; isUser: boolean }) => (
    <div className="group cursor-pointer">
      <div className="relative aspect-video rounded-xl overflow-hidden mb-3 bg-muted">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        />
        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-medium">
          12:34
        </div>
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>
      <div className="flex gap-3">
        {/* Channel avatar */}
        <div className="flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
            <span className="text-xs font-semibold text-foreground">
              {video.channel.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm line-clamp-2 leading-tight mb-1 group-hover:text-primary transition-colors">
            {video.title}
          </h3>
          <p className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {video.channel}
          </p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{video.views}</span>
            <span>•</span>
            <span>{video.time}</span>
          </div>
        </div>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 h-fit">
          <MoreVertical className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Tester votre miniature</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Visualisez comment votre miniature et titre apparaîtront dans les résultats YouTube parmi d'autres vidéos.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="thumbnail">Miniature</Label>
              <div className="mt-2">
                {userThumbnail ? (
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                    <img
                      src={userThumbnail}
                      alt="Your thumbnail"
                      className="w-full h-full object-cover"
                    />
                    <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                      <div className="text-white text-sm flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        Changer
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleThumbnailUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center aspect-video rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors cursor-pointer bg-muted/50">
                    <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">Importer une miniature</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Titre de la vidéo</Label>
              <Input
                id="title"
                value={userTitle}
                onChange={(e) => setUserTitle(e.target.value)}
                placeholder="Entrez votre titre"
                className="mt-2"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={shufflePosition} className="flex-1">
                <RefreshCw className="w-4 h-4 mr-2" />
                Changer position
              </Button>
              <Button variant="outline" onClick={shuffleCompetitors} disabled={isLoading} className="flex-1">
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Mélanger concurrents
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* YouTube-like Grid */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Aperçu YouTube</h3>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Eye className="w-4 h-4" />
            Position {userPosition + 1} / 9
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8">
          {getVideoGrid().map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              isUser={video.id === "user"}
            />
          ))}
        </div>
      </Card>
    </div>
  );
};
