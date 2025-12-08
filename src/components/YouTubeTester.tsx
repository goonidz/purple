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
  // Tech & IA
  { id: "1", thumbnail: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=640&h=360&fit=crop", title: "NEW AI Video Generator Kling 2.6 DESTROYS Veo 3.1 & Sora 2?!", channel: "Dan Kieft", subscribers: "166K", verified: false, views: "7,6K", time: "il y a 3 heures", duration: "20:04", vph: "2,5K VPH" },
  { id: "2", thumbnail: "https://images.unsplash.com/photo-1676299081847-c3c9b3f3d7a0?w=640&h=360&fit=crop", title: "J'ai créé une startup en 24h avec ChatGPT (résultat fou)", channel: "Yomi Denzel", subscribers: "892K", verified: true, views: "456K", time: "il y a 3 semaines", duration: "28:17", vph: "67 VPH" },
  { id: "3", thumbnail: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=640&h=360&fit=crop", title: "Comment j'ai automatisé TOUT mon business avec l'IA", channel: "Marketing Mania", subscribers: "445K", verified: true, views: "234K", time: "il y a 1 semaine", duration: "18:22", vph: "89 VPH" },
  { id: "4", thumbnail: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=640&h=360&fit=crop", title: "Cette technologie va TOUT changer en 2025", channel: "Léo Duff", subscribers: "1,2M", verified: true, views: "678K", time: "il y a 2 semaines", duration: "21:09", vph: "134 VPH" },
  { id: "5", thumbnail: "https://images.unsplash.com/photo-1694903089438-bf28d4697982?w=640&h=360&fit=crop", title: "GPT-5 est ENFIN là : tout ce que vous devez savoir", channel: "Underscore_", subscribers: "1,8M", verified: true, views: "1,2M", time: "il y a 1 jour", duration: "24:55", vph: "890 VPH" },
  { id: "6", thumbnail: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=640&h=360&fit=crop", title: "L'IA qui fait PEUR à Google (et pourquoi)", channel: "Underscore_", subscribers: "1,8M", verified: true, views: "2,3M", time: "il y a 1 mois", duration: "19:33", vph: "156 VPH" },
  // YouTube & Business
  { id: "7", thumbnail: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=640&h=360&fit=crop", title: "Les 10 SECRETS que YouTube ne veut pas que vous sachiez", channel: "Underscore_", subscribers: "1,8M", verified: true, views: "890K", time: "il y a 5 jours", duration: "15:33", vph: "312 VPH" },
  { id: "8", thumbnail: "https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=640&h=360&fit=crop", title: "Quelle est la vraie Fortune des Youtubeurs connus ?", channel: "Fuzzy", subscribers: "526K", verified: true, views: "286K", time: "il y a 1 an", duration: "23:14", vph: "7 VPH" },
  { id: "9", thumbnail: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=640&h=360&fit=crop", title: "Comment gagner 10 000€/mois avec YouTube", channel: "Enzo Honoré", subscribers: "234K", verified: true, views: "567K", time: "il y a 2 mois", duration: "19:45", vph: "45 VPH" },
  { id: "10", thumbnail: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=640&h=360&fit=crop", title: "L'algorithme YouTube EXPLIQUÉ (2024)", channel: "Jean Kev", subscribers: "345K", verified: true, views: "789K", time: "il y a 3 mois", duration: "22:11", vph: "67 VPH" },
  // Science & Espace
  { id: "11", thumbnail: "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=640&h=360&fit=crop", title: "SURVIVRE à une BOMBE NUCLÉAIRE sur PARIS ? ⚠️", channel: "Science Trash", subscribers: "906K", verified: true, views: "3,9M", time: "il y a 3 ans", duration: "11:18", vph: "39 VPH" },
  { id: "12", thumbnail: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=640&h=360&fit=crop", title: "Ce que la NASA nous cache sur Mars (preuves)", channel: "AstronoGeek", subscribers: "1,1M", verified: true, views: "2,3M", time: "il y a 6 mois", duration: "27:33", vph: "78 VPH" },
  { id: "13", thumbnail: "https://images.unsplash.com/photo-1462332420958-a05d1e002413?w=640&h=360&fit=crop", title: "Et si le Soleil DISPARAISSAIT pendant 24h ?", channel: "Dr Nozman", subscribers: "4,2M", verified: true, views: "5,6M", time: "il y a 1 an", duration: "14:22", vph: "156 VPH" },
  { id: "14", thumbnail: "https://images.unsplash.com/photo-1614728263952-84ea256f9679?w=640&h=360&fit=crop", title: "Les TROUS NOIRS expliqués simplement", channel: "ScienceEtonnante", subscribers: "1,5M", verified: true, views: "4,1M", time: "il y a 8 mois", duration: "25:44", vph: "112 VPH" },
  // Enquêtes & Arnaques
  { id: "15", thumbnail: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=640&h=360&fit=crop", title: "J'ai testé les PIRES arnaques sur Internet", channel: "Micode", subscribers: "2,1M", verified: true, views: "1,2M", time: "il y a 2 mois", duration: "32:45", vph: "156 VPH" },
  { id: "16", thumbnail: "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=640&h=360&fit=crop", title: "J'ai infiltré un réseau de FAUX influenceurs", channel: "Squeezie", subscribers: "18M", verified: true, views: "8,9M", time: "il y a 3 mois", duration: "45:12", vph: "234 VPH" },
  { id: "17", thumbnail: "https://images.unsplash.com/photo-1633265486064-086b219458ec?w=640&h=360&fit=crop", title: "Les PIRES hacks de l'histoire d'Internet", channel: "Micode", subscribers: "2,1M", verified: true, views: "3,4M", time: "il y a 8 mois", duration: "38:21", vph: "112 VPH" },
  { id: "18", thumbnail: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=640&h=360&fit=crop", title: "Comment les HACKERS volent vos données", channel: "Léo TechMaker", subscribers: "567K", verified: true, views: "1,8M", time: "il y a 4 mois", duration: "24:33", vph: "89 VPH" },
  // Gaming
  { id: "19", thumbnail: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=640&h=360&fit=crop", title: "J'ai joué à GTA 6 en avant-première", channel: "Gotaga", subscribers: "5,2M", verified: true, views: "4,5M", time: "il y a 1 semaine", duration: "25:33", vph: "567 VPH" },
  { id: "20", thumbnail: "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=640&h=360&fit=crop", title: "24h pour devenir PRO sur Fortnite", channel: "Inoxtag", subscribers: "8,5M", verified: true, views: "6,7M", time: "il y a 2 semaines", duration: "1:02:45", vph: "445 VPH" },
  { id: "21", thumbnail: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=640&h=360&fit=crop", title: "Le PIRE jeu vidéo de l'histoire", channel: "Joueur du Grenier", subscribers: "3,8M", verified: true, views: "5,2M", time: "il y a 5 mois", duration: "35:22", vph: "178 VPH" },
  // Lifestyle & Voyage
  { id: "22", thumbnail: "https://images.unsplash.com/photo-1488085061387-422e29b40080?w=640&h=360&fit=crop", title: "72h dans le pays le plus DANGEREUX du monde", channel: "Amixem", subscribers: "7,8M", verified: true, views: "12M", time: "il y a 1 mois", duration: "35:18", vph: "890 VPH" },
  { id: "23", thumbnail: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=640&h=360&fit=crop", title: "J'ai survécu 7 jours SEUL sur une île déserte", channel: "Tibo InShape", subscribers: "15M", verified: true, views: "9,8M", time: "il y a 3 semaines", duration: "42:11", vph: "678 VPH" },
  { id: "24", thumbnail: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=640&h=360&fit=crop", title: "J'ai testé le train le plus LUXUEUX du monde", channel: "Mcfly et Carlito", subscribers: "7,2M", verified: true, views: "8,1M", time: "il y a 2 mois", duration: "28:55", vph: "345 VPH" },
  // Finance & Crypto
  { id: "25", thumbnail: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=640&h=360&fit=crop", title: "Bitcoin à 100 000$ : trop tard pour investir ?", channel: "Hasheur", subscribers: "678K", verified: true, views: "345K", time: "il y a 2 jours", duration: "22:45", vph: "234 VPH" },
  { id: "26", thumbnail: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=640&h=360&fit=crop", title: "Comment j'ai perdu 50 000€ en trading", channel: "Matthieu Louvet", subscribers: "234K", verified: true, views: "456K", time: "il y a 1 mois", duration: "28:33", vph: "89 VPH" },
  { id: "27", thumbnail: "https://images.unsplash.com/photo-1559526324-593bc073d938?w=640&h=360&fit=crop", title: "La VÉRITÉ sur l'immobilier en 2024", channel: "Investir Simple", subscribers: "456K", verified: true, views: "678K", time: "il y a 3 semaines", duration: "21:18", vph: "112 VPH" },
  // Education & Motivation
  { id: "28", thumbnail: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=640&h=360&fit=crop", title: "Comment apprendre N'IMPORTE QUOI en 30 jours", channel: "Cyrus North", subscribers: "1,4M", verified: true, views: "2,1M", time: "il y a 4 mois", duration: "16:44", vph: "67 VPH" },
  { id: "29", thumbnail: "https://images.unsplash.com/photo-1493612276216-ee3925520721?w=640&h=360&fit=crop", title: "La routine SECRÈTE des milliardaires", channel: "Jean-Pierre Fanguin", subscribers: "567K", verified: true, views: "890K", time: "il y a 2 mois", duration: "19:22", vph: "56 VPH" },
  { id: "30", thumbnail: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=640&h=360&fit=crop", title: "Pourquoi vous ne serez JAMAIS riche", channel: "Yomi Denzel", subscribers: "892K", verified: true, views: "1,5M", time: "il y a 6 mois", duration: "25:11", vph: "78 VPH" },
  // Tech Reviews
  { id: "31", thumbnail: "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=640&h=360&fit=crop", title: "iPhone 16 Pro Max : le test ULTIME", channel: "MKBHD France", subscribers: "890K", verified: true, views: "1,2M", time: "il y a 3 semaines", duration: "24:18", vph: "145 VPH" },
  { id: "32", thumbnail: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=640&h=360&fit=crop", title: "Le nouveau MacBook M4 vaut-il vraiment 3000€ ?", channel: "TheiCollection", subscribers: "1,1M", verified: true, views: "678K", time: "il y a 1 semaine", duration: "21:55", vph: "189 VPH" },
  { id: "33", thumbnail: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=640&h=360&fit=crop", title: "J'ai testé les AirPods pendant 1 AN", channel: "Guillaume Slash", subscribers: "789K", verified: true, views: "567K", time: "il y a 2 mois", duration: "18:44", vph: "67 VPH" },
  // Histoire & Culture
  { id: "34", thumbnail: "https://images.unsplash.com/photo-1461360370896-922624d12a74?w=640&h=360&fit=crop", title: "L'histoire INCROYABLE des pyramides", channel: "Nota Bene", subscribers: "2,3M", verified: true, views: "4,5M", time: "il y a 6 mois", duration: "32:11", vph: "123 VPH" },
  { id: "35", thumbnail: "https://images.unsplash.com/photo-1548013146-72479768bada?w=640&h=360&fit=crop", title: "Comment l'Empire Romain s'est effondré", channel: "Nota Bene", subscribers: "2,3M", verified: true, views: "3,2M", time: "il y a 1 an", duration: "45:33", vph: "78 VPH" },
  { id: "36", thumbnail: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=640&h=360&fit=crop", title: "Les MYSTÈRES non résolus de l'Histoire", channel: "Doc Seven", subscribers: "1,9M", verified: true, views: "2,8M", time: "il y a 4 mois", duration: "28:22", vph: "89 VPH" },
  // Expériences sociales
  { id: "37", thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=640&h=360&fit=crop", title: "J'ai vécu comme un SDF pendant 7 jours", channel: "Poisson Fécond", subscribers: "3,4M", verified: true, views: "7,8M", time: "il y a 4 mois", duration: "38:22", vph: "234 VPH" },
  { id: "38", thumbnail: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=640&h=360&fit=crop", title: "Je donne 10 000€ à des inconnus", channel: "Michou", subscribers: "8,2M", verified: true, views: "5,6M", time: "il y a 2 semaines", duration: "22:45", vph: "567 VPH" },
  { id: "39", thumbnail: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=640&h=360&fit=crop", title: "24h sans téléphone : IMPOSSIBLE ?", channel: "Cyprien", subscribers: "14M", verified: true, views: "6,2M", time: "il y a 1 mois", duration: "15:33", vph: "345 VPH" },
  // Santé & Sport
  { id: "40", thumbnail: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=640&h=360&fit=crop", title: "J'ai transformé mon corps en 90 jours", channel: "Tibo InShape", subscribers: "15M", verified: true, views: "8,9M", time: "il y a 2 mois", duration: "28:33", vph: "345 VPH" },
  { id: "41", thumbnail: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=640&h=360&fit=crop", title: "Manger HEALTHY pendant 1 an (résultat)", channel: "Dr Mike FR", subscribers: "456K", verified: true, views: "890K", time: "il y a 3 mois", duration: "18:44", vph: "78 VPH" },
  { id: "42", thumbnail: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=640&h=360&fit=crop", title: "Comment j'ai pris 15kg de MUSCLE", channel: "Jeff Nippard FR", subscribers: "234K", verified: true, views: "567K", time: "il y a 5 mois", duration: "22:11", vph: "45 VPH" },
  // Musique & Créativité
  { id: "43", thumbnail: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=640&h=360&fit=crop", title: "J'ai composé un HIT en 24h avec des PROS", channel: "Music Maker", subscribers: "345K", verified: true, views: "567K", time: "il y a 1 mois", duration: "32:11", vph: "89 VPH" },
  { id: "44", thumbnail: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=640&h=360&fit=crop", title: "Les SECRETS de production des plus grands hits", channel: "PV Nova", subscribers: "1,2M", verified: true, views: "2,3M", time: "il y a 5 mois", duration: "25:55", vph: "112 VPH" },
  { id: "45", thumbnail: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=640&h=360&fit=crop", title: "Comment faire un SON VIRAL sur TikTok", channel: "Music Lab", subscribers: "678K", verified: true, views: "1,1M", time: "il y a 3 semaines", duration: "16:33", vph: "156 VPH" },
  // Divertissement
  { id: "46", thumbnail: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=640&h=360&fit=crop", title: "Les PIRES films de 2024 (vraiment nuls)", channel: "LinksTheSun", subscribers: "2,8M", verified: true, views: "3,4M", time: "il y a 2 semaines", duration: "42:18", vph: "234 VPH" },
  { id: "47", thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=640&h=360&fit=crop", title: "Analyse COMPLÈTE de la saison 2", channel: "Écran Large", subscribers: "1,5M", verified: true, views: "2,1M", time: "il y a 1 mois", duration: "38:44", vph: "89 VPH" },
  { id: "48", thumbnail: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=640&h=360&fit=crop", title: "Ce film va vous RETOURNER le cerveau", channel: "Captain Popcorn", subscribers: "890K", verified: true, views: "1,8M", time: "il y a 3 semaines", duration: "24:11", vph: "145 VPH" }
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
