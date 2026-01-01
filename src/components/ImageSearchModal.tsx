import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ExternalLink, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SearchImage {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  width: number;
  height: number;
}

interface ImageSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sceneIndex: number;
  sceneText: string;
  summary?: string | null;
  projectName?: string | null;
  onSelectImage: (imageUrl: string) => void;
}

// Store search results in localStorage keyed by scene index
const STORAGE_KEY_PREFIX = 'image_search_results_';

export default function ImageSearchModal({
  open,
  onOpenChange,
  sceneIndex,
  sceneText,
  summary,
  projectName,
  onSelectImage,
}: ImageSearchModalProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [images, setImages] = useState<SearchImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Load previous search results when modal opens
  useEffect(() => {
    if (open) {
      const storageKey = `${STORAGE_KEY_PREFIX}${sceneIndex}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const savedData = JSON.parse(saved);
          if (savedData.images && savedData.images.length > 0) {
            setImages(savedData.images);
            setSearchQuery(savedData.query || "");
            setHasSearched(true);
            console.log(`[ImageSearchModal] Loaded ${savedData.images.length} previous results for scene ${sceneIndex}`);
          }
        } catch (e) {
          console.error("Error loading saved search results:", e);
        }
      }
    }
  }, [open, sceneIndex]);

  const handleSearch = async () => {
    if (!sceneText.trim()) {
      toast.error("Le texte de la scène est vide");
      return;
    }

    setIsSearching(true);
    setImages([]);
    setSelectedImage(null);
    setHasSearched(false);

    try {
      const { data, error } = await supabase.functions.invoke('search-images-brave', {
        body: { sceneText, sceneIndex, summary, projectName }
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la recherche");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setSearchQuery(data.query || "");
      setImages(data.images || []);
      setHasSearched(true);

      // Save results to localStorage for this scene
      const storageKey = `${STORAGE_KEY_PREFIX}${sceneIndex}`;
      localStorage.setItem(storageKey, JSON.stringify({
        query: data.query || "",
        images: data.images || [],
        timestamp: Date.now()
      }));

      if (data.images?.length === 0) {
        toast.info("Aucune image trouvée pour cette scène");
      }
    } catch (error: any) {
      console.error("Search error:", error);
      toast.error(error.message || "Erreur lors de la recherche d'images");
    } finally {
      setIsSearching(false);
    }
  };

  const handleConfirm = () => {
    if (selectedImage) {
      onSelectImage(selectedImage);
      onOpenChange(false);
      toast.success("Image sélectionnée !");
      // Reset state
      setImages([]);
      setSelectedImage(null);
      setHasSearched(false);
      setSearchQuery("");
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Don't reset images - keep them for next time
    setSelectedImage(null);
    // Keep hasSearched and searchQuery so results show on next open
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Rechercher une image sur le web
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Scene text preview */}
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm text-muted-foreground mb-1">Scène {sceneIndex + 1}</p>
            <p className="text-sm line-clamp-3">{sceneText}</p>
          </div>

          {/* Search button - show if no results OR allow new search */}
          {(!hasSearched || images.length === 0) && (
            <Button
              onClick={handleSearch}
              disabled={isSearching}
              className="w-full"
              size="lg"
            >
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recherche en cours...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  {hasSearched ? "Nouvelle recherche" : "Rechercher des images"}
                </>
              )}
            </Button>
          )}

          {/* Search query display */}
          {searchQuery && (
            <div className="text-sm text-muted-foreground">
              Recherche : <span className="font-medium text-foreground">"{searchQuery}"</span>
            </div>
          )}

          {/* Loading state */}
          {isSearching && (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
                <p className="text-muted-foreground">Recherche d'images en cours...</p>
              </div>
            </div>
          )}

          {/* Results grid */}
          {!isSearching && images.length > 0 && (
            <div className="flex-1 overflow-y-auto">
              <div className="text-sm text-muted-foreground mb-2">
                {images.length} image{images.length > 1 ? 's' : ''} trouvée{images.length > 1 ? 's' : ''}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {images.map((image, idx) => (
                  <div
                    key={idx}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImage === image.url
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-transparent hover:border-muted-foreground/30"
                    }`}
                    onClick={() => setSelectedImage(image.url)}
                  >
                    <div className="aspect-video bg-muted">
                      <img
                        src={image.thumbnail || image.url}
                        alt={image.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          // Fallback to main URL if thumbnail fails
                          const target = e.target as HTMLImageElement;
                          if (target.src !== image.url) {
                            target.src = image.url;
                          }
                        }}
                      />
                    </div>
                    
                    {/* Selection indicator */}
                    {selectedImage === image.url && (
                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                        <Check className="h-4 w-4" />
                      </div>
                    )}

                    {/* Hover overlay with info */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end">
                      <p className="text-white text-xs line-clamp-2 mb-1">{image.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-white/70 text-xs">{image.width}x{image.height}</span>
                        <a
                          href={image.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-white/70 hover:text-white"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No results */}
          {!isSearching && hasSearched && images.length === 0 && (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center">
                <Search className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                <p className="text-muted-foreground">Aucune image trouvée</p>
                <Button
                  variant="outline"
                  onClick={handleSearch}
                  className="mt-4"
                >
                  Réessayer
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer with actions */}
        {hasSearched && images.length > 0 && (
          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="outline" onClick={handleSearch} disabled={isSearching}>
              <Search className="mr-2 h-4 w-4" />
              Nouvelle recherche
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button onClick={handleConfirm} disabled={!selectedImage}>
                <Check className="mr-2 h-4 w-4" />
                Utiliser cette image
              </Button>
            </div>
          </div>
        )}
        
        {/* Footer when no results but has searched */}
        {hasSearched && images.length === 0 && (
          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              Fermer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
