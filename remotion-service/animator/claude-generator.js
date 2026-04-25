const Anthropic = require('@anthropic-ai/sdk');
const esbuild = require('esbuild');
const { buildSystemPrompt } = require('./prompt-builder');

const CHUNK_SIZE_DEFAULT = 25;
const CLAUDE_PRICES = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };
const GEMINI_PRICES = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
};
// Per 1M tokens. DeepSeek charges different rates for cache-hit vs cache-miss
// input tokens; the API returns prompt_cache_hit_tokens / prompt_cache_miss_tokens
// in the usage object, so we apply the correct rate to each.
const DEEPSEEK_PRICES = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cacheHit: 0.028 },
  'deepseek-v4-pro':   { input: 1.74, output: 3.48, cacheHit: 0.145 },
};

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_TIMEOUT_MS = 300_000;

function isGeminiModel(model) {
  return model && model.startsWith('gemini-');
}

function isDeepSeekModel(model) {
  return Boolean(model && model.startsWith('deepseek-'));
}

function getModelPrices(model) {
  if (isDeepSeekModel(model)) return DEEPSEEK_PRICES[model] || DEEPSEEK_PRICES['deepseek-v4-flash'];
  if (isGeminiModel(model)) return GEMINI_PRICES[model] || { input: 0.10, output: 0.40 };
  return CLAUDE_PRICES;
}

function countDelimiters(line) {
  let braces = 0, parens = 0;
  let inStr = false, strChar = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === strChar) inStr = false; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
  }
  return { braces, parens };
}

// Remove a trailing orphan identifier / expression statement left over by AI
// models (e.g. `}; lands` at the end of a tool output). esbuild accepts these
// as valid ExpressionStatements syntactically, but they crash at bundle/run
// time with "ReferenceError: <name> is not defined".
//
// Conservative approach: only strip when what remains after the last `}` or
// `;` is a bare identifier (optionally followed by `;`). Legitimate trailing
// helper declarations (`function foo()`, `const foo = ...`) are kept because
// they include more than just an identifier before end-of-string.
//
// The `segName` param is accepted for API compatibility but not used — the
// scan is content-based and works for any declaration name.
function trimTrailingGarbage(code /* , segName */) {
  if (!code) return code;
  let prev;
  let current = code;
  // Iterate in case the AI leaked multiple trailing tokens (e.g. `}; foo bar`).
  do {
    prev = current;
    current = current.replace(/([};])\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?\s*$/, '$1');
  } while (current !== prev);
  return current;
}

