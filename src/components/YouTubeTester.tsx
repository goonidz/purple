import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, RefreshCw, Search, Sliders, X, MoreVertical, BadgeCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface YouTubeTesterProps {
  projectId: string;
  videoTitle: string;
}

interface FakeVideo {
  id: string;
  thumbnail: string;
  title: string;
  channel: string;
  channelAvatar?: string;
  subscribers?: string;
  verified?: boolean;
  views: string;
  time: string;
  duration: string;
  vph?: string;
}

const categories = [
  "Tous", "Gaming", "IA", "Univers", "Podcasts", "Monétisation", "Musique", 
  "Mixes", "Entrepreneuriat", "Effets visuels", "Bourse", "Site web", 
  "Histoire", "Gadgets", "Jeux vidéo", "Nature", "Motivation", "Comédie"
];

const defaultFakeVideos: FakeVideo[] = [
  {
    id: "1",
    thumbnail: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=640&h=360&fit=crop",
    title: "Quelle est la vraie Fortune des Youtubeurs connus ?",
    channel: "Fuzzy",
    subscribers: "526K",
    verified: true,
    views: "286K",
    time: "il y a 1 an",
    duration: "23:14",
    vph: "7 VPH"
  },
  {
    id: "2",
    thumbnail: "https://images.unsplash.com/photo-1535016120720-40c646be5580?w=640&h=360&fit=crop",
    title: "NEW AI Video Generator Kling 2.6 DESTROYS Veo 3.1 & Sora 2?! Full Comparison",
    channel: "Dan Kieft",
    subscribers: "166K",
    verified: false,
    views: "7,6K",
    time: "il y a 3 heures",
    duration: "20:04",
    vph: "2,5K VPH"
  },
  {
    id: "3",
    thumbnail: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=640&h=360&fit=crop",
    title: "SURVIVRE à une BOMBE NUCLÉAIRE sur PARIS ? ⚠️",
    channel: "Science Trash",
    subscribers: "906K",
    verified: true,
    views: "3,9M",
    time: "il y a 3 ans",
    duration: "11:18",
    vph: "39 VPH"
  },
  {
    id: "4",
    thumbnail: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=640&h=360&fit=crop",
    title: "J'ai testé les PIRES arnaques sur Internet pendant 30 jours",
    channel: "Micode",
    subscribers: "2,1M",
    verified: true,
    views: "1,2M",
    time: "il y a 2 mois",
    duration: "32:45",
    vph: "156 VPH"
  },
  {
    id: "5",
    thumbnail: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=640&h=360&fit=crop",
    title: "Comment j'ai automatisé TOUT mon business avec l'IA",
    channel: "Marketing Mania",
    subscribers: "445K",
    verified: true,
    views: "234K",
    time: "il y a 1 semaine",
    duration: "18:22",
    vph: "89 VPH"
  },
  {
    id: "6",
    thumbnail: "https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=640&h=360&fit=crop",
    title: "Les 10 SECRETS que YouTube ne veut pas que vous sachiez",
    channel: "Underscore_",
    subscribers: "1,8M",
    verified: true,
    views: "890K",
    time: "il y a 5 jours",
    duration: "15:33",
    vph: "312 VPH"
  },
  {
    id: "7",
    thumbnail: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=640&h=360&fit=crop",
    title: "J'ai créé une startup en 24h avec ChatGPT (résultat fou)",
    channel: "Yomi Denzel",
    subscribers: "892K",
    verified: true,
    views: "456K",
    time: "il y a 3 semaines",
    duration: "28:17",
    vph: "67 VPH"
  },
  {
    id: "8",
    thumbnail: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=640&h=360&fit=crop",
    title: "Cette technologie va TOUT changer en 2025",
    channel: "Léo Duff",
    subscribers: "1,2M",
    verified: true,
    views: "678K",
    time: "il y a 2 semaines",
    duration: "21:09",
    vph: "134 VPH"
  }
];

