import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
} from "lucide-react";

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
}

interface SceneGridProps {
  scenes: Scene[];
  generatedPrompts: GeneratedPrompt[];
  formatTimecode: (seconds: number) => string;
  editingSceneIndex: number | null;
  editingPromptIndex: number | null;
  regeneratingPromptIndex: number | null;
  generatingPromptIndex: number | null;
  generatingImageIndex: number | null;
  copiedIndex: number | null;
  handleEditScene: (index: number) => void;
  handleEditPrompt: (index: number) => void;
  setConfirmRegeneratePrompt: (index: number | null) => void;
  setConfirmRegenerateImage: (index: number | null) => void;
  generateSinglePrompt: (index: number) => void;
  generateImage: (index: number) => void;
  uploadManualImage: (file: File, index: number) => void;
  copyToClipboard: (text: string | undefined, index: number) => void;
  setImagePreviewUrl: (url: string | null) => void;
}

export function SceneGrid({
  scenes,
  generatedPrompts,
  formatTimecode,
  editingSceneIndex,
  editingPromptIndex,
  regeneratingPromptIndex,
  generatingPromptIndex,
  generatingImageIndex,
  copiedIndex,
  handleEditScene,
  handleEditPrompt,
  setConfirmRegeneratePrompt,
  setConfirmRegenerateImage,
  generateSinglePrompt,
  generateImage,
  uploadManualImage,
  copyToClipboard,
  setImagePreviewUrl,
}: SceneGridProps) {
  const items = scenes.length > 0 ? scenes : generatedPrompts;

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
      <div className="hidden md:grid md:grid-cols-[auto_1fr_1fr_300px_auto] md:items-center gap-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
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
            className="p-4 grid gap-4 grid-cols-1 md:grid-cols-[auto_1fr_1fr_300px_auto] md:items-start"
          >
            {/* Header: Number + Timing (always visible) */}
            <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-1">
              <span className="font-bold text-lg text-primary">#{index + 1}</span>
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
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {prompt.prompt}
                  </p>
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

            {/* Image */}
            <div className="w-full md:w-[300px]">
              {prompt?.imageUrl ? (
                <div className="group relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                  <img
                    src={prompt.imageUrl}
                    alt={`Scene ${index + 1}`}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => setImagePreviewUrl(prompt.imageUrl || null)}
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => triggerFileUpload(index)}
                      disabled={generatingImageIndex === index}
                      title="Importer une image"
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setConfirmRegenerateImage(index)}
                      disabled={generatingImageIndex === index}
                      title="Régénérer l'image"
                    >
                      {generatingImageIndex === index ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : prompt?.prompt ? (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerFileUpload(index)}
                    disabled={generatingImageIndex === index}
                    title="Importer une image"
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    <span className="text-xs">Importer</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateImage(index)}
                    disabled={generatingImageIndex === index}
                    title="Générer l'image"
                  >
                    {generatingImageIndex === index ? (
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
                </div>
              ) : null}
            </div>

            {/* Copy action (desktop only, mobile integrated in prompt section) */}
            <div className="hidden md:flex items-start">
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
            </div>
          </Card>
        );
      })}
    </div>
  );
}
