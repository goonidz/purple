import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Check,
  Copy,
  ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Upload,
  Clock,
  Search,
  Video,
  Info,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Scene {
  startTime: number;
  endTime: number;
  text: string;
}

interface GeneratedPrompt {
  startTime?: number;
  endTime?: number;
  text?: string;
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  continuityGroupId?: number | null;
  qa_checked?: boolean;
  qa_status?: 'OK' | 'REJECT';
  qa_explication?: string;
  qa_regeneration_prompt?: string;
  was_regenerated?: boolean;
  regenerated_prompt?: string;
}

interface SceneGridProps {
  scenes: Scene[];
  generatedPrompts: GeneratedPrompt[];
  formatTimecode: (seconds: number) => string;
  editingSceneIndex: number | null;
  editingPromptIndex: number | null;
  regeneratingPromptIndex: number | null;
  generatingPromptIndex: number | null;
  generatingImageIndices: Set<number>;
  regeneratedScenes?: Set<number>;
  animatingSceneIndex: number | null;
  copiedIndex: number | null;
  handleEditScene: (index: number) => void;
  handleEditPrompt: (index: number) => void;
  setConfirmRegeneratePrompt: (index: number | null) => void;
  setConfirmRegenerateImage: (index: number | null) => void;
  generateSinglePrompt: (index: number) => void;
  generateImage: (index: number) => void;
  handleRegenerateWithQAPrompt: (index: number) => void;
  uploadManualImage: (file: File, index: number) => void;
  copyToClipboard: (text: string | undefined, index: number) => void;
  setImagePreviewUrl: (url: string | null) => void;
  selectedScenes?: Set<number>;
  onToggleSceneSelection?: (index: number) => void;
  onSearchWeb?: (index: number, sceneText: string) => void;
  onAnimateScene?: (index: number) => void;
  visualContinuityEnabled?: boolean;
}

