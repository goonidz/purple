import React from 'react';
import { Composition } from 'remotion';
import { Slideshow } from './compositions/Slideshow.jsx';
import { TextOverlay } from './compositions/TextOverlay.jsx';
import { KenBurns } from './compositions/KenBurns.jsx';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Slideshow"
        component={Slideshow}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          scenes: [],
          transitionDuration: 15,
        }}
      />
      <Composition
        id="TextOverlay"
        component={TextOverlay}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          text: 'Hello World',
          fontSize: 80,
          color: '#ffffff',
          backgroundColor: '#000000',
          backgroundImage: null,
        }}
      />
      <Composition
        id="KenBurns"
        component={KenBurns}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          scenes: [],
          effectIntensity: 0.05,
        }}
      />
    </>
  );
};
