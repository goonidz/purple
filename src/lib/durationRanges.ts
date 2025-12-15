// Duration ranges type definition and helpers

export interface DurationRange {
  endSeconds: number | null; // null means "and above" (last range)
  sceneDuration: number;
}

// Default ranges for long-form content
export const DEFAULT_DURATION_RANGES: DurationRange[] = [
  { endSeconds: 60, sceneDuration: 4 },
  { endSeconds: 180, sceneDuration: 6 },
  { endSeconds: null, sceneDuration: 8 },
];

// Default ranges for short-form content
export const SHORT_FORM_DURATION_RANGES: DurationRange[] = [
  { endSeconds: 5, sceneDuration: 2 },
  { endSeconds: 15, sceneDuration: 4 },
  { endSeconds: null, sceneDuration: 6 },
];

// Convert legacy format (individual columns) to new format
export const convertLegacyToRanges = (
  sceneDuration0to1: number,
  sceneDuration1to3: number,
  sceneDuration3plus: number,
  rangeEnd1: number,
  rangeEnd2: number
): DurationRange[] => {
  return [
    { endSeconds: rangeEnd1, sceneDuration: sceneDuration0to1 },
    { endSeconds: rangeEnd2, sceneDuration: sceneDuration1to3 },
    { endSeconds: null, sceneDuration: sceneDuration3plus },
  ];
};

// Get scene duration for a given timestamp using ranges
export const getSceneDurationForTimestamp = (
  timestamp: number,
  ranges: DurationRange[]
): number => {
  for (const range of ranges) {
    if (range.endSeconds === null || timestamp < range.endSeconds) {
      return range.sceneDuration;
    }
  }
  // Fallback to last range's duration
  return ranges[ranges.length - 1]?.sceneDuration || 8;
};

// Validate and sort ranges
export const normalizeRanges = (ranges: DurationRange[]): DurationRange[] => {
  // Separate finite and infinite ranges
  const finiteRanges = ranges.filter(r => r.endSeconds !== null);
  const infiniteRange = ranges.find(r => r.endSeconds === null);
  
  // Sort finite ranges by endSeconds
  finiteRanges.sort((a, b) => (a.endSeconds || 0) - (b.endSeconds || 0));
  
  // Ensure there's always an infinite range at the end
  if (infiniteRange) {
    return [...finiteRanges, infiniteRange];
  } else if (finiteRanges.length > 0) {
    // Convert the last range to infinite
    const lastRange = finiteRanges.pop()!;
    return [...finiteRanges, { ...lastRange, endSeconds: null }];
  }
  
  return DEFAULT_DURATION_RANGES;
};
