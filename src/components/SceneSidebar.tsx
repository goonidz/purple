import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Image as ImageIcon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

export const SceneSidebar = ({
  scenes,
  selectedSceneIndex,
  onSelectScene,
  onDeleteScene
}: SceneSidebarProps) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col border-r bg-background">
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
      <ScrollArea className="flex-1">
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
                    {onDeleteScene && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteScene(index);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {scene.text}
                  </p>
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {formatTime(scene.startTime)} - {formatTime(scene.endTime)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