export function SceneGrid({
  scenes,
  generatedPrompts,
  formatTimecode,
  editingSceneIndex,
  editingPromptIndex,
  regeneratingPromptIndex,
  generatingPromptIndex,
  generatingImageIndices,
  regeneratedScenes = new Set(),
  animatingSceneIndex,
  copiedIndex,
  handleEditScene,
  handleEditPrompt,
  setConfirmRegeneratePrompt,
  setConfirmRegenerateImage,
  generateSinglePrompt,
  generateImage,
  handleRegenerateWithQAPrompt,
  uploadManualImage,
  copyToClipboard,
  setImagePreviewUrl,
  selectedScenes = new Set(),
  onToggleSceneSelection,
  onSearchWeb,
  onAnimateScene,
  visualContinuityEnabled = false,
}: SceneGridProps) {
  const items = scenes.length > 0 ? scenes : generatedPrompts;

  // Fonction pour obtenir la couleur du groupe
  const getGroupColor = (groupId: number | null | undefined): string => {
    if (groupId === null || groupId === undefined) return '';
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
      'bg-pink-500', 'bg-cyan-500', 'bg-yellow-500', 'bg-red-500',
      'bg-indigo-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500'
    ];
    return colors[(groupId - 1) % colors.length];
  };

  const triggerFileUpload = (index: number) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) uploadManualImage(file, index);
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      {/* Desktop headers */}
      <div className={`hidden md:grid md:items-center gap-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b ${onToggleSceneSelection ? 'md:grid-cols-[auto_auto_1fr_1fr_300px_auto]' : 'md:grid-cols-[auto_1fr_1fr_300px_auto]'}`}>
        {onToggleSceneSelection && <span className="w-8"></span>}
        <span className="w-16">Scène</span>
        <span>Texte</span>
        <span>Prompt</span>
        <span className="text-center">Image</span>
        <span className="w-8"></span>
      </div>
      {items.map((item, index) => {
        const scene = scenes.length > 0 ? (item as Scene) : null;
        const prompt =
          scenes.length > 0
            ? generatedPrompts.find((_, i) => i === index)
            : (item as GeneratedPrompt);

        const startTime = scene?.startTime ?? prompt?.startTime ?? 0;
        const endTime = scene?.endTime ?? prompt?.endTime ?? 0;
        const text = scene?.text ?? prompt?.text ?? "";

        return (
          <Card
            key={index}
            className={`p-4 grid gap-4 grid-cols-1 md:items-start ${onToggleSceneSelection ? 'md:grid-cols-[auto_auto_1fr_1fr_300px_auto]' : 'md:grid-cols-[auto_1fr_1fr_300px_auto]'}`}
          >
            {/* Checkbox for selection */}
            {onToggleSceneSelection && (
              <div className="flex items-start pt-1 md:pt-0">
                <Checkbox
                  checked={selectedScenes.has(index)}
                  onCheckedChange={() => onToggleSceneSelection(index)}
                  className="h-5 w-5"
                />
              </div>
            )}
            {/* Header: Number + Timing (always visible) */}
            <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-primary">#{index + 1}</span>
                {visualContinuityEnabled && prompt?.continuityGroupId !== null && prompt?.continuityGroupId !== undefined && (
                  <span className={`${getGroupColor(prompt.continuityGroupId)} text-white text-xs px-1.5 py-0.5 rounded font-bold`}>
                    G{prompt.continuityGroupId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 hidden md:inline" />
                <span>{formatTimecode(startTime)} - {formatTimecode(endTime)}</span>
                <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                  {(endTime - startTime).toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Scene Text */}
            <div className="space-y-1">
              <div className="flex items-center justify-between md:hidden">
                <span className="text-xs font-medium text-muted-foreground">Texte</span>
              </div>
              <div className="group relative">
                <p className="text-sm line-clamp-3">{text}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`absolute top-0 right-0 h-6 w-6 p-0 transition-opacity ${
                    editingSceneIndex === index
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                  onClick={() => handleEditScene(index)}
                  title="Modifier le texte"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Prompt */}
            <div className="space-y-1">
              <div className="flex items-center justify-between md:hidden">
                <span className="text-xs font-medium text-muted-foreground">Prompt</span>
              </div>
              {prompt?.prompt ? (
                <div className="group relative">
                  {/* Show regenerated prompt if exists, otherwise original */}
                  {prompt?.regenerated_prompt ? (
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-medium text-blue-500">Prompt régénéré :</span>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                          {prompt.regenerated_prompt}
                        </p>
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground/60 hover:text-muted-foreground">
                          Voir prompt original
                        </summary>
                        <p className="mt-1 text-muted-foreground/60 whitespace-pre-wrap break-words">
                          {prompt.prompt}
                        </p>
                      </details>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {prompt.prompt}
                    </p>
                  )}
                  <div
                    className={`absolute top-0 right-0 flex gap-0.5 transition-opacity ${
                      editingPromptIndex === index || regeneratingPromptIndex === index
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleEditPrompt(index)}
                      disabled={regeneratingPromptIndex === index}
                      title="Modifier le prompt"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setConfirmRegeneratePrompt(index)}
                      disabled={regeneratingPromptIndex === index}
                      title="Régénérer le prompt"
                    >
                      {regeneratingPromptIndex === index ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => copyToClipboard(prompt.prompt, index)}
                      title="Copier le prompt"
                    >
                      {copiedIndex === index ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => generateSinglePrompt(index)}
                  disabled={generatingPromptIndex === index}
                  className="w-full md:w-auto"
                >
                  {generatingPromptIndex === index ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      <span className="text-xs">Génération...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      <span className="text-xs">Générer prompt</span>
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Image / Video */}
            <div className="w-full md:w-[300px] space-y-2">
              {/* Video (if animated) */}
              {prompt?.videoUrl && (
                <div className="group relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                  <video
                    src={prompt.videoUrl}
                    className="w-full h-full object-contain cursor-pointer"
                    controls
                    muted
                    loop
                    onClick={() => setImagePreviewUrl(prompt.videoUrl || null)}
                  />
                  <div className="absolute top-2 left-2 bg-primary/80 text-primary-foreground text-xs px-2 py-1 rounded flex items-center gap-1">
                    <Video className="h-3 w-3" />
                    <span>Animé</span>
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onAnimateScene && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => onAnimateScene(index)}
                        disabled={generatingImageIndices.has(index) || animatingSceneIndex === index}
                        title="Réanimer la scène"
                      >
                        {animatingSceneIndex === index ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Video className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              
              {/* Image (always shown if exists) */}
              {prompt?.imageUrl ? (
                <div className={`group relative w-full overflow-hidden rounded-lg bg-muted ${prompt?.videoUrl ? 'h-20' : 'aspect-video'}`}>
                  {prompt?.videoUrl && (
                    <div className="absolute top-1 left-1 bg-muted-foreground/60 text-white text-[10px] px-1.5 py-0.5 rounded z-10">
                      Image source
                    </div>
                  )}
                  <img
                    src={prompt.imageUrl}
                    alt={`Scene ${index + 1}`}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => setImagePreviewUrl(prompt.imageUrl || null)}
                  />
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => triggerFileUpload(index)}
                      disabled={generatingImageIndices.has(index) || animatingSceneIndex === index}
                      title="Importer une image"
                    >
                      <Upload className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setConfirmRegenerateImage(index)}
                      disabled={generatingImageIndices.has(index) || animatingSceneIndex === index}
                      title="Régénérer l'image"
                    >
                      {generatingImageIndices.has(index) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </Button>
                    {/* Only show animate button if no video yet */}
                    {onAnimateScene && !prompt?.videoUrl && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => onAnimateScene(index)}
                        disabled={generatingImageIndices.has(index) || animatingSceneIndex === index}
                        title="Animer l'image (Seedance 1.5 Pro)"
                      >
                        {animatingSceneIndex === index ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Video className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                  {/* Web search button - only visible when no video */}
                  {onSearchWeb && !prompt?.videoUrl && (
                    <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 w-6 p-0 shadow-md"
                        onClick={() => onSearchWeb(index, text)}
                        disabled={generatingImageIndices.has(index)}
                        title="Chercher une image sur le web"
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ) : prompt?.prompt ? (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerFileUpload(index)}
                    disabled={generatingImageIndices.has(index)}
                    title="Importer une image"
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    <span className="text-xs">Importer</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateImage(index)}
                    disabled={generatingImageIndices.has(index)}
                    title="Générer l'image"
                  >
                    {generatingImageIndices.has(index) ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        <span className="text-xs">...</span>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="h-4 w-4 mr-1" />
                        <span className="text-xs">Générer</span>
                      </>
                    )}
                  </Button>
                  {onSearchWeb && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSearchWeb(index, text)}
                      disabled={generatingImageIndices.has(index)}
                      title="Chercher une image sur le web"
                    >
                      <Search className="h-4 w-4 mr-1" />
                      <span className="text-xs">Web</span>
                    </Button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Copy action + Regenerated badge (desktop only, mobile integrated in prompt section) */}
            <div className="hidden md:flex flex-col items-center gap-1">
              {prompt?.prompt && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => copyToClipboard(prompt.prompt, index)}
                  title="Copier le prompt"
                >
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              )}
              {/* Regenerated badge */}
              {regeneratedScenes.has(index) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-orange-500 text-white rounded-full p-1 shadow-md cursor-help">
                        <Info className="h-3.5 w-3.5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Image régénérée manuellement</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {/* QA Status badge - OK (green) or Regenerated (blue) */}
              {prompt?.qa_checked && prompt?.qa_status === 'OK' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={`${prompt?.was_regenerated ? 'bg-blue-500' : 'bg-green-500'} text-white rounded-full p-1 shadow-md cursor-help`}>
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{prompt?.was_regenerated ? 'Qualité validée après régénération' : 'Qualité validée automatiquement'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {/* QA Status badge - REJECT */}
              {prompt?.qa_checked && prompt?.qa_status === 'REJECT' && (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-red-500 text-white rounded-full p-1 shadow-md cursor-help">
                          <AlertCircle className="h-3.5 w-3.5" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="font-semibold">Image rejetée par le QA</p>
                        {prompt?.qa_explication && (
                          <p className="text-sm mt-1">{prompt.qa_explication}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {/* Regenerate button with QA prompt */}
                  {prompt?.qa_regeneration_prompt && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 bg-orange-500 hover:bg-orange-600 text-white rounded-full p-1 shadow-md"
                            onClick={() => handleRegenerateWithQAPrompt(index)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-semibold">Régénérer avec le prompt suggéré</p>
                          <p className="text-sm mt-1">Remplace le prompt actuel et régénère l'image</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </>
              )}
              {/* QA Regenerated badge - Blue badge for auto-regenerated images */}
              {prompt?.qa_regenerated === true && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-blue-500 text-white rounded-full p-1 shadow-md cursor-help">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Image régénérée automatiquement par le QA</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
