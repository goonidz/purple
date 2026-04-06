import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from 'remotion';

export const KenBurns = ({ scenes, effectIntensity = 0.05 }) => {
  const { durationInFrames } = useVideoConfig();

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
      {scenes.map((scene, index) => (
        <Sequence key={index} from={index * sceneDuration} durationInFrames={sceneDuration}>
          <KenBurnsSlide
            imageUrl={scene.imageUrl}
            direction={scene.direction || (index % 2 === 0 ? 'zoom-in' : 'zoom-out')}
            intensity={effectIntensity}
            sceneDuration={sceneDuration}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const KenBurnsSlide = ({ imageUrl, direction, intensity, sceneDuration }) => {
  const frame = useCurrentFrame();

  const progress = frame / sceneDuration;

  let scale, translateX, translateY;

  switch (direction) {
    case 'zoom-in':
      scale = interpolate(progress, [0, 1], [1, 1 + intensity * 4]);
      translateX = interpolate(progress, [0, 1], [0, -2]);
      translateY = interpolate(progress, [0, 1], [0, -1]);
      break;
    case 'zoom-out':
      scale = interpolate(progress, [0, 1], [1 + intensity * 4, 1]);
      translateX = interpolate(progress, [0, 1], [-2, 0]);
      translateY = interpolate(progress, [0, 1], [-1, 0]);
      break;
    case 'pan-left':
      scale = 1 + intensity * 2;
      translateX = interpolate(progress, [0, 1], [3, -3]);
      translateY = 0;
      break;
    case 'pan-right':
      scale = 1 + intensity * 2;
      translateX = interpolate(progress, [0, 1], [-3, 3]);
      translateY = 0;
      break;
    default:
      scale = interpolate(progress, [0, 1], [1, 1 + intensity * 4]);
      translateX = 0;
      translateY = 0;
  }

  const opacity = interpolate(frame, [0, 10, sceneDuration - 10, sceneDuration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={imageUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
        }}
      />
    </AbsoluteFill>
  );
};
