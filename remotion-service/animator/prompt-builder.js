const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, 'skills');
const DEFAULT_BRANDING_PATH = path.join(__dirname, 'default-branding.md');

const ALWAYS_RULES = [
  'animations.md',
  'timing.md',
  'sequencing.md',
  'charts.md',
  'text-animations.md',
];

const CONDITIONAL = [
  { kw: ['3d', 'three', 'torus', 'sphere', 'mesh'], file: '3d.md' },
  { kw: ['audio', 'sound', 'music'], file: 'audio.md' },
  { kw: ['font', 'google font', 'police'], file: 'fonts.md' },
  { kw: ['transition', 'wipe', 'slide in'], file: 'transitions.md' },
  { kw: ['subtitle', 'caption', 'sous-titre'], file: 'subtitles.md' },
];

const OUTPUT_INSTRUCTIONS = `
<!-- OUTPUT INSTRUCTIONS — SEGMENT COMPONENTS ONLY -->
You are a Remotion animation expert. Output ONLY React component function definitions.
- NO import statements. NO export statements. Just plain function/const declarations.
- Each component is named Seg{N} (Seg1, Seg2, Seg3…) matching the segment number given.
- Follow the branding exactly: use the provided palette tokens, grid, springs, fades.
- Every segment must have a UNIQUE, creative animation — no two segments alike.
- Use SVG charts/data-viz whenever the segment text contains numbers, stats or data.
- All animations via useCurrentFrame() + useVideoConfig(). No CSS transitions/animations.
- Always extrapolateRight: "clamp".
- Shared constants available: BG, ACCENT, ACCENT_DIM, TEXT_PRIMARY, TEXT_DIM
- Helper available: useFade(durationInFrames: number): number
- Remotion hooks available: useCurrentFrame, useVideoConfig, interpolate, spring
- Remotion components available: AbsoluteFill, Sequence, Audio, staticFile
`;

function buildBrandingMarkdown(brandingConfig) {
  if (!brandingConfig || !brandingConfig.palette) return '';

  const p = brandingConfig.palette;
  const t = brandingConfig.typography || {};
  const a = brandingConfig.animation || {};

  return `# Branding

## Palette
| Token | Value |
|-------|-------|
| BG | ${p.bg || '#111118'} |
| ACCENT | ${p.accent || '#ef4444'} |
| ACCENT_DIM | ${p.accentDim || 'rgba(239,68,68,0.25)'} |
| TEXT_PRIMARY | ${p.text || '#f0f0f0'} |
| TEXT_DIM | ${p.textDim || 'rgba(240,240,240,0.35)'} |

No other colors allowed. Hierarchy via opacity and font weight only.

## Typography
- Font: ${t.fontFamily || 'system-ui, sans-serif'}
- Hero size: ${t.heroSize || 150}px
- Title size: ${t.titleSize || 56}px
- Subtitle size: ${t.subtitleSize || 32}px
- Label size: ${t.labelSize || 21}px

## Animation
- Fade ratio: ${a.fadeRatio || 0.12} of segment duration
- Stagger: ${a.staggerFrames || 8} frames between list items
- Premount: ${a.premountFrames || 15} frames
- Springs: smooth { damping: 200 }, snappy { damping: 20, stiffness: 200 }, punch { damping: 8 }
- Never CSS transitions. Always interpolate() + spring().
- Always extrapolateRight: "clamp".
`;
}

function buildSystemPrompt(brandingConfig, extraPrompt) {
  const parts = [];
  const skillsLoaded = [];

  if (brandingConfig && brandingConfig.palette) {
    parts.push(buildBrandingMarkdown(brandingConfig));
    skillsLoaded.push('custom-branding');
  } else if (fs.existsSync(DEFAULT_BRANDING_PATH)) {
    parts.push(fs.readFileSync(DEFAULT_BRANDING_PATH, 'utf8'));
    skillsLoaded.push('default-branding.md');
  }

  for (const rule of ALWAYS_RULES) {
    const p = path.join(SKILLS_DIR, rule);
    if (fs.existsSync(p)) {
      parts.push(fs.readFileSync(p, 'utf8'));
      skillsLoaded.push(rule);
    }
  }

  const lc = (extraPrompt || '').toLowerCase();
  for (const { kw, file } of CONDITIONAL) {
    if (kw.some(k => lc.includes(k))) {
      const p = path.join(SKILLS_DIR, file);
      if (fs.existsSync(p)) {
        parts.push(fs.readFileSync(p, 'utf8'));
        skillsLoaded.push(file);
      }
    }
  }

  parts.push(OUTPUT_INSTRUCTIONS);

  return {
    systemPrompt: parts.join('\n\n---\n\n'),
    skillsLoaded,
  };
}

module.exports = { buildSystemPrompt, buildBrandingMarkdown };
