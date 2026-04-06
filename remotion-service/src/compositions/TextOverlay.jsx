import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from 'remotion';

export const TextOverlay = ({
  text,
  fontSize = 80,
  color = '#ffffff',
  backgroundColor = '#000000',
  backgroundImage = null,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 15, stiffness: 100 } });

  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {backgroundImage && (
        <Img
          src={backgroundImage}
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute' }}
        />
      )}
      <AbsoluteFill
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
        }}
      >
        <span
          style={{
            fontSize,
            color,
            fontWeight: 'bold',
            fontFamily: 'Arial, sans-serif',
            textAlign: 'center',
            transform: `scale(${scale})`,
            textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
            maxWidth: '80%',
            lineHeight: 1.2,
          }}
        >
          {text}
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
