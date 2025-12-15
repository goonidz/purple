import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { DurationRange, normalizeRanges } from "@/lib/durationRanges";

interface DurationRangesEditorProps {
  ranges: DurationRange[];
  onChange: (ranges: DurationRange[]) => void;
  maxEndValue?: number;
}

export const DurationRangesEditor = ({
  ranges,
  onChange,
  maxEndValue = 600,
}: DurationRangesEditorProps) => {
  const handleAddRange = () => {
    // Find a sensible default for new range
    const lastFiniteRange = ranges.filter(r => r.endSeconds !== null).pop();
    const lastEnd = lastFiniteRange?.endSeconds || 60;
    const newEnd = Math.min(lastEnd + 60, maxEndValue);
    
    // Insert new range before the last (infinite) one
    const newRanges = [...ranges];
    const infiniteIndex = newRanges.findIndex(r => r.endSeconds === null);
    
    if (infiniteIndex >= 0) {
      newRanges.splice(infiniteIndex, 0, { endSeconds: newEnd, sceneDuration: 6 });
    } else {
      newRanges.push({ endSeconds: newEnd, sceneDuration: 6 });
    }
    
    onChange(normalizeRanges(newRanges));
  };

  const handleRemoveRange = (index: number) => {
    if (ranges.length <= 2) return; // Keep at least 2 ranges
    const newRanges = ranges.filter((_, i) => i !== index);
    onChange(normalizeRanges(newRanges));
  };

  const handleUpdateRange = (index: number, field: "endSeconds" | "sceneDuration", value: number | null) => {
    const newRanges = [...ranges];
    newRanges[index] = { ...newRanges[index], [field]: value };
    onChange(normalizeRanges(newRanges));
  };

  const getRangeLabel = (index: number): string => {
    if (index === 0) {
      return `0 à ${ranges[0].endSeconds}s`;
    }
    const prevEnd = ranges[index - 1].endSeconds;
    const currentEnd = ranges[index].endSeconds;
    if (currentEnd === null) {
      return `${prevEnd}s et plus`;
    }
    return `${prevEnd}s à ${currentEnd}s`;
  };

  return (
    <div className="space-y-3">
      {ranges.map((range, index) => {
        const isLast = range.endSeconds === null;
        const prevEnd = index > 0 ? ranges[index - 1].endSeconds : 0;
        
        return (
          <div key={index} className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-sm font-medium mb-1 block">
                Plage {index + 1} : {getRangeLabel(index)}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Fin de plage (sec)</Label>
                  {isLast ? (
                    <Input disabled value="∞" className="bg-muted" />
                  ) : (
                    <Input
                      type="number"
                      min={(prevEnd || 0) + 1}
                      max={maxEndValue}
                      value={range.endSeconds || ""}
                      onChange={(e) => handleUpdateRange(index, "endSeconds", parseInt(e.target.value) || 1)}
                    />
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="60"
                    value={range.sceneDuration}
                    onChange={(e) => handleUpdateRange(index, "sceneDuration", parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
            </div>
            {ranges.length > 2 && !isLast && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveRange(index)}
                className="h-9 w-9 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
      
      <Button
        variant="outline"
        size="sm"
        onClick={handleAddRange}
        className="w-full mt-2"
      >
        <Plus className="h-4 w-4 mr-2" />
        Ajouter une plage
      </Button>
    </div>
  );
};
