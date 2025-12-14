import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  FileText,
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

  return (
    <>
      {/* Mobile Card View */}
      <div className="block md:hidden space-y-3">
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
            <Card key={index} className="p-3 space-y-3">
              {/* Header with number and timing */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg text-primary">#{index + 1}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimecode(startTime)} - {formatTimecode(endTime)}
                  </span>
                </div>
                <span className="text-xs bg-muted px-2 py-1 rounded">
                  {(endTime - startTime).toFixed(1)}s
                </span>
              </div>

              {/* Image preview if exists */}
              {prompt?.imageUrl && (
                <div className="relative aspect-video w-full overflow-hidden rounded-lg">
                  <img
                    src={prompt.imageUrl}
                    alt={`Scene ${index + 1}`}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setImagePreviewUrl(prompt.imageUrl || null)}
                  />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) uploadManualImage(file, index);
                        };
                        input.click();
                      }}
                      disabled={generatingImageIndex === index}
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setConfirmRegenerateImage(index)}
                      disabled={generatingImageIndex === index}
                    >
                      {generatingImageIndex === index ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Scene text */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Texte
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => handleEditScene(index)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-sm line-clamp-3">{text}</p>
              </div>

              {/* Prompt */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Prompt
                  </span>
                  {prompt?.prompt && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => handleEditPrompt(index)}
                        disabled={regeneratingPromptIndex === index}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setConfirmRegeneratePrompt(index)}
                        disabled={regeneratingPromptIndex === index}
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
                      >
                        {copiedIndex === index ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
                {prompt?.prompt ? (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {prompt.prompt}
                  </p>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateSinglePrompt(index)}
                    disabled={generatingPromptIndex === index}
                    className="w-full"
                  >
                    {generatingPromptIndex === index ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Génération...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Générer le prompt
                      </>
                    )}
                  </Button>
                )}
              </div>

              {/* Image actions if no image yet but has prompt */}
              {!prompt?.imageUrl && prompt?.prompt && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) uploadManualImage(file, index);
                      };
                      input.click();
                    }}
                    disabled={generatingImageIndex === index}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Importer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => generateImage(index)}
                    disabled={generatingImageIndex === index}
                  >
                    {generatingImageIndex === index ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Génération...
                      </>
                    ) : (
                      <>
                        <ImageIcon className="h-4 w-4 mr-2" />
                        Générer
                      </>
                    )}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Timing</TableHead>
              <TableHead>Durée</TableHead>
              <TableHead>Texte de la scène</TableHead>
              <TableHead>Prompt</TableHead>
              <TableHead className="w-32">Image</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
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
                <TableRow key={index}>
                  <TableCell className="font-semibold">{index + 1}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatTimecode(startTime)} - {formatTimecode(endTime)}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {(endTime - startTime).toFixed(1)}s
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="group relative">
                      <p className="text-sm line-clamp-3">{text}</p>
                      <div
                        className={`absolute top-0 right-0 flex gap-1 transition-opacity rounded p-1 ${
                          editingSceneIndex === index
                            ? "opacity-100 bg-background/80 backdrop-blur-sm"
                            : "opacity-0 group-hover:opacity-100 group-hover:bg-background/80 group-hover:backdrop-blur-sm"
                        }`}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditScene(index)}
                          title="Modifier le texte"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md">
                    {prompt ? (
                      <div className="group relative">
                        <p className="text-sm">{prompt.prompt}</p>
                        <div
                          className={`absolute top-0 right-0 flex gap-1 transition-opacity rounded p-1 ${
                            editingPromptIndex === index ||
                            regeneratingPromptIndex === index
                              ? "opacity-100 bg-background/80 backdrop-blur-sm"
                              : "opacity-0 group-hover:opacity-100 group-hover:bg-background/80 group-hover:backdrop-blur-sm"
                          }`}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditPrompt(index)}
                            disabled={regeneratingPromptIndex === index}
                            title="Modifier le prompt"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
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
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => generateSinglePrompt(index)}
                        disabled={generatingPromptIndex === index}
                        title="Générer le prompt de cette scène"
                      >
                        {generatingPromptIndex === index ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            <span className="text-xs">Génération...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-1" />
                            <span className="text-xs">Générer</span>
                          </>
                        )}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {prompt?.imageUrl ? (
                      <div className="group relative">
                        <img
                          src={prompt.imageUrl}
                          alt={`Scene ${index + 1}`}
                          className="w-24 h-24 object-cover rounded cursor-pointer hover:opacity-80 transition"
                          onClick={() =>
                            setImagePreviewUrl(prompt.imageUrl || null)
                          }
                          title="Cliquer pour agrandir"
                        />
                        <div className="absolute top-1 right-1 flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="bg-background/80 hover:bg-background opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept = "image/*";
                              input.onchange = (e) => {
                                const file = (e.target as HTMLInputElement)
                                  .files?.[0];
                                if (file) uploadManualImage(file, index);
                              };
                              input.click();
                            }}
                            disabled={generatingImageIndex === index}
                            title="Importer une image"
                          >
                            <Upload className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`bg-background/80 hover:bg-background transition-all ${
                              generatingImageIndex === index
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100"
                            }`}
                            onClick={() => setConfirmRegenerateImage(index)}
                            disabled={generatingImageIndex === index}
                            title="Régénérer l'image"
                          >
                            {generatingImageIndex === index ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : prompt ? (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = "image/*";
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement)
                                .files?.[0];
                              if (file) uploadManualImage(file, index);
                            };
                            input.click();
                          }}
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
                          title="Générer l'image de cette scène"
                        >
                          {generatingImageIndex === index ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              <span className="text-xs">Génération...</span>
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
                  </TableCell>
                  <TableCell>
                    {prompt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(prompt.prompt, index)}
                      >
                        {copiedIndex === index ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
