import { Card } from "@/components/ui/card";
import { TitleGenerator } from "@/components/TitleGenerator";
import { DescriptionGenerator } from "@/components/DescriptionGenerator";
import { TagGenerator } from "@/components/TagGenerator";
import { Separator } from "@/components/ui/separator";

interface SceneInfo {
  text: string;
  startTime: number;
  endTime: number;
}

interface YouTubeMetadataTabProps {
  projectId: string;
  videoScript: string;
  videoTitle: string;
  scenes: SceneInfo[];
}

export const YouTubeMetadataTab = ({ 
  projectId, 
  videoScript, 
  videoTitle, 
  scenes 
}: YouTubeMetadataTabProps) => {
  return (
    <div className="space-y-6 py-4">
      {/* Section Titre */}
      <Card className="p-6">
        <div className="mb-4">
          <h2 className="text-2xl font-semibold">Titre de la vidéo</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Générez des titres accrocheurs pour votre vidéo YouTube
          </p>
        </div>
        <Separator className="mb-6" />
        <TitleGenerator
          projectId={projectId}
          videoScript={videoScript}
        />
      </Card>

      {/* Section Description */}
      <Card className="p-6">
        <div className="mb-4">
          <h2 className="text-2xl font-semibold">Description</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Créez une description détaillée avec des chapitres pour votre vidéo
          </p>
        </div>
        <Separator className="mb-6" />
        <DescriptionGenerator
          projectId={projectId}
          videoScript={videoScript}
          scenes={scenes}
        />
      </Card>

      {/* Section Tags */}
      <Card className="p-6">
        <div className="mb-4">
          <h2 className="text-2xl font-semibold">Tags</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Générez des tags pertinents pour améliorer la découvrabilité de votre vidéo
          </p>
        </div>
        <Separator className="mb-6" />
        <TagGenerator
          projectId={projectId}
          videoScript={videoScript}
          videoTitle={videoTitle}
        />
      </Card>
    </div>
  );
};
