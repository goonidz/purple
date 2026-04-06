import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from 'remotion';

export const Slideshow = ({ scenes, transitionDuration = 15 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (!scenes || scenes.length === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#fff', fontSize: 48 }}>No scenes provided</span>
      </AbsoluteFill>
    );
  }

  const sceneDuration = Math.floor(durationInFrames / scenes.length);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {scenes.map((scene, index) => {
        const startFrame = index * sceneDuration;

        return (
          <Sequence key={index} from={startFrame} durationInFrames={sceneDuration}>
            <SceneSlide
              imageUrl={scene.imageUrl}
              transitionDuration={transitionDuration}
              sceneDuration={sceneDuration}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SceneSlide = ({ imageUrl, transitionDuration, sceneDuration }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, transitionDuration, sceneDuration - transitionDuration, sceneDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={imageUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
};
