import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
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

interface TimelineBarProps {
  scenes: GeneratedPrompt[];
  selectedSceneIndex: number;
  onSelectScene: (index: number) => void;
  currentTime?: number;
}

export const TimelineBar = ({
  scenes,
  selectedSceneIndex,
  onSelectScene,
  currentTime = 0
}: TimelineBarProps) => {
  return (
    <div className="border-t bg-background p-4">
      <div className="flex items-center gap-4 mb-3">
        <Button variant="outline" size="icon">
          <Plus className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-2 pb-2">
              {scenes.map((scene, index) => (
                <Card
                  key={index}
                  className={cn(
                    "flex-shrink-0 w-32 h-20 cursor-pointer transition-all overflow-hidden",
                    selectedSceneIndex === index
                      ? "ring-2 ring-primary"
                      : "opacity-70 hover:opacity-100"
                  )}
                  onClick={() => onSelectScene(index)}
                >
                  {scene.imageUrl ? (
                    <div className="relative w-full h-full">
                      <img
                        src={scene.imageUrl}
                        alt={`Scene ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-2 py-1 text-center">
                        {index + 1}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-muted-foreground">
                          {index + 1}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {scene.duration.toFixed(1)}s
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};