// Alias kept for multi-component chunks — same content-based logic works
// regardless of the number of components in the chunk.
function trimTrailingGarbageChunk(code /* , segNames */) {
  return trimTrailingGarbage(code);
}

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
  let parenDepth = 0;
  for (const line of lines) {
    if (!stripping && declPattern.test(line)) {
      stripping = true;
      braceDepth = 0;
      parenDepth = 0;
      const d = countDelimiters(line);
      braceDepth += d.braces;
      parenDepth += d.parens;
      if (braceDepth <= 0 && parenDepth <= 0) stripping = false;
      continue;
    }
    if (stripping) {
      const d = countDelimiters(line);
      braceDepth += d.braces;
      parenDepth += d.parens;
      if (braceDepth <= 0 && parenDepth <= 0) stripping = false;
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
    const cleaned = sanitizeReservedNames(stripSharedDeclarations(raw));
    const code = trimTrailingGarbageChunk(cleaned, segEntries.map(s => s.name));
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

function googleFontImportName(fontName) {
  return fontName.replace(/\s+/g, '');
}

function buildWrapper(componentName, segments, audioFilename, fps, componentsCode, brandingConfig) {
  const p = brandingConfig?.palette || {};
  const bg = p.bg || '#111118';
  const accent = p.accent || '#ef4444';
  const accentDim = p.accentDim || 'rgba(239,68,68,0.25)';
  const text = p.text || '#f0f0f0';
  const textDim = p.textDim || 'rgba(240,240,240,0.35)';
  const configuredFont = brandingConfig?.typography?.fontFamily || 'system-ui, sans-serif';
  const isGoogleFont = configuredFont !== 'system-ui, sans-serif' && !configuredFont.includes(',');
  const googleFontModule = isGoogleFont ? googleFontImportName(configuredFont) : null;
  const fontFamily = isGoogleFont ? configuredFont : configuredFont;

  const segNames = segments.map((_, i) => `Seg${i + 1}`);
  const segmentsArr = segments.map(s =>
    `  { start: ${s.start}, end: ${s.end}, text: ${JSON.stringify(s.text || '')} }`
  ).join(',\n');

  const googleFontImport = googleFontModule
    ? `import { loadFont } from "@remotion/google-fonts/${googleFontModule}";\nconst { fontFamily: FONT_FAMILY } = loadFont();\n`
    : '';

  return `import { AbsoluteFill, Audio, Easing, interpolate, spring, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import React from "react";
${googleFontImport}

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

class SceneErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <AbsoluteFill style={{ background: BG, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#f59e0b", fontSize: 18 }}>⚠ Scene {this.props.index + 1}</div>
          <div style={{ color: "#666", fontSize: 12, maxWidth: 600, textAlign: "center" }}>
            {String(this.state.error?.message || "Erreur de rendu").substring(0, 150)}
          </div>
        </AbsoluteFill>
      );
    }
    return this.props.children;
  }
}

const SEGMENT_COMPONENTS: React.FC[] = [${segNames.join(', ')}];

export const ${componentName} = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: ${googleFontModule ? 'FONT_FAMILY' : `"${fontFamily}"`} }}>
      <AbsoluteFill><Grid /></AbsoluteFill>
${audioFilename ? `      <Audio src={staticFile(${JSON.stringify(audioFilename)})} />\n` : ''}      {SEGMENTS.map((seg, i) => {
        const Comp = SEGMENT_COMPONENTS[i];
        const startFrame = Math.round(seg.start * fps);
        const dur = Math.max(1, Math.round(seg.end * fps) - startFrame);
        return (
          <Sequence key={i} from={startFrame} durationInFrames={dur} premountFor={15}>
            <SceneErrorBoundary index={i}><Comp /></SceneErrorBoundary>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
`;
}

const RESERVED_VAR_NAMES = ['arguments', 'eval', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'static', 'yield'];

function sanitizeReservedNames(code) {
  let result = code;
  for (const name of RESERVED_VAR_NAMES) {
    const pattern = new RegExp(`\\b(const|let|var)\\s+${name}\\b`, 'g');
    if (pattern.test(result)) {
      result = result.replace(pattern, `$1 ${name}List`);
      result = result.replace(new RegExp(`\\b${name}\\b\\.map\\b`, 'g'), `${name}List.map`);
      result = result.replace(new RegExp(`\\b${name}\\b\\.forEach\\b`, 'g'), `${name}List.forEach`);
      result = result.replace(new RegExp(`\\b${name}\\b\\.length\\b`, 'g'), `${name}List.length`);
      result = result.replace(new RegExp(`\\b${name}\\b\\.filter\\b`, 'g'), `${name}List.filter`);
      result = result.replace(new RegExp(`\\b${name}\\b\\[`, 'g'), `${name}List[`);
    }
  }
  result = fixKebabCaseStyles(result);
  return result;
}

function fixKebabCaseStyles(code) {
  const kebabProps = [
    'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
    'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
    'font-size', 'font-weight', 'font-family', 'font-style',
    'line-height', 'letter-spacing', 'word-spacing', 'word-break', 'word-wrap',
    'text-align', 'text-decoration', 'text-transform', 'text-shadow', 'text-overflow',
    'white-space', 'vertical-align',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'border-radius', 'border-color', 'border-width', 'border-style',
    'border-top', 'border-bottom', 'border-left', 'border-right',
    'box-shadow', 'box-sizing',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'align-items', 'align-self', 'align-content',
    'justify-content', 'justify-items', 'justify-self',
    'grid-template', 'grid-column', 'grid-row', 'grid-gap', 'grid-area',
    'object-fit', 'object-position',
    'overflow-x', 'overflow-y',
    'z-index',
    'min-width', 'max-width', 'min-height', 'max-height',
    'list-style', 'list-style-type',
    'clip-path', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
    'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity',
    'pointer-events', 'user-select', 'touch-action',
    'animation-name', 'animation-duration', 'animation-delay',
    'transition-property', 'transition-duration', 'transition-delay',
  ];
  function toCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
  let result = code;
  for (const prop of kebabProps) {
    const re = new RegExp(`(\\{[^}]*?)${prop.replace('-', '\\-')}(\\s*:)`, 'g');
    result = result.replace(re, `$1${toCamel(prop)}$2`);
  }
  return result;
}

function validateComponentCode(code, segName) {
  if (!code || code.trim().length === 0) return { valid: false, error: 'Empty code' };

  const hasDecl = new RegExp(`(?:function|const)\\s+${segName}\\b`).test(code);
  if (!hasDecl) return { valid: false, error: `Missing declaration for ${segName}` };

  try {
    esbuild.transformSync(code, {
      loader: 'jsx',
      jsx: 'preserve',
      logLevel: 'silent',
    });
  } catch (e) {
    const firstError = e.errors?.[0];
    const loc = firstError?.location ? ` (line ${firstError.location.line})` : '';
    return { valid: false, error: `Syntax error${loc}: ${firstError?.text || e.message}` };
  }

  return { valid: true };
}

async function generateSingleScene(client, model, systemPrompt, segment, segIndex, totalSegments, extraPrompt, neighborContext) {
  const segName = `Seg${segIndex}`;
  const segEntry = { name: segName, start: segment.start, end: segment.end, text: segment.text || '' };

  let contextBlock = '';
  if (neighborContext) {
    const parts = [];
    if (neighborContext.prevTexts?.length) parts.push(`Previous scenes: ${JSON.stringify(neighborContext.prevTexts)}`);
    if (neighborContext.nextTexts?.length) parts.push(`Next scenes: ${JSON.stringify(neighborContext.nextTexts)}`);
    if (neighborContext.prevCode) parts.push(`Previous scene code (for style reference):\n${neighborContext.prevCode.slice(0, 2000)}`);
    if (parts.length) contextBlock = `\n\nContext (for narrative/style coherence):\n${parts.join('\n')}`;
  }

  const userMessage =
`Generate ONE component function: ${segName}.
NO imports. NO exports. Plain function declaration only.
This is scene ${segIndex} of ${totalSegments}.

Segment:
${JSON.stringify(segEntry, null, 2)}${contextBlock}
${extraPrompt ? `\nExtra instructions:\n${extraPrompt}` : ''}`;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
      tools: [{
        name: 'write_segment_components',
        description: 'Write ONE Remotion segment component function (no imports, no exports)',
        input_schema: {
          type: 'object',
          properties: {
            components_code: {
              type: 'string',
              description: 'A single component function definition. No import or export statements.',
            },
          },
          required: ['components_code'],
        },
      }],
      tool_choice: { type: 'tool', name: 'write_segment_components' },
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'max_tokens') {
      console.warn(`  [Animator] Scene ${segIndex}/${totalSegments} hit max_tokens!`);
    }

    const toolBlock = response.content.find(c => c.type === 'tool_use');
    if (!toolBlock) {
      return { error: `Scene ${segIndex}: no tool_use block returned` };
    }

    const raw = toolBlock.input?.components_code?.trim() ?? '';
    const code = trimTrailingGarbage(sanitizeReservedNames(stripSharedDeclarations(raw)), segName);
    const u = response.usage ?? {};

    const validation = validateComponentCode(code, segName);
    if (!validation.valid) {
      console.warn(`  [Animator] Scene ${segIndex}/${totalSegments} validation failed: ${validation.error}`);
      return { error: `Scene ${segIndex} validation: ${validation.error}`, code };
    }

    console.log(`  [Animator] Scene ${segIndex}/${totalSegments} | ${segName} | ${code.length} chars | in:${u.input_tokens} out:${u.output_tokens} cacheRead:${u.cache_read_input_tokens ?? 0} cacheWrite:${u.cache_creation_input_tokens ?? 0}`);

    return {
      code,
      segName,
      tokens: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreated: u.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (err) {
    console.error(`  [Animator] Scene ${segIndex}/${totalSegments} error:`, err.message);
    return { error: `Scene ${segIndex}: ${err.message}` };
  }
}

// ============================================================================
// GEMINI: Generate a single scene via Gemini REST API with function calling
// ============================================================================

async function generateSingleSceneGemini(geminiKey, model, systemPrompt, segment, segIndex, totalSegments, extraPrompt, neighborContext) {
  const segName = `Seg${segIndex}`;
  const segEntry = { name: segName, start: segment.start, end: segment.end, text: segment.text || '' };

  let contextBlock = '';
  if (neighborContext) {
    const parts = [];
    if (neighborContext.prevTexts?.length) parts.push(`Previous scenes: ${JSON.stringify(neighborContext.prevTexts)}`);
    if (neighborContext.nextTexts?.length) parts.push(`Next scenes: ${JSON.stringify(neighborContext.nextTexts)}`);
    if (neighborContext.prevCode) parts.push(`Previous scene code (for style reference):\n${neighborContext.prevCode.slice(0, 2000)}`);
    if (parts.length) contextBlock = `\n\nContext (for narrative/style coherence):\n${parts.join('\n')}`;
  }

  const userMessage =
`Generate ONE component function: ${segName}.
NO imports. NO exports. Plain function declaration only.
This is scene ${segIndex} of ${totalSegments}.

Segment:
${JSON.stringify(segEntry, null, 2)}${contextBlock}
${extraPrompt ? `\nExtra instructions:\n${extraPrompt}` : ''}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          tools: [{
            functionDeclarations: [{
              name: 'write_segment_components',
              description: 'Write ONE Remotion segment component function (no imports, no exports)',
              parameters: {
                type: 'OBJECT',
                properties: {
                  components_code: {
                    type: 'STRING',
                    description: 'A single component function definition. No import or export statements.',
                  },
                },
                required: ['components_code'],
              },
            }],
          }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['write_segment_components'] } },
          generationConfig: { maxOutputTokens: 16000 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const fnCall = candidate?.content?.parts?.find(p => p.functionCall);

    if (!fnCall) {
      const textParts = candidate?.content?.parts?.filter(p => p.text).map(p => p.text).join(' ') || '';
      throw new Error(`Gemini returned no function call. Text: ${textParts.substring(0, 200)}`);
    }

    const raw = (fnCall.functionCall.args?.components_code || '').trim();
    const code = trimTrailingGarbage(sanitizeReservedNames(stripSharedDeclarations(raw)), segName);
    const u = data.usageMetadata || {};

    const validation = validateComponentCode(code, segName);
    if (!validation.valid) {
      console.warn(`  [Animator/Gemini] Scene ${segIndex}/${totalSegments} validation failed: ${validation.error}`);
      return { error: `Scene ${segIndex} validation: ${validation.error}`, code };
    }

    const inputTokens = u.promptTokenCount || 0;
    const outputTokens = u.candidatesTokenCount || 0;

    console.log(`  [Animator/Gemini] Scene ${segIndex}/${totalSegments} | ${segName} | ${code.length} chars | in:${inputTokens} out:${outputTokens}`);

    return {
      code,
      segName,
      tokens: { input: inputTokens, output: outputTokens, cacheRead: 0, cacheCreated: 0 },
    };
  } catch (err) {
    console.error(`  [Animator/Gemini] Scene ${segIndex}/${totalSegments} error:`, err.message);
    return { error: `Scene ${segIndex}: ${err.message}` };
  }
}

async function generateChunkGemini(geminiKey, model, systemPrompt, chunkSegments, chunkIdx, totalChunks, extraPrompt, globalOffset) {
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          tools: [{
            functionDeclarations: [{
              name: 'write_segment_components',
              description: 'Write Remotion segment component functions (no imports, no exports)',
              parameters: {
                type: 'OBJECT',
                properties: {
                  components_code: {
                    type: 'STRING',
                    description: 'Component function definitions only. No import or export statements.',
                  },
                },
                required: ['components_code'],
              },
            }],
          }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['write_segment_components'] } },
          generationConfig: { maxOutputTokens: 64000 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const fnCall = candidate?.content?.parts?.find(p => p.functionCall);

    if (!fnCall) {
      return { error: `Chunk ${chunkIdx + 1}/${totalChunks}: Gemini returned no function call` };
    }

    const raw = (fnCall.functionCall.args?.components_code || '').trim();
    const cleaned = sanitizeReservedNames(stripSharedDeclarations(raw));
    const code = trimTrailingGarbageChunk(cleaned, segEntries.map(s => s.name));
    const u = data.usageMetadata || {};

    console.log(`  [Animator/Gemini] Chunk ${chunkIdx + 1}/${totalChunks} | ${segEntries.map(s => s.name).join(',')} | ${code.length} chars | in:${u.promptTokenCount || 0} out:${u.candidatesTokenCount || 0}`);

    return {
      code,
      tokens: {
        input: u.promptTokenCount || 0,
        output: u.candidatesTokenCount || 0,
        cacheRead: 0,
        cacheCreated: 0,
      },
    };
  } catch (err) {
    console.error(`  [Animator/Gemini] Chunk ${chunkIdx + 1}/${totalChunks} error:`, err.message);
    return { error: `Chunk ${chunkIdx + 1}: ${err.message}` };
  }
}

// ============================================================================
// DEEPSEEK: native chat completions API (OpenAI-compatible) with forced
// tool calling. Thinking mode is enabled by default on deepseek-v4-* models.
// ============================================================================

async function generateSingleSceneDeepSeek(deepseekKey, model, systemPrompt, segment, segIndex, totalSegments, extraPrompt, neighborContext) {
  const segName = `Seg${segIndex}`;
  const segEntry = { name: segName, start: segment.start, end: segment.end, text: segment.text || '' };

  let contextBlock = '';
  if (neighborContext) {
    const parts = [];
    if (neighborContext.prevTexts?.length) parts.push(`Previous scenes: ${JSON.stringify(neighborContext.prevTexts)}`);
    if (neighborContext.nextTexts?.length) parts.push(`Next scenes: ${JSON.stringify(neighborContext.nextTexts)}`);
    if (neighborContext.prevCode) parts.push(`Previous scene code (for style reference):\n${neighborContext.prevCode.slice(0, 2000)}`);
    if (parts.length) contextBlock = `\n\nContext (for narrative/style coherence):\n${parts.join('\n')}`;
  }

  const userMessage =
`Generate ONE component function: ${segName}.
NO imports. NO exports. Plain function declaration only.
This is scene ${segIndex} of ${totalSegments}.

Segment:
${JSON.stringify(segEntry, null, 2)}${contextBlock}
${extraPrompt ? `\nExtra instructions:\n${extraPrompt}` : ''}`;

  console.log(`  [Animator/DeepSeek] Scene ${segIndex}/${totalSegments} -> calling ${model}...`);

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepseekKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'write_segment_components',
            description: 'Write ONE Remotion segment component function (no imports, no exports)',
            parameters: {
              type: 'object',
              properties: {
                components_code: {
                  type: 'string',
                  description: 'A single component function definition. No import or export statements.',
                },
              },
              required: ['components_code'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'write_segment_components' } },
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    if (!toolCall || !toolCall.function?.arguments) {
      const textContent = choice?.message?.content || '';
      throw new Error(`DeepSeek returned no tool call. Text: ${String(textContent).substring(0, 200)}`);
    }

    let parsedArgs;
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      throw new Error(`DeepSeek tool_call arguments not valid JSON: ${parseErr.message}`);
    }

    const raw = (parsedArgs.components_code || '').trim();
    const code = trimTrailingGarbage(sanitizeReservedNames(stripSharedDeclarations(raw)), segName);
    const u = data.usage || {};

    const validation = validateComponentCode(code, segName);
    if (!validation.valid) {
      console.warn(`  [Animator/DeepSeek] Scene ${segIndex}/${totalSegments} validation failed: ${validation.error}`);
      return { error: `Scene ${segIndex} validation: ${validation.error}`, code };
    }

    const cacheHitTokens = u.prompt_cache_hit_tokens || 0;
    const cacheMissTokens = u.prompt_cache_miss_tokens || ((u.prompt_tokens || 0) - cacheHitTokens);
    const outputTokens = u.completion_tokens || 0;

    console.log(`  [Animator/DeepSeek] Scene ${segIndex}/${totalSegments} | ${segName} | ${code.length} chars | in_miss:${cacheMissTokens} in_hit:${cacheHitTokens} out:${outputTokens}`);

    return {
      code,
      segName,
      tokens: {
        input: cacheMissTokens,
        output: outputTokens,
        cacheRead: cacheHitTokens,
        cacheCreated: 0,
      },
    };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    const msg = isTimeout ? `timeout after ${DEEPSEEK_TIMEOUT_MS}ms` : err.message;
    console.error(`  [Animator/DeepSeek] Scene ${segIndex}/${totalSegments} error:`, msg);
    return { error: `Scene ${segIndex}: ${msg}` };
  }
}

async function generateChunkDeepSeek(deepseekKey, model, systemPrompt, chunkSegments, chunkIdx, totalChunks, extraPrompt, globalOffset) {
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

  console.log(`  [Animator/DeepSeek] Chunk ${chunkIdx + 1}/${totalChunks} -> calling ${model} (${segEntries.length} segs)...`);

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepseekKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'write_segment_components',
            description: 'Write Remotion segment component functions (no imports, no exports)',
            parameters: {
              type: 'object',
              properties: {
                components_code: {
                  type: 'string',
                  description: 'Component function definitions only. No import or export statements.',
                },
              },
              required: ['components_code'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'write_segment_components' } },
        max_tokens: 64000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    if (!toolCall || !toolCall.function?.arguments) {
      return { error: `Chunk ${chunkIdx + 1}/${totalChunks}: DeepSeek returned no tool call` };
    }

    let parsedArgs;
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      return { error: `Chunk ${chunkIdx + 1}/${totalChunks}: tool_call arguments not valid JSON: ${parseErr.message}` };
    }

    const raw = (parsedArgs.components_code || '').trim();
    const cleaned = sanitizeReservedNames(stripSharedDeclarations(raw));
    const code = trimTrailingGarbageChunk(cleaned, segEntries.map(s => s.name));
    const u = data.usage || {};
    const cacheHitTokens = u.prompt_cache_hit_tokens || 0;
    const cacheMissTokens = u.prompt_cache_miss_tokens || ((u.prompt_tokens || 0) - cacheHitTokens);
    const outputTokens = u.completion_tokens || 0;

    console.log(`  [Animator/DeepSeek] Chunk ${chunkIdx + 1}/${totalChunks} | ${segEntries.map(s => s.name).join(',')} | ${code.length} chars | in_miss:${cacheMissTokens} in_hit:${cacheHitTokens} out:${outputTokens}`);

    return {
      code,
      tokens: {
        input: cacheMissTokens,
        output: outputTokens,
        cacheRead: cacheHitTokens,
        cacheCreated: 0,
      },
    };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    const msg = isTimeout ? `timeout after ${DEEPSEEK_TIMEOUT_MS}ms` : err.message;
    console.error(`  [Animator/DeepSeek] Chunk ${chunkIdx + 1}/${totalChunks} error:`, msg);
    return { error: `Chunk ${chunkIdx + 1}: ${msg}` };
  }
}

async function generateComposition({
  anthropicKey,
  geminiKey,
  deepseekKey,
  segments,
  componentName,
  audioFilename,
  brandingConfig,
  brandingMarkdown,
  extraPrompt,
  selectedSkills,
  model,
  chunkSize,
  fps,
  width,
  height,
}) {
  if (!model) throw new Error('model is required (no silent fallback to Claude)');
  const effectiveModel = model;
  const useDeepSeek = isDeepSeekModel(effectiveModel);
  const useGemini = !useDeepSeek && isGeminiModel(effectiveModel);

  if (useDeepSeek && !deepseekKey) throw new Error('DeepSeek API key is required for DeepSeek models');
  if (useGemini && !geminiKey) throw new Error('Gemini API key is required for Gemini models');
  if (!useDeepSeek && !useGemini && !anthropicKey) throw new Error('Anthropic API key is required');
  if (!segments || segments.length === 0) throw new Error('Segments are required');

  const effectiveChunkSize = chunkSize || CHUNK_SIZE_DEFAULT;
  const effectiveName = componentName || `Composition_${Date.now()}`;
  const effectiveFps = fps || 30;

  const { systemPrompt, skillsLoaded } = buildSystemPrompt(brandingConfig, extraPrompt, brandingMarkdown, selectedSkills);

  const chunks = [];
  for (let i = 0; i < segments.length; i += effectiveChunkSize) {
    chunks.push(segments.slice(i, i + effectiveChunkSize));
  }

  console.log(`[Animator] "${effectiveName}" | ${segments.length} segments -> ${chunks.length} chunk(s) | model: ${effectiveModel}`);
  console.log(`  Skills: ${skillsLoaded.join(', ')}`);

  let chunkResults;
  if (useDeepSeek) {
    chunkResults = await Promise.all(
      chunks.map((chunk, chunkIdx) =>
        generateChunkDeepSeek(deepseekKey, effectiveModel, systemPrompt, chunk, chunkIdx, chunks.length, extraPrompt, chunkIdx * effectiveChunkSize + 1)
      )
    );
  } else if (useGemini) {
    chunkResults = await Promise.all(
      chunks.map((chunk, chunkIdx) =>
        generateChunkGemini(geminiKey, effectiveModel, systemPrompt, chunk, chunkIdx, chunks.length, extraPrompt, chunkIdx * effectiveChunkSize + 1)
      )
    );
  } else {
    const client = new Anthropic({ apiKey: anthropicKey });
    chunkResults = await Promise.all(
      chunks.map((chunk, chunkIdx) =>
        generateChunk(client, effectiveModel, systemPrompt, chunk, chunkIdx, chunks.length, extraPrompt, chunkIdx * effectiveChunkSize + 1)
      )
    );
  }

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

  const prices = getModelPrices(effectiveModel);
  let costUsd;
  if (useDeepSeek) {
    // DeepSeek bills cache hits at a discounted rate; tokensResult.cacheRead carries
    // the cache-hit count, tokensResult.input carries cache-miss only.
    costUsd =
      (tokensResult.input * prices.input / 1_000_000) +
      (tokensResult.cacheRead * (prices.cacheHit || prices.input) / 1_000_000) +
      (tokensResult.output * prices.output / 1_000_000);
  } else if (useGemini) {
    costUsd = (tokensResult.input * prices.input / 1_000_000) + (tokensResult.output * prices.output / 1_000_000);
  } else {
    costUsd =
      (tokensResult.input * prices.input / 1_000_000) +
      (tokensResult.output * prices.output / 1_000_000) +
      (tokensResult.cacheCreated * prices.cacheWrite / 1_000_000) +
      (tokensResult.cacheRead * prices.cacheRead / 1_000_000);
  }

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

module.exports = { generateComposition, generateSingleScene, generateSingleSceneGemini, generateSingleSceneDeepSeek, validateComponentCode, sanitizeReservedNames, buildWrapper, stripSharedDeclarations, trimTrailingGarbage, trimTrailingGarbageChunk, isGeminiModel, isDeepSeekModel, getModelPrices };
