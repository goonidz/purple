import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { DurationRange, normalizeRanges } from "@/lib/durationRanges";
import { useState, useEffect } from "react";

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
  // Local state for input values to allow free typing
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  
  // Sync input values when ranges change externally
  useEffect(() => {
    const newInputValues: Record<string, string> = {};
    ranges.forEach((range, index) => {
      if (range.endSeconds !== null) {
        newInputValues[`end-${index}`] = range.endSeconds.toString();
      }
      newInputValues[`duration-${index}`] = range.sceneDuration.toString();
    });
    setInputValues(newInputValues);
  }, [ranges]);

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
                    <Textarea disabled value="∞" className="bg-muted h-10 min-h-10 resize-none px-3 py-2 text-base md:text-sm" readOnly />
                  ) : (
                    <Textarea
                      value={inputValues[`end-${index}`] || range.endSeconds?.toString() || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Clean input: only allow numbers and one decimal point
                        const numericValue = value.replace(/[^0-9.]/g, '');
                        const parts = numericValue.split('.');
                        const cleanedValue = parts.length > 2 
                          ? parts[0] + '.' + parts.slice(1).join('')
                          : numericValue;
                        
                        // Update local state immediately for free typing
                        setInputValues(prev => ({ ...prev, [`end-${index}`]: cleanedValue }));
                        
                        // Parse and update parent state if valid
                        if (cleanedValue === '' || cleanedValue === '.') {
                          return; // Allow typing, validate on blur
                        }
                        
                        const numValue = parseFloat(cleanedValue);
                        if (!isNaN(numValue) && numValue >= 0) {
                          const prevEnd = index > 0 ? ranges[index - 1].endSeconds : 0;
                          handleUpdateRange(index, "endSeconds", Math.max((prevEnd || 0) + 0.1, numValue));
                        }
                      }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        const numericValue = value.replace(/[^0-9.]/g, '');
                        const numValue = parseFloat(numericValue);
                        
                        if (isNaN(numValue) || numValue < 0) {
                          // Reset to previous value if invalid
                          const currentValue = ranges[index].endSeconds;
                          setInputValues(prev => ({ ...prev, [`end-${index}`]: currentValue?.toString() || "" }));
                          handleUpdateRange(index, "endSeconds", currentValue);
                        } else {
                          const prevEnd = index > 0 ? ranges[index - 1].endSeconds : 0;
                          const finalValue = Math.max((prevEnd || 0) + 0.1, numValue);
                          setInputValues(prev => ({ ...prev, [`end-${index}`]: finalValue.toString() }));
                          handleUpdateRange(index, "endSeconds", finalValue);
                        }
                      }}
                      onKeyDown={(e) => {
                        // Allow: backspace, delete, tab, escape, enter, decimal point
                        if ([8, 9, 27, 13, 46, 110, 190].indexOf(e.keyCode) !== -1 ||
                          // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                          (e.keyCode === 65 && e.ctrlKey === true) ||
                          (e.keyCode === 67 && e.ctrlKey === true) ||
                          (e.keyCode === 86 && e.ctrlKey === true) ||
                          (e.keyCode === 88 && e.ctrlKey === true) ||
                          // Allow: home, end, left, right
                          (e.keyCode >= 35 && e.keyCode <= 39)) {
                          return;
                        }
                        // Ensure that it is a number or decimal point and stop the keypress
                        if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105) && e.keyCode !== 190 && e.keyCode !== 110) {
                          e.preventDefault();
                        }
                      }}
                      className="h-10 min-h-10 resize-none px-3 py-2 text-base md:text-sm"
                      placeholder="0"
                    />
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Durée de scène (sec)</Label>
                  <Textarea
                    value={inputValues[`duration-${index}`] || range.sceneDuration.toString()}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Clean input: only allow numbers
                      const numericValue = value.replace(/[^0-9]/g, '');
                      
                      // Update local state immediately for free typing
                      setInputValues(prev => ({ ...prev, [`duration-${index}`]: numericValue }));
                      
                      // Parse and update parent state if valid
                      if (numericValue === '') {
                        return; // Allow typing, validate on blur
                      }
                      
                      const numValue = parseInt(numericValue, 10);
                      if (!isNaN(numValue) && numValue >= 1) {
                        handleUpdateRange(index, "sceneDuration", numValue);
                      }
                    }}
                    onBlur={(e) => {
                      const value = e.target.value;
                      const numericValue = value.replace(/[^0-9]/g, '');
                      const numValue = parseInt(numericValue, 10);
                      
                      if (isNaN(numValue) || numValue < 1) {
                        // Reset to previous value if invalid
                        const currentValue = ranges[index].sceneDuration;
                        setInputValues(prev => ({ ...prev, [`duration-${index}`]: currentValue.toString() }));
                        handleUpdateRange(index, "sceneDuration", currentValue);
                      } else {
                        setInputValues(prev => ({ ...prev, [`duration-${index}`]: numValue.toString() }));
                        handleUpdateRange(index, "sceneDuration", numValue);
                      }
                    }}
                    onKeyDown={(e) => {
                      // Allow: backspace, delete, tab, escape, enter
                      if ([8, 9, 27, 13, 46].indexOf(e.keyCode) !== -1 ||
                        // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                        (e.keyCode === 65 && e.ctrlKey === true) ||
                        (e.keyCode === 67 && e.ctrlKey === true) ||
                        (e.keyCode === 86 && e.ctrlKey === true) ||
                        (e.keyCode === 88 && e.ctrlKey === true) ||
                        // Allow: home, end, left, right
                        (e.keyCode >= 35 && e.keyCode <= 39)) {
                        return;
                      }
                      // Ensure that it is a number and stop the keypress
                      if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
                        e.preventDefault();
                      }
                    }}
                    className="h-10 min-h-10 resize-none px-3 py-2 text-base md:text-sm"
                    placeholder="1"
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
