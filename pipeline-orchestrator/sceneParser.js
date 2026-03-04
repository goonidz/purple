// Port of src/lib/sceneParser.ts + src/lib/durationRanges.ts

const DEFAULT_DURATION_RANGES = [
  { endSeconds: 60, sceneDuration: 4 },
  { endSeconds: 180, sceneDuration: 6 },
  { endSeconds: null, sceneDuration: 8 },
];

function getSceneDurationForTimestamp(timestamp, ranges) {
  for (const range of ranges) {
    if (range.endSeconds === null || timestamp < range.endSeconds) {
      return range.sceneDuration;
    }
  }
  return ranges[ranges.length - 1]?.sceneDuration || 8;
}

function parseTranscriptToScenes(transcriptData, durationRanges, preferSentenceBoundaries = true) {
  const scenes = [];
  let currentScene = { text: '', startTime: 0, endTime: 0 };

  const ranges = Array.isArray(durationRanges) && durationRanges.length > 0
    ? durationRanges
    : DEFAULT_DURATION_RANGES;

  const getMaxDuration = (timestamp) => getSceneDurationForTimestamp(timestamp, ranges);

  const endsWithSentence = (text) => {
    const trimmed = text.trim();
    return /[.!?…]$/.test(trimmed) || /[.!?…]["']$/.test(trimmed);
  };

  const TOLERANCE_FACTOR = 1.5;

  const segments = transcriptData?.segments || [];

  segments.forEach((segment, index) => {
    if (index === 0 || currentScene.text === '') {
      currentScene = {
        text: segment.text,
        startTime: segment.start_time,
        endTime: segment.end_time,
      };
    } else {
      const potentialDuration = segment.end_time - currentScene.startTime;
      const maxDuration = getMaxDuration(currentScene.startTime);

      if (preferSentenceBoundaries) {
        const maxWithTolerance = maxDuration * TOLERANCE_FACTOR;
        const currentEndsWithSentence = endsWithSentence(currentScene.text);

        if (potentialDuration > maxDuration) {
          if (currentEndsWithSentence) {
            if (currentScene.text.trim()) scenes.push({ ...currentScene });
            currentScene = { text: segment.text, startTime: segment.start_time, endTime: segment.end_time };
          } else if (potentialDuration <= maxWithTolerance) {
            currentScene.text += ' ' + segment.text;
            currentScene.endTime = segment.end_time;
            if (endsWithSentence(currentScene.text)) {
              if (currentScene.text.trim()) scenes.push({ ...currentScene });
              currentScene = { text: '', startTime: 0, endTime: 0 };
            }
          } else {
            if (currentScene.text.trim()) scenes.push({ ...currentScene });
            currentScene = { text: segment.text, startTime: segment.start_time, endTime: segment.end_time };
          }
        } else {
          currentScene.text += ' ' + segment.text;
          currentScene.endTime = segment.end_time;
        }
      } else {
        if (potentialDuration > maxDuration) {
          if (currentScene.text.trim()) scenes.push({ ...currentScene });
          currentScene = { text: segment.text, startTime: segment.start_time, endTime: segment.end_time };
        } else {
          currentScene.text += ' ' + segment.text;
          currentScene.endTime = segment.end_time;
        }
      }
    }
  });

  if (currentScene.text.trim()) {
    scenes.push(currentScene);
  }

  return scenes;
}

module.exports = { parseTranscriptToScenes, DEFAULT_DURATION_RANGES, getSceneDurationForTimestamp };
