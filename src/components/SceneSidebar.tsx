import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Image as ImageIcon, Trash2, RefreshCw, Upload, Loader2, Eye, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

interface SceneSidebarProps {
  scenes: GeneratedPrompt[];
  selectedSceneIndex: number;
  onSelectScene: (index: number) => void;
  onDeleteScene?: (index: number) => void;
  onRegenerateImage?: (index: number) => void;
  onRegeneratePrompt?: (index: number) => void;
  onUploadImage?: (index: number, file: File) => void;
  isGeneratingImage?: number | null;
  isGeneratingPrompt?: number | null;
}

export const SceneSidebar = ({
  scenes,
  selectedSceneIndex,
  onSelectScene,
  onDeleteScene,
  onRegenerateImage,
  onRegeneratePrompt,
  onUploadImage,
  isGeneratingImage,
  isGeneratingPrompt
}: SceneSidebarProps) => {
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timeout = setTimeout(() => {
      const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      if (!scrollContainer) {
        console.log('ScrollArea viewport not found');
        return;
      }

      const handleScroll = () => {
        const scrollTop = scrollContainer.scrollTop;
        setShowScrollTop(scrollTop > 200);
      };

      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }, 100);

    return () => clearTimeout(timeout);
  }, [scenes.length]);

  const scrollToTop = () => {
    const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
    scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleViewPrompt = (prompt: string) => {
    setSelectedPrompt(prompt);
    setPromptDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col border-r bg-background relative">
      {/* Search */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search"
            className="pl-9"
          />
        </div>
      </div>

      {/* Scenes list */}
      <ScrollArea className="flex-1 relative" ref={scrollAreaRef}>
        <div className="p-2 space-y-2">
          {scenes.map((scene, index) => (
            <Card
              key={index}
              className={cn(
                "p-3 cursor-pointer transition-all hover:shadow-md",
                selectedSceneIndex === index
                  ? "ring-2 ring-primary bg-primary/5"
                  : "hover:bg-muted/50"
              )}
              onClick={() => onSelectScene(index)}
            >
              <div className="flex gap-3">
                {/* Thumbnail */}
                <div className="flex-shrink-0 w-20 h-14 bg-muted rounded overflow-hidden">
                  {scene.imageUrl ? (
                    <img
                      src={scene.imageUrl}
                      alt={`Scene ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-1">
                    <span className="font-semibold text-sm">Scene {index + 1}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {scene.text}
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <ImageIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {formatTime(scene.startTime)} - {formatTime(scene.endTime)}
                    </span>
                  </div>
                  
                  {/* Actions - shown only if scene is selected */}
                  {selectedSceneIndex === index && (
                    <div className="flex gap-1 flex-wrap">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewPrompt(scene.prompt);
                        }}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Voir prompt
                      </Button>
                      
                      {onUploadImage && (
                        <label onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <span className="cursor-pointer">
                              <Upload className="h-3 w-3 mr-1" />
                              Upload
                            </span>
                          </Button>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                onUploadImage(index, file);
                              }
                            }}
                          />
                        </label>
                      )}
                      
                      {onRegenerateImage && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRegenerateImage(index);
                          }}
                          disabled={isGeneratingImage === index}
                        >
                          {isGeneratingImage === index ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Regenerate Image
                        </Button>
                      )}
                      
                      {onRegeneratePrompt && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRegeneratePrompt(index);
                          }}
                          disabled={isGeneratingPrompt === index}
                        >
                          {isGeneratingPrompt === index ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Regenerate Prompt
                        </Button>
                      )}
                      
                      {onDeleteScene && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteScene(index);
                          }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* Scroll to top button */}
      {showScrollTop && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-4 right-6 z-10 rounded-full shadow-lg animate-fade-in"
          onClick={scrollToTop}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}

      {/* Prompt Dialog */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Prompt de l'image</DialogTitle>
          </DialogHeader>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm whitespace-pre-wrap">{selectedPrompt}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
