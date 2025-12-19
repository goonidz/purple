import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Play, Pause, SkipBack, SkipForward, Subtitles, RefreshCw, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
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

interface VideoPreviewProps {
  audioUrl: string;
  prompts: GeneratedPrompt[];
  autoPlay?: boolean;
  startFromScene?: number;
  subtitleSettings?: SubtitleSettings;
  onSubtitleSettingsChange?: (settings: SubtitleSettings) => void;
  onRegeneratePrompt?: (sceneIndex: number) => void;
  onRegenerateImage?: (sceneIndex: number) => void;
  onUpdatePrompt?: (sceneIndex: number, newPrompt: string) => void;
  regeneratingPromptIndex?: number | null;
  regeneratingImageIndex?: number | null;
}

interface SubtitleSettings {
  enabled: boolean;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  opacity: number;
  textShadow: string;
  x: number; // position X en %
  y: number; // position Y en %
}

export const VideoPreview = ({ 
  audioUrl, 
  prompts, 
  autoPlay = false, 
  startFromScene = 0,
  subtitleSettings = {
    enabled: true,
    fontSize: 18,
    fontFamily: 'Arial, sans-serif',
    color: '#ffffff',
    backgroundColor: '#000000',
    opacity: 0.8,
    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
    x: 50,
    y: 85
  },
  onSubtitleSettingsChange,
  onRegeneratePrompt,
  onRegenerateImage,
  onUpdatePrompt,
  regeneratingPromptIndex = null,
  regeneratingImageIndex = null
}: VideoPreviewProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number>();
  const subtitleRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [subtitleEnabled, setSubtitleEnabled] = useState(() => subtitleSettings.enabled);
  const [editedPrompt, setEditedPrompt] = useState<string>("");
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [previousImageUrl, setPreviousImageUrl] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startFromScene > 0 ? prompts[startFromScene].startTime : 0);
  const [duration, setDuration] = useState(0);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(startFromScene);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Preload next image and handle scene transitions
  useEffect(() => {
    const currentImageUrl = prompts[currentSceneIndex]?.imageUrl;
    const prevIndex = currentSceneIndex - 1;
    const prevImageUrl = prevIndex >= 0 ? prompts[prevIndex]?.imageUrl : null;
    
    // Save previous image URL before changing scene
    if (prevImageUrl && prevImageUrl !== currentImageUrl) {
      setPreviousImageUrl(prevImageUrl);
    } else if (!prevImageUrl) {
      // No previous image (first scene or no image in previous scene)
      setPreviousImageUrl(null);
    }
    
    // Preload next image
    if (currentSceneIndex < prompts.length - 1 && prompts[currentSceneIndex + 1]?.imageUrl) {
      const nextImg = new Image();
      nextImg.src = prompts[currentSceneIndex + 1].imageUrl!;
    }
    
    // Reset loaded state when scene changes
    setImageLoaded(false);
  }, [currentSceneIndex, prompts]);

  // Drag handlers for subtitle positioning
  const handleSubtitleMouseDown = (e: React.MouseEvent) => {
    if (!subtitleRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !subtitleRef.current) return;
    const videoContainer = subtitleRef.current.parentElement;
    if (!videoContainer) return;

    const rect = videoContainer.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const newSettings = {
      ...subtitleSettings,
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y))
    };
    onSubtitleSettingsChange?.(newSettings);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, subtitleSettings]);

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

    if (!audioRef.current.paused) {
      animationFrameRef.current = requestAnimationFrame(syncImageWithAudio);
    } else {
      setIsPlaying(false);
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
    
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4];
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

  // Reset aspect ratio and edited prompt when scene changes
  useEffect(() => {
    setImageAspectRatio(null);
    setEditedPrompt(prompts[currentSceneIndex]?.prompt || "");
  }, [currentSceneIndex, prompts]);

  // Auto-save prompt when edited (with debounce)
  useEffect(() => {
    // Don't save if prompt hasn't changed or is the same as current
    if (editedPrompt === prompts[currentSceneIndex]?.prompt || !onUpdatePrompt) {
      return;
    }

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout to save after 1 second of no typing
    saveTimeoutRef.current = setTimeout(() => {
      if (editedPrompt.trim() && editedPrompt !== prompts[currentSceneIndex]?.prompt) {
        onUpdatePrompt(currentSceneIndex, editedPrompt);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editedPrompt, currentSceneIndex, prompts, onUpdatePrompt]);

  // Format time as MM:SS
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-base font-semibold">Preview Vidéo</h3>

      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="auto" />

      {/* Image preview */}
      <div className="relative w-full bg-black rounded-lg overflow-hidden group flex items-center justify-center" style={{ minHeight: '200px' }}>
        {currentPrompt?.imageUrl ? (
          <>
            {/* Previous image (fade out) - only show during transition */}
            {previousImageUrl && previousImageUrl !== currentPrompt.imageUrl && !imageLoaded && (
              <img
                src={previousImageUrl}
                alt={`Previous scene`}
                className="absolute max-w-full max-h-[50vh] w-auto h-auto object-contain opacity-100 transition-opacity duration-200"
                style={{ zIndex: 1 }}
              />
            )}
            {/* Current image - always show, fade in when loaded if transitioning */}
            <img
              src={currentPrompt.imageUrl}
              alt={`Scene ${currentSceneIndex + 1}`}
              className={`max-w-full max-h-[50vh] w-auto h-auto object-contain transition-opacity duration-200 ${
                imageLoaded || !previousImageUrl || previousImageUrl === currentPrompt.imageUrl 
                  ? 'opacity-100' 
                  : 'opacity-0'
              }`}
              style={{ zIndex: 2 }}
              onLoad={(e) => {
                const img = e.currentTarget;
                const aspectRatio = img.naturalWidth / img.naturalHeight;
                setImageAspectRatio(aspectRatio);
                setImageLoaded(true);
              }}
              onError={() => {
                setImageLoaded(true); // Show placeholder even on error
              }}
              loading="eager"
            />
          </>
        ) : (
          <div className="w-full min-h-[200px] flex items-center justify-center text-muted-foreground text-sm">
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
        <div className="absolute bottom-4 right-4 bg-black/70 text-white px-3 py-1 rounded text-sm pointer-events-none">
          {playbackRate}x
        </div>
        
        {/* Subtitles */}
        {subtitleEnabled && currentPrompt?.text && (
          <div 
            ref={subtitleRef}
            onMouseDown={handleSubtitleMouseDown}
            className="absolute cursor-move select-none"
            style={{
              left: `${subtitleSettings.x}%`,
              top: `${subtitleSettings.y}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: `${subtitleSettings.fontSize}px`,
              fontFamily: subtitleSettings.fontFamily,
              color: subtitleSettings.color,
              backgroundColor: subtitleSettings.backgroundColor,
              opacity: subtitleSettings.opacity,
              textShadow: subtitleSettings.textShadow,
              padding: '8px 16px',
              borderRadius: '4px',
              maxWidth: '90%',
              textAlign: 'center'
            }}
          >
            {currentPrompt.text}
          </div>
        )}
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
        
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            const newValue = !subtitleEnabled;
            setSubtitleEnabled(newValue);
            if (onSubtitleSettingsChange) {
              onSubtitleSettingsChange({ ...subtitleSettings, enabled: newValue });
            }
          }}
          title={subtitleEnabled ? "Masquer les sous-titres" : "Afficher les sous-titres"}
        >
          <Subtitles className={subtitleEnabled ? "h-4 w-4" : "h-4 w-4 opacity-50"} />
        </Button>
      </div>

      {/* Current scene info */}
      {currentPrompt && (
        <div className="p-4 bg-muted rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={skipToPreviousScene}
                disabled={currentSceneIndex === 0}
                className="h-8 w-8 p-0"
                title="Scène précédente"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="font-medium">Scène {currentSceneIndex + 1} / {prompts.length}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={skipToNextScene}
                disabled={currentSceneIndex >= prompts.length - 1}
                className="h-8 w-8 p-0"
                title="Scène suivante"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {(onRegeneratePrompt || onRegenerateImage) && (
              <div className="flex gap-2">
                {onRegeneratePrompt && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onRegeneratePrompt(currentSceneIndex)}
                    disabled={regeneratingPromptIndex === currentSceneIndex || regeneratingImageIndex === currentSceneIndex}
                    className="h-8"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${regeneratingPromptIndex === currentSceneIndex ? 'animate-spin' : ''}`} />
                    Régénérer prompt scène {currentSceneIndex + 1}
                  </Button>
                )}
                {onRegenerateImage && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onRegenerateImage(currentSceneIndex)}
                    disabled={regeneratingPromptIndex === currentSceneIndex || regeneratingImageIndex === currentSceneIndex}
                    className="h-8"
                  >
                    <ImageIcon className={`h-4 w-4 mr-2 ${regeneratingImageIndex === currentSceneIndex ? 'animate-spin' : ''}`} />
                    Régénérer image scène {currentSceneIndex + 1}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Texte :</div>
              <div className="text-sm line-clamp-2">
                {currentPrompt.text}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium text-muted-foreground">Prompt :</div>
                {editedPrompt !== currentPrompt.prompt && (
                  <span className="text-xs text-orange-500">• Modifié</span>
                )}
              </div>
              <Textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="text-sm min-h-[80px] resize-y"
                placeholder="Prompt pour la génération d'image..."
              />
              {editedPrompt !== currentPrompt.prompt && (
                <div className="text-xs text-muted-foreground mt-1">
                  Sauvegarde automatique...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
