// Scene segmentation algorithm
// Parses transcript segments into scenes based on duration configuration

export interface TranscriptSegment {
  text: string;
  start_time: number;
  end_time: number;
  speaker?: { id: string; name: string };
}

export interface TranscriptData {
  segments: TranscriptSegment[];
  language_code?: string;
}

export interface Scene {
  text: string;
  startTime: number;
  endTime: number;
}

export const parseTranscriptToScenes = (
  transcriptData: TranscriptData, 
  duration0to1: number,
  duration1to3: number, 
  duration3plus: number,
  rangeEnd1: number = 60,
  rangeEnd2: number = 180,
  preferSentenceBoundaries: boolean = true
): Scene[] => {
  const scenes: Scene[] = [];
  let currentScene: Scene = { text: "", startTime: 0, endTime: 0 };
  
  const getMaxDuration = (timestamp: number): number => {
    if (timestamp < rangeEnd1) return duration0to1;
    if (timestamp < rangeEnd2) return duration1to3;
    return duration3plus;
  };
  
  // Check if text ends with sentence-ending punctuation
  const endsWithSentence = (text: string): boolean => {
    const trimmed = text.trim();
    return /[.!?…]$/.test(trimmed) || /[.!?…]["']$/.test(trimmed);
  };
  
  // Tolerance factor: allow up to 50% extra duration to find a sentence boundary
  const TOLERANCE_FACTOR = 1.5;
  
  transcriptData.segments.forEach((segment, index) => {
    // Start new scene if first segment or if previous scene was just pushed
    if (index === 0 || currentScene.text === "") {
      currentScene = {
        text: segment.text,
        startTime: segment.start_time,
        endTime: segment.end_time
      };
    } else {
      const potentialDuration = segment.end_time - currentScene.startTime;
      const maxDuration = getMaxDuration(currentScene.startTime);
      
      if (preferSentenceBoundaries) {
        // Sentence-aware mode: allow tolerance to find sentence boundaries
        const maxWithTolerance = maxDuration * TOLERANCE_FACTOR;
        const currentEndsWithSentence = endsWithSentence(currentScene.text);
        
        if (potentialDuration > maxDuration) {
          if (currentEndsWithSentence) {
            if (currentScene.text.trim()) {
              scenes.push({ ...currentScene });
            }
            currentScene = {
              text: segment.text,
              startTime: segment.start_time,
              endTime: segment.end_time
            };
          } else if (potentialDuration <= maxWithTolerance) {
            currentScene.text += " " + segment.text;
            currentScene.endTime = segment.end_time;
            
            if (endsWithSentence(currentScene.text)) {
              if (currentScene.text.trim()) {
                scenes.push({ ...currentScene });
              }
              // Reset to empty - next iteration will initialize new scene
              currentScene = { text: "", startTime: 0, endTime: 0 };
            }
          } else {
            if (currentScene.text.trim()) {
              scenes.push({ ...currentScene });
            }
            currentScene = {
              text: segment.text,
              startTime: segment.start_time,
              endTime: segment.end_time
            };
          }
        } else {
          currentScene.text += " " + segment.text;
          currentScene.endTime = segment.end_time;
        }
      } else {
        // Original mode: strict duration-based cutting
        if (potentialDuration > maxDuration) {
          if (currentScene.text.trim()) {
            scenes.push({ ...currentScene });
          }
          currentScene = {
            text: segment.text,
            startTime: segment.start_time,
            endTime: segment.end_time
          };
        } else {
          currentScene.text += " " + segment.text;
          currentScene.endTime = segment.end_time;
        }
      }
    }
  });
  
  if (currentScene.text.trim()) {
    scenes.push(currentScene);
  }
  
  return scenes;
};