export const YouTubeTester = ({ projectId, videoTitle }: YouTubeTesterProps) => {
  const [userThumbnail, setUserThumbnail] = useState<string | null>(null);
  const [userTitle, setUserTitle] = useState(videoTitle);
  const [userChannel] = useState("Ma Chaîne");
  const [userPosition, setUserPosition] = useState(1);
  const [fakeVideos, setFakeVideos] = useState<FakeVideo[]>(defaultFakeVideos);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("Tous");
  const [searchQuery, setSearchQuery] = useState("");

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

  const getVideoGrid = () => {
    const userVideo: FakeVideo = {
      id: "user",
      thumbnail: userThumbnail || "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=640&h=360&fit=crop",
      title: userTitle || "Votre titre ici",
      channel: userChannel,
      subscribers: "10K",
      verified: false,
      views: "0",
      time: "à l'instant",
      duration: "12:34"
    };

    const grid = [...fakeVideos.slice(0, 8)];
    grid.splice(userPosition, 0, userVideo);
    return grid.slice(0, 9);
  };

  const VideoCard = ({ video }: { video: FakeVideo }) => (
    <div className="group cursor-pointer">
      {/* Thumbnail */}
      <div className="relative aspect-video rounded-xl overflow-hidden mb-3 bg-neutral-800">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        />
        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 bg-black/90 text-white text-xs px-1.5 py-0.5 rounded font-medium">
          {video.duration}
        </div>
        {/* Hover overlay with progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-600 opacity-0 group-hover:opacity-100">
          <div className="h-full bg-red-600 w-0"></div>
        </div>
      </div>
      
      {/* Video info */}
      <div className="flex gap-3">
        {/* Channel avatar */}
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <span className="text-xs font-bold text-white">
              {video.channel.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="font-medium text-sm text-white line-clamp-2 leading-tight mb-1 group-hover:text-neutral-200">
            {video.title}
          </h3>
          
          {/* Channel info */}
          <div className="flex items-center gap-1 text-neutral-400 text-xs">
            <span className="hover:text-white transition-colors">{video.channel}</span>
            {video.verified && (
              <BadgeCheck className="w-3.5 h-3.5 text-neutral-400" />
            )}
            {video.subscribers && (
              <span className="text-neutral-500">• {video.subscribers} abonnés</span>
            )}
          </div>
          
          {/* Stats */}
          <div className="flex items-center gap-1 text-neutral-400 text-xs mt-0.5">
            <span>{video.views} vues</span>
            <span>•</span>
            <span>{video.time}</span>
          </div>
          
          {/* VPH badge */}
          {video.vph && (
            <div className="mt-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-300">
                {video.vph}
              </span>
            </div>
          )}
        </div>
        
        {/* More button */}
        <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 h-fit text-neutral-400 hover:text-white">
          <MoreVertical className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Controls Card */}
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
                Position
              </Button>
              <Button variant="outline" onClick={shuffleCompetitors} disabled={isLoading} className="flex-1">
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Concurrents
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* YouTube Simulation - Dark Theme */}
      <Card className="overflow-hidden">
        <div className="bg-neutral-900 text-white">
          {/* YouTube Header */}
          <div className="border-b border-neutral-800 p-4">
            <div className="flex items-center justify-center gap-4 max-w-2xl mx-auto">
              {/* Search bar */}
              <div className="flex-1 flex items-center">
                <div className="flex-1 flex items-center bg-neutral-800 border border-neutral-700 rounded-l-full overflow-hidden">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher"
                    className="border-0 bg-transparent text-white placeholder:text-neutral-400 focus-visible:ring-0 focus-visible:ring-offset-0 h-10"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")}
                      className="p-2 text-neutral-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button className="h-10 px-5 bg-neutral-700 border border-l-0 border-neutral-700 rounded-r-full hover:bg-neutral-600">
                  <Search className="w-4 h-4" />
                </button>
              </div>
              
              {/* Filter button */}
              <button className="flex items-center gap-2 px-4 py-2 bg-neutral-800 rounded-full hover:bg-neutral-700 text-sm">
                <Sliders className="w-4 h-4" />
                Filtres
              </button>
            </div>
          </div>

          {/* Categories */}
          <div className="border-b border-neutral-800 px-4 py-3">
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-3">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      selectedCategory === category
                        ? 'bg-white text-black'
                        : 'bg-neutral-800 text-white hover:bg-neutral-700'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" className="invisible" />
            </ScrollArea>
          </div>

          {/* Video Grid */}
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8">
              {getVideoGrid().map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};
