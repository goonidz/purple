import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Calendar, FolderOpen, User, Sparkles, Users, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  title?: string;
  children?: React.ReactNode;
}

export default function AppHeader({ title, children }: AppHeaderProps) {
  const location = useLocation();
  
  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <Link 
              to="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-base sm:text-lg bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent hidden sm:inline">
                {title || "VideoFlow"}
              </span>
            </Link>
            <div className="min-w-0 flex-1">
              {children}
            </div>
          </div>
          <nav className="flex items-center gap-1 flex-shrink-0">
            <Link to="/calendar">
              <Button 
                variant={isActive("/calendar") ? "secondary" : "ghost"} 
                size="sm"
                className={cn(isActive("/calendar") && "bg-primary/10")}
              >
                <Calendar className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Calendrier</span>
              </Button>
            </Link>
            <Link to="/competitors">
              <Button 
                variant={isActive("/competitors") ? "secondary" : "ghost"} 
                size="sm"
                className={cn(isActive("/competitors") && "bg-primary/10")}
              >
                <Users className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Competitors</span>
              </Button>
            </Link>
            <Link to="/projects">
              <Button 
                variant={isActive("/projects") ? "secondary" : "ghost"} 
                size="sm"
                className={cn(isActive("/projects") && "bg-primary/10")}
              >
                <FolderOpen className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Projets</span>
              </Button>
            </Link>
            <Link to="/presets">
              <Button 
                variant={isActive("/presets") ? "secondary" : "ghost"} 
                size="sm"
                className={cn(isActive("/presets") && "bg-primary/10")}
              >
                <SlidersHorizontal className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Presets</span>
              </Button>
            </Link>
            <Link to="/profile">
              <Button 
                variant={isActive("/profile") ? "secondary" : "ghost"} 
                size="sm"
                className={cn(isActive("/profile") && "bg-primary/10")}
              >
                <User className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Profil</span>
              </Button>
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}


