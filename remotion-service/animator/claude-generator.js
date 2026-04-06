const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./prompt-builder');

const CHUNK_SIZE_DEFAULT = 25;
const PRICES = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };

function stripSharedDeclarations(code) {
  const SHARED = ['BG', 'ACCENT', 'ACCENT_DIM', 'TEXT_PRIMARY', 'TEXT_DIM', 'RED', 'RED_DIM', 'WHITE', 'WHITE_DIM', 'useFade', 'Grid', 'GRID_STYLE'];
  const declPattern = new RegExp(
    `^\\s*(?:const|let|var)\\s+(${SHARED.join('|')})\\s*[=:]|` +
    `^\\s*function\\s+(${SHARED.join('|')})\\s*[(<]`
  );
  const lines = code.split('\n');
  const result = [];
  let stripping = false;
  let braceDepth = 0;
  for (const line of lines) {
    if (!stripping && declPattern.test(line)) {
      stripping = true;
      braceDepth = 0;
    }
    if (stripping) {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0 && line.includes('}')) {
        stripping = false;
        braceDepth = 0;
      }
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

async function generateChunk(client, model, systemPrompt, chunkSegments, chunkIdx, totalChunks, extraPrompt, globalOffset) {
  const segEntries = chunkSegments.map((s, i) => ({
    name: `Seg${globalOffset + i}`,
    start: s.start,
    end: s.end,
    text: s.text || '',
  }));

  const userMessage =
`Generate component functions: ${segEntries.map(s => s.name).join(', ')}.
NO imports. NO exports. Plain function declarations only.

Segments:
${JSON.stringify(segEntries, null, 2)}
${extraPrompt ? `\nExtra instructions:\n${extraPrompt}` : ''}`;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      tools: [{
        name: 'write_segment_components',
        description: 'Write Remotion segment component functions (no imports, no exports)',
        input_schema: {
          type: 'object',
          properties: {
            components_code: {
              type: 'string',
              description: 'Component function definitions only. No import or export statements.',
            },
          },
          required: ['components_code'],
        },
      }],
      tool_choice: { type: 'tool', name: 'write_segment_components' },
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'max_tokens') {
      console.warn(`  [Animator] Chunk ${chunkIdx + 1}/${totalChunks} hit max_tokens!`);
    }

    const toolBlock = response.content.find(c => c.type === 'tool_use');
    if (!toolBlock) {
      return { error: `Chunk ${chunkIdx + 1}/${totalChunks}: no tool_use block returned` };
    }

    const raw = toolBlock.input?.components_code?.trim() ?? '';
    const code = stripSharedDeclarations(raw);
    const u = response.usage ?? {};

    console.log(`  [Animator] Chunk ${chunkIdx + 1}/${totalChunks} | ${segEntries.map(s => s.name).join(',')} | ${code.length} chars | in:${u.input_tokens} out:${u.output_tokens}`);

    return {
      code,
      tokens: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreated: u.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (err) {
    console.error(`  [Animator] Chunk ${chunkIdx + 1}/${totalChunks} error:`, err.message);
    return { error: `Chunk ${chunkIdx + 1}: ${err.message}` };
  }
}

function buildWrapper(componentName, segments, audioFilename, fps, componentsCode, brandingConfig) {
  const p = brandingConfig?.palette || {};
  const bg = p.bg || '#111118';
  const accent = p.accent || '#ef4444';
  const accentDim = p.accentDim || 'rgba(239,68,68,0.25)';
  const text = p.text || '#f0f0f0';
  const textDim = p.textDim || 'rgba(240,240,240,0.35)';
  const fontFamily = brandingConfig?.typography?.fontFamily || 'system-ui, sans-serif';

  const segNames = segments.map((_, i) => `Seg${i + 1}`);
  const segmentsArr = segments.map(s =>
    `  { start: ${s.start}, end: ${s.end}, text: ${JSON.stringify(s.text || '')} }`
  ).join(',\n');

  return `import { AbsoluteFill, Audio, interpolate, spring, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import React from "react";

const BG = "${bg}";
const ACCENT = "${accent}";
const ACCENT_DIM = "${accentDim}";
const TEXT_PRIMARY = "${text}";
const TEXT_DIM = "${textDim}";

// Legacy aliases
const RED = ACCENT;
const RED_DIM = ACCENT_DIM;
const WHITE = TEXT_PRIMARY;
const WHITE_DIM = TEXT_DIM;

const SEGMENTS = [
${segmentsArr}
];

function useFade(durationInFrames: number): number {
  const frame = useCurrentFrame();
  const fadeLen = Math.min(Math.round(durationInFrames * 0.12), 9);
  return interpolate(frame, [0, fadeLen, durationInFrames - fadeLen, durationInFrames], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
}

const Grid = () => (
  <div style={{
    position: "absolute", width: "100%", height: "100%", opacity: 0.03,
    backgroundImage: \`linear-gradient(\${TEXT_PRIMARY} 1px, transparent 1px), linear-gradient(90deg, \${TEXT_PRIMARY} 1px, transparent 1px)\`,
    backgroundSize: "100px 100px",
  }} />
);

${componentsCode}

const SEGMENT_COMPONENTS: React.FC[] = [${segNames.join(', ')}];

export const ${componentName} = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: "${fontFamily}" }}>
      <AbsoluteFill><Grid /></AbsoluteFill>
${audioFilename ? `      <Audio src={staticFile(${JSON.stringify(audioFilename)})} />\n` : ''}      {SEGMENTS.map((seg, i) => {
        const Comp = SEGMENT_COMPONENTS[i];
        const startFrame = Math.round(seg.start * fps);
        const dur = Math.max(1, Math.round(seg.end * fps) - startFrame);
        return (
          <Sequence key={i} from={startFrame} durationInFrames={dur} premountFor={15}>
            <Comp />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
`;
}

async function generateComposition({
  anthropicKey,
  segments,
  componentName,
  audioFilename,
  brandingConfig,
  brandingMarkdown,
  extraPrompt,
  model,
  chunkSize,
  fps,
  width,
  height,
}) {
  if (!anthropicKey) throw new Error('Anthropic API key is required');
  if (!segments || segments.length === 0) throw new Error('Segments are required');

  const effectiveModel = model || 'claude-sonnet-4-6';
  const effectiveChunkSize = chunkSize || CHUNK_SIZE_DEFAULT;
  const effectiveName = componentName || `Composition_${Date.now()}`;
  const effectiveFps = fps || 30;

  const { systemPrompt, skillsLoaded } = buildSystemPrompt(brandingConfig, extraPrompt, brandingMarkdown);

  const chunks = [];
  for (let i = 0; i < segments.length; i += effectiveChunkSize) {
    chunks.push(segments.slice(i, i + effectiveChunkSize));
  }

  console.log(`[Animator] "${effectiveName}" | ${segments.length} segments -> ${chunks.length} chunk(s) | model: ${effectiveModel}`);
  console.log(`  Skills: ${skillsLoaded.join(', ')}`);

  const client = new Anthropic({ apiKey: anthropicKey });

  const chunkResults = await Promise.all(
    chunks.map((chunk, chunkIdx) =>
      generateChunk(client, effectiveModel, systemPrompt, chunk, chunkIdx, chunks.length, extraPrompt, chunkIdx * effectiveChunkSize + 1)
    )
  );

  const failed = chunkResults.find(r => r.error);
  if (failed) throw new Error(failed.error);

  const allComponentsCode = chunkResults.map(r => r.code).join('\n\n');
  const finalCode = buildWrapper(effectiveName, segments, audioFilename, effectiveFps, allComponentsCode, brandingConfig);

  const tokensResult = chunkResults.reduce((acc, r) => ({
    input: acc.input + r.tokens.input,
    output: acc.output + r.tokens.output,
    cacheRead: acc.cacheRead + r.tokens.cacheRead,
    cacheCreated: acc.cacheCreated + r.tokens.cacheCreated,
  }), { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 });

  const costUsd =
    (tokensResult.input * PRICES.input / 1_000_000) +
    (tokensResult.output * PRICES.output / 1_000_000) +
    (tokensResult.cacheCreated * PRICES.cacheWrite / 1_000_000) +
    (tokensResult.cacheRead * PRICES.cacheRead / 1_000_000);

  const totalDuration = segments[segments.length - 1].end;
  const durationInFrames = Math.ceil(totalDuration * effectiveFps);

  console.log(`  [Animator] Total tokens in:${tokensResult.input} out:${tokensResult.output} cache_read:${tokensResult.cacheRead} | $${costUsd.toFixed(4)}`);

  return {
    code: finalCode,
    componentName: effectiveName,
    durationInFrames,
    fps: effectiveFps,
    width: width || 1920,
    height: height || 1080,
    chunks: chunks.length,
    skillsLoaded,
    model: effectiveModel,
    tokens: tokensResult,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}

module.exports = { generateComposition, buildWrapper, stripSharedDeclarations };
