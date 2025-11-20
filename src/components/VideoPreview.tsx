import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";

interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

interface VideoPreviewProps {
  audioUrl: string;
  prompts: GeneratedPrompt[];
  autoPlay?: boolean;
  startFromScene?: number;
}

export const VideoPreview = ({ audioUrl, prompts, autoPlay = false, startFromScene = 0 }: VideoPreviewProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number>();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startFromScene > 0 ? prompts[startFromScene].startTime : 0);
  const [duration, setDuration] = useState(0);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(startFromScene);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Find which scene we're currently in based on time
  const getCurrentSceneIndex = (time: number) => {
    for (let i = 0; i < prompts.length; i++) {
      if (time >= prompts[i].startTime && time < prompts[i].endTime) {
        return i;
      }
    }
    // If past all scenes, show last scene
    if (time >= prompts[prompts.length - 1].endTime) {
      return prompts.length - 1;
    }
    return 0;
  };

  // Animation loop to sync image with audio
  const syncImageWithAudio = () => {
    if (!audioRef.current) return;

    const time = audioRef.current.currentTime;
    const sceneIndex = getCurrentSceneIndex(time);

    if (sceneIndex !== currentSceneIndex) {
      setCurrentSceneIndex(sceneIndex);
    }

    setCurrentTime(time);

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(syncImageWithAudio);
    }
  };

  // Handle play/pause
  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    } else {
      audioRef.current.play();
      setIsPlaying(true);
      syncImageWithAudio();
    }
  };

  // Handle scrubbing
  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return;
    
    const newTime = value[0];
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    
    const sceneIndex = getCurrentSceneIndex(newTime);
    setCurrentSceneIndex(sceneIndex);
  };

  // Skip to next scene
  const skipToNextScene = () => {
    if (!audioRef.current || currentSceneIndex >= prompts.length - 1) return;
    
    const nextScene = prompts[currentSceneIndex + 1];
    audioRef.current.currentTime = nextScene.startTime;
    setCurrentTime(nextScene.startTime);
    setCurrentSceneIndex(currentSceneIndex + 1);
  };

  // Skip to previous scene
  const skipToPreviousScene = () => {
    if (!audioRef.current) return;
    
    // If more than 2 seconds into current scene, restart it
    if (currentTime - prompts[currentSceneIndex].startTime > 2) {
      audioRef.current.currentTime = prompts[currentSceneIndex].startTime;
      setCurrentTime(prompts[currentSceneIndex].startTime);
    } else if (currentSceneIndex > 0) {
      // Otherwise go to previous scene
      const prevScene = prompts[currentSceneIndex - 1];
      audioRef.current.currentTime = prevScene.startTime;
      setCurrentTime(prevScene.startTime);
      setCurrentSceneIndex(currentSceneIndex - 1);
    }
  };

  // Handle playback rate change
  const changePlaybackRate = () => {
    if (!audioRef.current) return;
    
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    
    audioRef.current.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  // Setup audio element listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      
      // Set start time if starting from a specific scene
      if (startFromScene > 0) {
        audio.currentTime = prompts[startFromScene].startTime;
        setCurrentTime(prompts[startFromScene].startTime);
        setCurrentSceneIndex(startFromScene);
      }
      
      // Auto-play if requested
      if (autoPlay && !isPlaying) {
        audio.play();
        setIsPlaying(true);
        syncImageWithAudio();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [autoPlay]);

  const currentPrompt = prompts[currentSceneIndex];

  // Format time as MM:SS
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="p-6 space-y-4">
      <h3 className="text-lg font-semibold">Preview Vidéo</h3>

      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="auto" />

      {/* Image preview */}
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden group">
        {currentPrompt?.imageUrl ? (
          <img
            src={currentPrompt.imageUrl}
            alt={`Scene ${currentSceneIndex + 1}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            Aucune image pour cette scène
          </div>
        )}
        
        {/* Hover controls overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Button
            size="lg"
            onClick={togglePlayPause}
            className="h-16 w-16 rounded-full"
          >
            {isPlaying ? (
              <Pause className="h-8 w-8" />
            ) : (
              <Play className="h-8 w-8" />
            )}
          </Button>
        </div>
        
        {/* Scene indicator overlay */}
        <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1 rounded text-sm pointer-events-none">
          Scène {currentSceneIndex + 1} / {prompts.length}
        </div>
        
        {/* Playback rate indicator */}
        <div className="absolute top-4 right-4 bg-black/70 text-white px-3 py-1 rounded text-sm pointer-events-none">
          {playbackRate}x
        </div>
      </div>

      {/* Timeline slider */}
      <div className="space-y-2">
        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeek}
          className="cursor-pointer"
        />
        
        {/* Timeline markers for scenes */}
        <div className="relative h-2">
          {prompts.map((prompt, index) => {
            const left = (prompt.startTime / duration) * 100;
            const width = ((prompt.endTime - prompt.startTime) / duration) * 100;
            
            return (
              <div
                key={index}
                className="absolute h-full bg-primary/30 hover:bg-primary/50 transition-colors"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                }}
                title={`Scène ${index + 1}`}
              />
            );
          })}
        </div>
        
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={skipToPreviousScene}
          disabled={currentSceneIndex === 0 && currentTime - prompts[0].startTime <= 2}
        >
          <SkipBack className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          onClick={togglePlayPause}
          className="h-12 w-12"
        >
          {isPlaying ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6" />
          )}
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={skipToNextScene}
          disabled={currentSceneIndex >= prompts.length - 1}
        >
          <SkipForward className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          onClick={changePlaybackRate}
          className="min-w-[60px]"
        >
          {playbackRate}x
        </Button>
      </div>

      {/* Current scene info */}
      {currentPrompt && (
        <div className="p-4 bg-muted rounded-lg space-y-2">
          <div className="font-medium">Scène {currentSceneIndex + 1}</div>
          <div className="text-sm text-muted-foreground line-clamp-2">
            {currentPrompt.text}
          </div>
        </div>
      )}
    </Card>
  );
};
