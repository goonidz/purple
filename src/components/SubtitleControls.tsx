import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface SubtitleSettings {
  enabled: boolean;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  opacity: number;
  textShadow: string;
  x: number;
  y: number;
}

interface SubtitleControlsProps {
  settings: SubtitleSettings;
  onChange: (settings: SubtitleSettings) => void;
}

export const SubtitleControls = ({ settings, onChange }: SubtitleControlsProps) => {
  return (
    <Card className="p-4 space-y-4 h-full overflow-auto">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Sous-titres</Label>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => onChange({ ...settings, enabled })}
          />
        </div>

        {settings.enabled && (
          <>
            {/* Font Size */}
            <div className="space-y-2">
              <Label>Taille (px)</Label>
              <Input
                type="number"
                min="10"
                max="60"
                value={settings.fontSize}
                onChange={(e) => onChange({ ...settings, fontSize: parseInt(e.target.value) || 18 })}
              />
            </div>

            {/* Font Family */}
            <div className="space-y-2">
              <Label>Police</Label>
              <Select
                value={settings.fontFamily}
                onValueChange={(value) => onChange({ ...settings, fontFamily: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Arial, sans-serif">Arial</SelectItem>
                  <SelectItem value="'Times New Roman', serif">Times New Roman</SelectItem>
                  <SelectItem value="'Courier New', monospace">Courier New</SelectItem>
                  <SelectItem value="Georgia, serif">Georgia</SelectItem>
                  <SelectItem value="Verdana, sans-serif">Verdana</SelectItem>
                  <SelectItem value="'Comic Sans MS', cursive">Comic Sans</SelectItem>
                  <SelectItem value="Impact, fantasy">Impact</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Text Color */}
            <div className="space-y-2">
              <Label>Couleur du texte</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={settings.color}
                  onChange={(e) => onChange({ ...settings, color: e.target.value })}
                  className="w-20 h-10"
                />
                <Input
                  type="text"
                  value={settings.color}
                  onChange={(e) => onChange({ ...settings, color: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Background Color */}
            <div className="space-y-2">
              <Label>Couleur de fond</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={settings.backgroundColor}
                  onChange={(e) => onChange({ ...settings, backgroundColor: e.target.value })}
                  className="w-20 h-10"
                />
                <Input
                  type="text"
                  value={settings.backgroundColor}
                  onChange={(e) => onChange({ ...settings, backgroundColor: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Opacity */}
            <div className="space-y-2">
              <Label>Opacité ({Math.round(settings.opacity * 100)}%)</Label>
              <Input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.opacity}
                onChange={(e) => onChange({ ...settings, opacity: parseFloat(e.target.value) })}
              />
            </div>

            {/* Text Shadow */}
            <div className="space-y-2">
              <Label>Ombre du texte</Label>
              <Input
                type="text"
                value={settings.textShadow}
                onChange={(e) => onChange({ ...settings, textShadow: e.target.value })}
                placeholder="2px 2px 4px rgba(0,0,0,0.8)"
              />
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              💡 Glissez-déposez les sous-titres sur la vidéo pour les positionner
            </p>
          </>
        )}
      </div>
    </Card>
  );
};
