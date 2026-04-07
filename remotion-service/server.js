const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { bundle } = require('@remotion/bundler');
const { renderMedia, renderStill, selectComposition, getCompositions, ensureBrowser } = require('@remotion/renderer');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL; // e.g. https://purpleai.duckdns.org/remotion-renders
function buildVideoUrl(filename) {
  if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL}/${filename}`;
  return `http://${process.env.VPS_HOST || 'localhost'}:${PORT}/renders/${filename}`;
}

app.use('/renders', express.static(TEMP_DIR));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

let bundleLocation = null;
let browserInstance = null;

const activeJobs = new Map();

async function initBundle() {
  console.log('[Remotion] Bundling compositions...');
  const entryPoint = path.join(__dirname, 'src', 'index.js');
  bundleLocation = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });
  console.log('[Remotion] Bundle ready at:', bundleLocation);
}

async function initBrowser() {
  console.log('[Remotion] Ensuring headless browser...');
  await ensureBrowser();
  console.log('[Remotion] Browser ready');
}

// --- Health ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bundleReady: !!bundleLocation,
    activeJobs: activeJobs.size,
    uptime: process.uptime(),
  });
});

// --- List compositions ---
app.get('/compositions', async (req, res) => {
  try {
    if (!bundleLocation) return res.status(503).json({ error: 'Bundle not ready' });
    const compositions = await getCompositions(bundleLocation);
    res.json(compositions.map(c => ({
      id: c.id,
      width: c.width,
      height: c.height,
      fps: c.fps,
      durationInFrames: c.durationInFrames,
    })));
  } catch (err) {
    console.error('[Remotion] Error listing compositions:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Render endpoint ---
app.post('/render', async (req, res) => {
  const {
    compositionId = 'Slideshow',
    inputProps = {},
    fps = 30,
    width = 1920,
    height = 1080,
    durationInFrames,
    codec = 'h264',
    crf,
    jobId: externalJobId,
  } = req.body;

  if (!bundleLocation) {
    return res.status(503).json({ error: 'Bundle not ready yet, try again shortly' });
  }

  const jobId = externalJobId || `remotion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputFile = path.join(TEMP_DIR, `${jobId}.mp4`);

  activeJobs.set(jobId, {
    status: 'rendering',
    progress: 0,
    startedAt: Date.now(),
    compositionId,
  });

  res.json({ success: true, jobId, status: 'rendering' });

  (async () => {
    try {
      if (supabase && externalJobId) {
        await supabase.from('remotion_render_jobs').upsert({
          id: jobId,
          status: 'rendering',
          progress: 0,
          composition_id: compositionId,
          input_props: inputProps,
        });
      }

      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: compositionId,
        inputProps,
      });

      const finalDuration = durationInFrames || composition.durationInFrames;
      const finalFps = fps || composition.fps;
      const finalWidth = width || composition.width;
      const finalHeight = height || composition.height;

      console.log(`[Remotion] Rendering ${compositionId}: ${finalWidth}x${finalHeight} @ ${finalFps}fps, ${finalDuration} frames`);

      await renderMedia({
        composition: {
          ...composition,
          durationInFrames: finalDuration,
          fps: finalFps,
          width: finalWidth,
          height: finalHeight,
        },
        serveUrl: bundleLocation,
        codec,
        outputLocation: outputFile,
        inputProps,
        ...(crf !== undefined ? { crf } : {}),
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          const job = activeJobs.get(jobId);
          if (job) job.progress = pct;

          if (pct % 10 === 0) {
            console.log(`[Remotion] ${jobId} progress: ${pct}%`);
          }

          if (supabase && externalJobId && pct % 5 === 0) {
            supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', jobId).then(() => {});
          }
        },
      });

      const videoUrl = buildVideoUrl(`${jobId}.mp4`);

      const job = activeJobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.videoUrl = videoUrl;
        job.completedAt = Date.now();
      }

      console.log(`[Remotion] Render complete: ${jobId} -> ${outputFile}`);

      if (supabase && externalJobId) {
        await supabase.from('remotion_render_jobs').update({
          status: 'completed',
          progress: 100,
          video_url: videoUrl,
          completed_at: new Date().toISOString(),
        }).eq('id', jobId);
      }
    } catch (err) {
      console.error(`[Remotion] Render failed for ${jobId}:`, err);
      const job = activeJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = err.message;
      }

      if (supabase && externalJobId) {
        await supabase.from('remotion_render_jobs').update({
          status: 'failed',
          error_message: err.message,
        }).eq('id', jobId);
      }
    }
  })();
});

// --- Job status ---
app.get('/render/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ jobId: req.params.jobId, ...job });
});

// --- Cancel ---
app.delete('/render/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.status = 'cancelled';
  res.json({ success: true, jobId: req.params.jobId, status: 'cancelled' });
});

// --- Animator: Claude generation + Remotion render ---
const { generateComposition, generateSingleScene, generateSingleSceneGemini, validateComponentCode, buildWrapper, stripSharedDeclarations, isGeminiModel, getModelPrices } = require('./animator/claude-generator');
const { buildSystemPrompt } = require('./animator/prompt-builder');
const Anthropic = require('@anthropic-ai/sdk');

app.post('/animator/generate', async (req, res) => {
  const {
    anthropicKey,
    segments,
    componentName,
    audioFilename,
    brandingConfig,
    brandingMarkdown,
    extraPrompt,
    selectedSkills,
    model,
    chunkSize,
    fps = 30,
    width = 1920,
    height = 1080,
    projectId,
    userId,
  } = req.body;

  if (!anthropicKey) return res.status(400).json({ error: 'anthropicKey is required' });
  if (!segments || segments.length === 0) return res.status(400).json({ error: 'segments are required' });

  const jobId = `animator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`[Animator] Starting generation ${jobId} for ${segments.length} segments`);

    if (supabase && projectId && userId) {
      await supabase.from('remotion_render_jobs').insert({
        id: jobId,
        user_id: userId,
        project_id: projectId,
        status: 'rendering',
        composition_id: componentName || 'AnimatorComposition',
        input_props: { segments, brandingConfig, extraPrompt },
      });
    }

    const result = await generateComposition({
      anthropicKey,
      segments,
      componentName: componentName || `Anim${jobId.replace(/[^a-zA-Z0-9]/g, '')}`,
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
    });

    if (supabase && projectId && userId) {
      await supabase.from('remotion_render_jobs').update({
        status: 'generated',
        generated_code: result.code,
        duration_in_frames: result.durationInFrames,
        fps: result.fps,
        width: result.width,
        height: result.height,
        cost_usd: result.costUsd,
        tokens: result.tokens,
      }).eq('id', jobId);
    }

    console.log(`[Animator] Generation complete: ${jobId} | ${result.code.split('\n').length} lines | $${result.costUsd.toFixed(4)}`);

    res.json({
      success: true,
      jobId,
      ...result,
    });
  } catch (err) {
    console.error(`[Animator] Generation failed for ${jobId}:`, err.message);

    if (supabase && projectId && userId) {
      await supabase.from('remotion_render_jobs').update({
        status: 'failed',
        error_message: err.message,
      }).eq('id', jobId);
    }

    res.status(500).json({ error: err.message });
  }
});

app.post('/animator/render', async (req, res) => {
  const {
    jobId: existingJobId,
    code,
    componentName,
    durationInFrames,
    fps = 30,
    width = 1920,
    height = 1080,
    codec = 'h264',
    crf,
    projectId,
    userId,
  } = req.body;

  if (!code) return res.status(400).json({ error: 'code (generated TSX) is required' });
  if (!bundleLocation) return res.status(503).json({ error: 'Bundle not ready' });

  const jobId = existingJobId || `animator-render-${Date.now()}`;
  const effectiveName = componentName || `AnimComp_${Date.now()}`;

  try {
    const srcDir = path.join(__dirname, 'src');
    const compositionPath = path.join(srcDir, `${effectiveName}.tsx`);
    fs.writeFileSync(compositionPath, code, 'utf-8');

    const rootPath = path.join(srcDir, 'Root.jsx');
    let rootContent = fs.readFileSync(rootPath, 'utf-8');
    const importLine = `import { ${effectiveName} } from './${effectiveName}';`;
    if (!rootContent.includes(importLine)) {
      const lastImportIdx = rootContent.lastIndexOf('import ');
      const lineEnd = rootContent.indexOf('\n', lastImportIdx);
      rootContent = rootContent.slice(0, lineEnd + 1) + importLine + '\n' + rootContent.slice(lineEnd + 1);
    }

    const compBlock = `      <Composition id="${effectiveName}" component={${effectiveName}} durationInFrames={${durationInFrames || 300}} fps={${fps}} width={${width}} height={${height}} defaultProps={{}} />`;
    if (!rootContent.includes(`id="${effectiveName}"`)) {
      const closingIdx = rootContent.lastIndexOf('    </>');
      if (closingIdx !== -1) {
        rootContent = rootContent.slice(0, closingIdx) + compBlock + '\n' + rootContent.slice(closingIdx);
      }
    }
    fs.writeFileSync(rootPath, rootContent, 'utf-8');

    console.log(`[Animator] Re-bundling with new composition: ${effectiveName}`);
    const entryPoint = path.join(srcDir, 'index.js');
    const newBundle = await bundle({ entryPoint, webpackOverride: (config) => config });

    const outputFile = path.join(__dirname, 'temp', `${jobId}.mp4`);

    activeJobs.set(jobId, {
      status: 'rendering',
      progress: 0,
      startedAt: Date.now(),
      compositionId: effectiveName,
    });

    if (supabase && existingJobId) {
      await supabase.from('remotion_render_jobs').update({ status: 'rendering', progress: 0 }).eq('id', jobId);
    }

    res.json({ success: true, jobId, status: 'rendering' });

    (async () => {
      try {
        const composition = await selectComposition({
          serveUrl: newBundle,
          id: effectiveName,
          inputProps: {},
        });

        await renderMedia({
          composition: {
            ...composition,
            durationInFrames: durationInFrames || composition.durationInFrames,
            fps: fps || composition.fps,
            width: width || composition.width,
            height: height || composition.height,
          },
          serveUrl: newBundle,
          codec,
          outputLocation: outputFile,
          inputProps: {},
          ...(crf !== undefined ? { crf } : {}),
          onProgress: ({ progress }) => {
            const pct = Math.round(progress * 100);
            const job = activeJobs.get(jobId);
            if (job) job.progress = pct;

            if (pct % 10 === 0) {
              console.log(`[Animator] Render ${jobId} progress: ${pct}%`);
              if (supabase && existingJobId) {
                supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', jobId).then(() => {});
              }
            }
          },
        });

        const videoUrl = buildVideoUrl(`${jobId}.mp4`);

        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.progress = 100;
          job.videoUrl = videoUrl;
          job.completedAt = Date.now();
        }

        console.log(`[Animator] Render complete: ${jobId} -> ${videoUrl}`);

        if (supabase && existingJobId) {
          await supabase.from('remotion_render_jobs').update({
            status: 'completed',
            progress: 100,
            video_url: videoUrl,
            completed_at: new Date().toISOString(),
          }).eq('id', jobId);
        }

        if (supabase && projectId) {
          await supabase.from('projects').update({
            animator_video_url: videoUrl,
          }).eq('id', projectId);
        }
      } catch (err) {
        console.error(`[Animator] Render failed for ${jobId}:`, err.message);
        const job = activeJobs.get(jobId);
        if (job) { job.status = 'failed'; job.error = err.message; }

        if (supabase && existingJobId) {
          await supabase.from('remotion_render_jobs').update({
            status: 'failed',
            error_message: err.message,
          }).eq('id', jobId);
        }
      }
    })();
  } catch (err) {
    console.error(`[Animator] Render setup failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/animator/generate-and-render', async (req, res) => {
  const {
    anthropicKey,
    segments,
    componentName,
    audioFilename,
    audioUrl,
    brandingConfig,
    brandingMarkdown,
    extraPrompt,
    selectedSkills,
    model,
    chunkSize,
    fps = 30,
    width = 1920,
    height = 1080,
    codec = 'h264',
    crf,
    projectId,
    userId,
  } = req.body;

  if (!anthropicKey) return res.status(400).json({ error: 'anthropicKey is required' });
  if (!segments || segments.length === 0) return res.status(400).json({ error: 'segments are required' });
  if (!bundleLocation) return res.status(503).json({ error: 'Bundle not ready' });

  const jobId = `animator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const effectiveName = componentName || `Anim${jobId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const compositionId = effectiveName.replace(/_/g, '-');

  let resolvedAudioFilename = audioFilename || null;
  if (!resolvedAudioFilename && audioUrl) {
    try {
      const audioResp = await fetch(audioUrl);
      if (audioResp.ok) {
        const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
        resolvedAudioFilename = `${jobId}-audio.mp3`;
        const publicDir = path.join(__dirname, 'public');
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
        fs.writeFileSync(path.join(publicDir, resolvedAudioFilename), audioBuffer);
        console.log(`[Animator] Downloaded audio: ${resolvedAudioFilename} (${audioBuffer.length} bytes)`);
      }
    } catch (e) {
      console.warn(`[Animator] Failed to download audio: ${e.message}`);
    }
  }

  activeJobs.set(jobId, { status: 'generating', progress: 0, startedAt: Date.now(), compositionId });

  if (supabase && projectId && userId) {
    await supabase.from('remotion_render_jobs').insert({
      id: jobId,
      user_id: userId,
      project_id: projectId,
      status: 'generating',
      composition_id: effectiveName,
      input_props: { segments, brandingConfig, extraPrompt },
      fps, width, height,
    });
  }

  res.json({ success: true, jobId, status: 'generating' });

  (async () => {
    try {
      const result = await generateComposition({
        anthropicKey, segments, componentName: effectiveName,
        audioFilename: resolvedAudioFilename, brandingConfig, brandingMarkdown, extraPrompt, selectedSkills, model, chunkSize, fps, width, height,
      });

      if (supabase && projectId) {
        await supabase.from('remotion_render_jobs').update({
          status: 'rendering',
          generated_code: result.code,
          duration_in_frames: result.durationInFrames,
          cost_usd: result.costUsd,
          tokens: result.tokens,
        }).eq('id', jobId);
      }

      const job = activeJobs.get(jobId);
      if (job) { job.status = 'rendering'; job.tokens = result.tokens; job.costUsd = result.costUsd; }

      const srcDir = path.join(__dirname, 'src');

      // Clean up old TSX files from previous renders of the same project (same name prefix, different timestamp)
      const namePrefix = effectiveName.replace(/[a-z0-9]{6,12}$/i, '');
      if (namePrefix.length >= 8) {
        const oldFiles = fs.readdirSync(srcDir).filter(f => f.startsWith(namePrefix) && f.endsWith('.tsx') && f !== `${effectiveName}.tsx`);
        if (oldFiles.length > 0) {
          console.log(`[Animator] Cleaning ${oldFiles.length} old TSX file(s) for prefix "${namePrefix}"`);
          const rootPath = path.join(srcDir, 'Root.jsx');
          let rootClean = fs.readFileSync(rootPath, 'utf-8');
          for (const f of oldFiles) {
            const oldName = f.replace('.tsx', '');
            fs.unlinkSync(path.join(srcDir, f));
            rootClean = rootClean.split('\n').filter(line => !line.includes(oldName)).join('\n');
          }
          fs.writeFileSync(rootPath, rootClean, 'utf-8');
        }
      }

      fs.writeFileSync(path.join(srcDir, `${effectiveName}.tsx`), result.code, 'utf-8');

      const rootPath = path.join(srcDir, 'Root.jsx');
      let rootContent = fs.readFileSync(rootPath, 'utf-8');
      const importLine = `import { ${effectiveName} } from './${effectiveName}';`;
      if (!rootContent.includes(importLine)) {
        const lastImportIdx = rootContent.lastIndexOf('import ');
        const lineEnd = rootContent.indexOf('\n', lastImportIdx);
        rootContent = rootContent.slice(0, lineEnd + 1) + importLine + '\n' + rootContent.slice(lineEnd + 1);
      }
      const compBlock = `      <Composition id="${compositionId}" component={${effectiveName}} durationInFrames={${result.durationInFrames}} fps={${fps}} width={${width}} height={${height}} defaultProps={{}} />`;
      if (!rootContent.includes(`id="${compositionId}"`)) {
        const closingIdx = rootContent.lastIndexOf('    </>');
        if (closingIdx !== -1) rootContent = rootContent.slice(0, closingIdx) + compBlock + '\n' + rootContent.slice(closingIdx);
      }
      fs.writeFileSync(rootPath, rootContent, 'utf-8');

      const entryPoint = path.join(srcDir, 'index.js');
      const newBundle = await bundle({ entryPoint, webpackOverride: (config) => config });

      const outputFile = path.join(__dirname, 'temp', `${jobId}.mp4`);
      const composition = await selectComposition({ serveUrl: newBundle, id: compositionId, inputProps: {} });

      await renderMedia({
        composition: { ...composition, durationInFrames: result.durationInFrames, fps, width, height },
        serveUrl: newBundle,
        codec,
        outputLocation: outputFile,
        inputProps: {},
        ...(crf !== undefined ? { crf } : {}),
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          const j = activeJobs.get(jobId);
          if (j) j.progress = pct;
          if (pct % 10 === 0 && supabase && projectId) {
            supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', jobId).then(() => {});
          }
        },
      });

      const videoUrl = buildVideoUrl(`${jobId}.mp4`);
      const j = activeJobs.get(jobId);
      if (j) { j.status = 'completed'; j.progress = 100; j.videoUrl = videoUrl; }

      if (supabase) {
        await supabase.from('remotion_render_jobs').update({
          status: 'completed', progress: 100, video_url: videoUrl, completed_at: new Date().toISOString(),
        }).eq('id', jobId);
        if (projectId) {
          const projectUpdate = { animator_video_url: videoUrl };
          if (result.tokens) projectUpdate.animator_tokens = result.tokens;
          if (result.costUsd != null) projectUpdate.animator_cost_usd = result.costUsd;
          await supabase.from('projects').update(projectUpdate).eq('id', projectId);
        }
      }
      console.log(`[Animator] Full pipeline complete: ${jobId} -> ${videoUrl} | cost: $${result.costUsd?.toFixed(4) || '?'}`);
    } catch (err) {
      console.error(`[Animator] Pipeline failed for ${jobId}:`, err.message);
      const j = activeJobs.get(jobId);
      if (j) { j.status = 'failed'; j.error = err.message; }
      if (supabase && projectId) {
        await supabase.from('remotion_render_jobs').update({ status: 'failed', error_message: err.message }).eq('id', jobId);
      }
    }
  })();
});

app.post('/animator/generate-scene', async (req, res) => {
  const {
    anthropicKey,
    geminiKey,
    segment,
    segIndex,
    totalSegments,
    brandingConfig,
    brandingMarkdown,
    extraPrompt,
    selectedSkills,
    model,
    projectId,
    neighborContext,
  } = req.body;

  if (!segment) return res.status(400).json({ error: 'segment is required' });
  if (segIndex == null) return res.status(400).json({ error: 'segIndex is required' });

  const effectiveModel = model || 'claude-sonnet-4-6';
  const useGemini = effectiveModel.startsWith('gemini-');

  if (useGemini && !geminiKey) return res.status(400).json({ error: 'geminiKey is required for Gemini models' });
  if (!useGemini && !anthropicKey) return res.status(400).json({ error: 'anthropicKey is required' });

  try {
    const { systemPrompt } = buildSystemPrompt(brandingConfig, extraPrompt, brandingMarkdown, selectedSkills);

    if (supabase && projectId) {
      await supabase.from('project_scenes').update({ animator_code_status: 'generating' })
        .eq('project_id', projectId).eq('scene_index', segIndex);
    }

    let result;
    if (useGemini) {
      result = await generateSingleSceneGemini(
        geminiKey, effectiveModel, systemPrompt, segment, segIndex + 1, totalSegments || 1, extraPrompt, neighborContext
      );
    } else {
      const client = new Anthropic({ apiKey: anthropicKey });
      result = await generateSingleScene(
        client, effectiveModel, systemPrompt, segment, segIndex + 1, totalSegments || 1, extraPrompt, neighborContext
      );
    }

    if (result.error) {
      if (supabase && projectId) {
        await supabase.from('project_scenes').update({
          animator_code_status: 'failed', animator_code: result.code || result.error,
        }).eq('project_id', projectId).eq('scene_index', segIndex);
      }
      return res.status(422).json({ success: false, error: result.error, code: result.code || null });
    }

    if (supabase && projectId) {
      await supabase.from('project_scenes').update({
        animator_code_status: 'completed', animator_code: result.code,
      }).eq('project_id', projectId).eq('scene_index', segIndex);

      const { data: proj } = await supabase.from('projects').select('animator_tokens, animator_cost_usd').eq('id', projectId).single();
      const prev = proj?.animator_tokens || { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };
      const t = result.tokens;
      const merged = {
        input: (prev.input || 0) + t.input,
        output: (prev.output || 0) + t.output,
        cacheRead: (prev.cacheRead || 0) + t.cacheRead,
        cacheCreated: (prev.cacheCreated || 0) + t.cacheCreated,
      };
      const prices = getModelPrices(effectiveModel);
      const newCost = useGemini
        ? (merged.input * prices.input / 1_000_000) + (merged.output * prices.output / 1_000_000)
        : (merged.input * prices.input / 1_000_000) +
          (merged.output * prices.output / 1_000_000) +
          (merged.cacheCreated * prices.cacheWrite / 1_000_000) +
          (merged.cacheRead * prices.cacheRead / 1_000_000);
      await supabase.from('projects').update({
        animator_tokens: merged,
        animator_cost_usd: newCost,
      }).eq('id', projectId);
    }

    res.json({ success: true, code: result.code, segName: result.segName, tokens: result.tokens });
  } catch (err) {
    console.error(`[Animator] Single scene generation error:`, err.message);
    if (supabase && projectId) {
      await supabase.from('project_scenes').update({
        animator_code_status: 'failed', animator_code: err.message,
      }).eq('project_id', projectId).eq('scene_index', segIndex);
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/animator/render-assembled', async (req, res) => {
  const {
    projectId,
    userId,
    componentName,
    audioUrl,
    brandingConfig,
    fps = 30,
    width = 1920,
    height = 1080,
    codec = 'h264',
    crf,
  } = req.body;

  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  if (!bundleLocation) return res.status(503).json({ error: 'Bundle not ready' });

  const jobId = `animator-render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const effectiveName = componentName || `AnimAssembled${Date.now().toString(36)}`;
  const compositionId = effectiveName.replace(/_/g, '-');

  try {
    const { data: sceneRows, error: sceneErr } = await supabase
      .from('project_scenes')
      .select('scene_index, animator_code, animator_code_status')
      .eq('project_id', projectId)
      .not('animator_code_status', 'is', null)
      .order('scene_index', { ascending: true });

    if (sceneErr || !sceneRows?.length) {
      return res.status(400).json({ error: 'No animator scene codes found for this project' });
    }

    const incomplete = sceneRows.filter(s => s.animator_code_status !== 'completed');
    if (incomplete.length > 0) {
      return res.status(400).json({
        error: `${incomplete.length} scene(s) not yet completed`,
        incompleteScenes: incomplete.map(s => ({ scene_index: s.scene_index, status: s.animator_code_status })),
      });
    }

    const { data: project } = await supabase.from('projects').select('scenes, audio_url').eq('id', projectId).single();
    const segments = (project?.scenes || []).map(s => ({ start: s.startTime, end: s.endTime, text: s.text || '' }));
    if (segments.length === 0) {
      return res.status(400).json({ error: 'No scenes found in project' });
    }

    const allComponentsCode = sceneRows.map(s => s.animator_code).join('\n\n');
    let resolvedAudioFilename = null;
    const audioSource = audioUrl || project?.audio_url;
    if (audioSource) {
      try {
        const audioResp = await fetch(audioSource);
        if (audioResp.ok) {
          const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
          resolvedAudioFilename = `${jobId}-audio.mp3`;
          const publicDir = path.join(__dirname, 'public');
          if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(path.join(publicDir, resolvedAudioFilename), audioBuffer);
        }
      } catch (e) {
        console.warn(`[Animator] Failed to download audio: ${e.message}`);
      }
    }

    const totalDuration = segments[segments.length - 1].end;
    const durationInFrames = Math.ceil(totalDuration * fps);
    const finalCode = buildWrapper(effectiveName, segments, resolvedAudioFilename, fps, allComponentsCode, brandingConfig);

    if (userId) {
      await supabase.from('remotion_render_jobs').insert({
        id: jobId, user_id: userId, project_id: projectId,
        status: 'rendering', composition_id: effectiveName,
        generated_code: finalCode, duration_in_frames: durationInFrames, fps, width, height,
      }).then(() => {});
    }

    activeJobs.set(jobId, { status: 'rendering', progress: 0, startedAt: Date.now(), compositionId });

    res.json({ success: true, jobId, status: 'rendering', durationInFrames });

    (async () => {
      try {
        const srcDir = path.join(__dirname, 'src');

        const namePrefix = effectiveName.replace(/[a-z0-9]{6,12}$/i, '');
        if (namePrefix.length >= 8) {
          const oldFiles = fs.readdirSync(srcDir).filter(f => f.startsWith(namePrefix) && f.endsWith('.tsx') && f !== `${effectiveName}.tsx`);
          if (oldFiles.length > 0) {
            const rootPath = path.join(srcDir, 'Root.jsx');
            let rootClean = fs.readFileSync(rootPath, 'utf-8');
            for (const f of oldFiles) {
              const oldName = f.replace('.tsx', '');
              fs.unlinkSync(path.join(srcDir, f));
              rootClean = rootClean.split('\n').filter(line => !line.includes(oldName)).join('\n');
            }
            fs.writeFileSync(rootPath, rootClean, 'utf-8');
          }
        }

        fs.writeFileSync(path.join(srcDir, `${effectiveName}.tsx`), finalCode, 'utf-8');

        const rootPath = path.join(srcDir, 'Root.jsx');
        let rootContent = fs.readFileSync(rootPath, 'utf-8');
        const importLine = `import { ${effectiveName} } from './${effectiveName}';`;
        if (!rootContent.includes(importLine)) {
          const lastImportIdx = rootContent.lastIndexOf('import ');
          const lineEnd = rootContent.indexOf('\n', lastImportIdx);
          rootContent = rootContent.slice(0, lineEnd + 1) + importLine + '\n' + rootContent.slice(lineEnd + 1);
        }
        const compBlock = `      <Composition id="${compositionId}" component={${effectiveName}} durationInFrames={${durationInFrames}} fps={${fps}} width={${width}} height={${height}} defaultProps={{}} />`;
        if (!rootContent.includes(`id="${compositionId}"`)) {
          const closingIdx = rootContent.lastIndexOf('    </>');
          if (closingIdx !== -1) rootContent = rootContent.slice(0, closingIdx) + compBlock + '\n' + rootContent.slice(closingIdx);
        }
        fs.writeFileSync(rootPath, rootContent, 'utf-8');

        console.log(`[Animator] Re-bundling assembled composition: ${effectiveName}`);
        const entryPoint = path.join(srcDir, 'index.js');
        const newBundle = await bundle({ entryPoint, webpackOverride: (config) => config });

        const outputFile = path.join(__dirname, 'temp', `${jobId}.mp4`);
        const composition = await selectComposition({ serveUrl: newBundle, id: compositionId, inputProps: {} });

        await renderMedia({
          composition: { ...composition, durationInFrames, fps, width, height },
          serveUrl: newBundle, codec, outputLocation: outputFile, inputProps: {},
          ...(crf !== undefined ? { crf } : {}),
          onProgress: ({ progress }) => {
            const pct = Math.round(progress * 100);
            const j = activeJobs.get(jobId);
            if (j) j.progress = pct;
            if (pct % 10 === 0 && supabase) {
              supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', jobId).then(() => {});
            }
          },
        });

        const videoUrl = buildVideoUrl(`${jobId}.mp4`);
        const j = activeJobs.get(jobId);
        if (j) { j.status = 'completed'; j.progress = 100; j.videoUrl = videoUrl; j.completedAt = Date.now(); }

        if (supabase) {
          await supabase.from('remotion_render_jobs').update({
            status: 'completed', progress: 100, video_url: videoUrl, completed_at: new Date().toISOString(),
          }).eq('id', jobId);
          if (projectId) {
            await supabase.from('projects').update({ animator_video_url: videoUrl }).eq('id', projectId);
          }
        }
        console.log(`[Animator] Assembled render complete: ${jobId} -> ${videoUrl}`);
      } catch (err) {
        console.error(`[Animator] Assembled render failed for ${jobId}:`, err.message);
        const j = activeJobs.get(jobId);
        if (j) { j.status = 'failed'; j.error = err.message; }
        if (supabase) {
          await supabase.from('remotion_render_jobs').update({ status: 'failed', error_message: err.message }).eq('id', jobId);
        }
      }
    })();
  } catch (err) {
    console.error(`[Animator] Render-assembled setup failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Preview bundle: serve Remotion Player in browser ---
const crypto = require('crypto');
const PREVIEW_DIR = path.join(__dirname, 'preview-bundles');
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
app.use('/preview-bundles', express.static(PREVIEW_DIR));

const previewCache = new Map();

app.post('/animator/preview-bundle', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

  try {
    const { data: sceneRows, error: sceneErr } = await supabase
      .from('project_scenes')
      .select('scene_index, animator_code, animator_code_status')
      .eq('project_id', projectId)
      .eq('animator_code_status', 'completed')
      .order('scene_index', { ascending: true });

    if (sceneErr || !sceneRows?.length) {
      return res.status(400).json({ error: 'No completed animator scenes found' });
    }

    const { data: project } = await supabase.from('projects').select('scenes, audio_url').eq('id', projectId).single();
    const segments = (project?.scenes || []).map(s => ({ start: s.startTime, end: s.endTime, text: s.text || '' }));
    if (segments.length === 0) return res.status(400).json({ error: 'No scenes in project' });

    const allCode = sceneRows.map(s => s.animator_code).join('\n\n');
    const codeHash = crypto.createHash('md5').update(allCode).digest('hex').slice(0, 12);

    const cached = previewCache.get(projectId);
    const cachedIndexExists = cached && fs.existsSync(path.join(PREVIEW_DIR, cached.hash, 'index.html'));
    if (cached && cached.hash === codeHash && cachedIndexExists) {
      console.log(`[Preview] Cache hit for ${projectId} (${codeHash})`);
      return res.json(cached.result);
    }

    const compName = `Preview_${codeHash}`;
    const fps = 30;
    const totalDuration = segments[segments.length - 1].end;
    const durationInFrames = Math.ceil(totalDuration * fps);

    const { data: calEntry } = await supabase
      .from('content_calendar').select('channel_id')
      .eq('project_id', projectId).not('channel_id', 'is', null).limit(1).single();
    let brandingConfig = null;
    if (calEntry?.channel_id) {
      const { data: ch } = await supabase.from('channels').select('animator_preset_id').eq('id', calEntry.channel_id).single();
      if (ch?.animator_preset_id) {
        const { data: preset } = await supabase.from('animator_presets').select('branding_config').eq('id', ch.animator_preset_id).single();
        if (preset) brandingConfig = preset.branding_config;
      }
    }

    const previewDir = path.join(PREVIEW_DIR, codeHash);
    if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

    const publicDir = path.join(previewDir, 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

    // Download audio into the preview bundle's public dir
    let audioFilename = null;
    const audioSource = project?.audio_url;
    if (audioSource) {
      try {
        const audioResp = await fetch(audioSource);
        if (audioResp.ok) {
          const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
          audioFilename = `preview-${codeHash}-audio.mp3`;
          fs.writeFileSync(path.join(publicDir, audioFilename), audioBuffer);
        }
      } catch (e) {
        console.warn(`[Preview] Failed to download audio: ${e.message}`);
      }
    }

    let compositionCode = buildWrapper(compName, segments, audioFilename, fps, allCode, brandingConfig);

    // Replace staticFile() with absolute URL so audio works reliably in the iframe Player
    if (audioFilename) {
      const audioAbsoluteUrl = `${PUBLIC_BASE_URL
        ? PUBLIC_BASE_URL.replace('/remotion-renders', '/remotion-preview')
        : `http://localhost:${PORT}/preview-bundles`}/${codeHash}/public/${audioFilename}`;
      compositionCode = compositionCode.replace(
        `staticFile(${JSON.stringify(audioFilename)})`,
        JSON.stringify(audioAbsoluteUrl)
      );
    }

    const srcDir = path.join(previewDir, 'src');
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, `${compName}.tsx`), compositionCode, 'utf-8');

    // Player entry: renders @remotion/player + posts current frame to parent + speed controls
    fs.writeFileSync(path.join(srcDir, 'player-entry.jsx'), `
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from '@remotion/player';
import { ${compName} } from './${compName}';

const SPEEDS = [0.5, 1, 2, 4];

const App = () => {
  const playerRef = useRef(null);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let last = -1;
    let id;
    const tick = () => {
      const f = playerRef.current?.getCurrentFrame?.() ?? 0;
      if (f !== last) {
        window.parent.postMessage({ type: 'remotion-frame', frame: f }, '*');
        last = f;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'remotion-seek' && typeof e.data.frame === 'number') {
        playerRef.current?.seekTo?.(e.data.frame);
      }
      if (e.data?.type === 'remotion-pause') {
        playerRef.current?.pause?.();
      }
      if (e.data?.type === 'remotion-play') {
        playerRef.current?.play?.();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length];
    });
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a0f', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: '100%', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Player
          ref={playerRef}
          component={${compName}}
          durationInFrames={${durationInFrames}}
          fps={${fps}}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{ width: '100%', maxHeight: '100vh' }}
          controls
          autoPlay
          loop
          playbackRate={speed}
          renderLoading={({ width, height }) => (
            <div style={{ width, height, background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ color: '#a855f7', fontSize: 14 }}>Chargement...</div>
            </div>
          )}
          errorFallback={({ error }) => (
            <div style={{ width: '100%', height: '100%', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: '#f59e0b', fontSize: 14 }}>Erreur de rendu</div>
              <div style={{ color: '#666', fontSize: 11, maxWidth: 400, textAlign: 'center', wordBreak: 'break-word' }}>{error?.message?.substring(0, 120) || 'Erreur inconnue'}</div>
            </div>
          )}
        />
        <div style={{
          position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 10,
        }}>
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: s === speed ? 700 : 400,
                background: s === speed ? 'rgba(168,85,247,0.85)' : 'rgba(0,0,0,0.55)',
                color: '#fff',
                border: s === speed ? '1px solid rgba(168,85,247,1)' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
                transition: 'all 0.15s',
              }}
            >
              {s === 0.5 ? '½' : s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('container') || document.getElementById('root') || document.body;
createRoot(container).render(<App />);
`, 'utf-8');

    console.log(`[Preview] Bundling player for ${projectId} (${codeHash})...`);
    const bundlePath = await bundle({
      entryPoint: path.join(srcDir, 'player-entry.jsx'),
      webpackOverride: (config) => config,
      ignoreRegisterRootWarning: true,
      rootDir: previewDir,
      publicDir: path.join(previewDir, 'public'),
    });

    const bundleFiles = fs.readdirSync(bundlePath);
    for (const f of bundleFiles) {
      const src = path.join(bundlePath, f);
      const dest = path.join(previewDir, f);
      if (fs.lstatSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      } else if (fs.lstatSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    // Rewrite index.html: absolute → relative paths for subdirectory serving
    const indexPath = path.join(previewDir, 'index.html');
    let indexHtml = fs.readFileSync(indexPath, 'utf-8');
    indexHtml = indexHtml
      .replace(/href="\//g, 'href="./')
      .replace(/src="\//g, 'src="./')
      .replace(/window\.remotion_publicPath\s*=\s*"\/"/g, 'window.remotion_publicPath = "./"')
      .replace(/window\.remotion_staticBase\s*=\s*"\/public"/g, 'window.remotion_staticBase = "./public"')
      .replace(/window\.remotion_publicFolderExists\s*=\s*"\/public"/g, 'window.remotion_publicFolderExists = "./public"')
      .replace(/"src":"\/public\//g, '"src":"./public/')
      .replace(/remotion_numberOfAudioTags\s*=\s*0/g, 'remotion_numberOfAudioTags = 5');
    fs.writeFileSync(indexPath, indexHtml, 'utf-8');

    const baseUrl = PUBLIC_BASE_URL
      ? PUBLIC_BASE_URL.replace('/remotion-renders', '/remotion-preview')
      : `http://localhost:${PORT}/preview-bundles`;
    const previewUrl = `${baseUrl}/${codeHash}/index.html`;

    const result = { success: true, previewUrl, hash: codeHash, durationInFrames, fps, totalDuration, segments };
    previewCache.set(projectId, { hash: codeHash, result });
    console.log(`[Preview] Bundle ready: ${previewUrl}`);
    res.json(result);
  } catch (err) {
    console.error(`[Preview] Bundle failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Edit scene via AI chat ---
app.post('/animator/edit-scene', async (req, res) => {
  const { projectId, sceneIndex, instruction, model, screenshotUrl } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (sceneIndex == null) return res.status(400).json({ error: 'sceneIndex is required' });
  if (!instruction) return res.status(400).json({ error: 'instruction is required' });
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

  try {
    const { data: scene, error: sceneErr } = await supabase
      .from('project_scenes')
      .select('animator_code, animator_code_status')
      .eq('project_id', projectId)
      .eq('scene_index', sceneIndex)
      .single();

    if (sceneErr || !scene?.animator_code) {
      return res.status(400).json({ error: 'Scene not found or has no code' });
    }

    // Resolve model + API key from channel preset
    const { data: calEntry } = await supabase
      .from('content_calendar').select('channel_id')
      .eq('project_id', projectId).not('channel_id', 'is', null).limit(1).single();

    let resolvedModel = model || 'claude-sonnet-4-6';
    let anthropicKey = null;
    let geminiKey = null;

    if (calEntry?.channel_id) {
      const { data: ch } = await supabase.from('channels').select('animator_preset_id').eq('id', calEntry.channel_id).single();
      if (ch?.animator_preset_id) {
        const { data: preset } = await supabase.from('animator_presets').select('model').eq('id', ch.animator_preset_id).single();
        if (preset?.model && !model) resolvedModel = preset.model;
      }
    }

    // Fetch user API key via Vault RPC (same as image-worker)
    const { data: proj } = await supabase.from('projects').select('user_id').eq('id', projectId).single();
    if (proj?.user_id) {
      const useGemini = resolvedModel.startsWith('gemini-');
      const keyName = useGemini ? 'gemini' : 'anthropic';
      const rpcName = keyName === 'gemini' ? 'get_user_api_key' : 'get_user_api_key_for_service';
      const params = keyName === 'gemini'
        ? { key_name: keyName, p_user_id: proj.user_id }
        : { target_user_id: proj.user_id, key_name: keyName };
      const { data: keyData } = await supabase.rpc(rpcName, params);
      if (keyData) {
        if (useGemini) geminiKey = keyData;
        else anthropicKey = keyData;
      }
    }

    const useGemini = resolvedModel.startsWith('gemini-');
    if (useGemini && !geminiKey) return res.status(400).json({ error: 'No Gemini API key found' });
    if (!useGemini && !anthropicKey) return res.status(400).json({ error: 'No Anthropic API key found' });

    const segName = `Seg${sceneIndex + 1}`;
    const editSystemPrompt = `You are editing an existing Remotion animation component.
The user will give you the current code and an instruction for what to change.
Return ONLY the modified function code. Keep the same function name (${segName}).
NO imports, NO exports — just the plain function declaration.
Follow these rules:
- interpolate() outputRange MUST contain ONLY numbers, NEVER strings.
- Write plain JSX only. NO TypeScript annotations.
- Do NOT use markdown code fences.
- Do NOT add comments explaining your changes.`;

    const userMessage = `Current code for ${segName}:\n\`\`\`\n${scene.animator_code}\n\`\`\`\n\nInstruction: ${instruction}`;

    // Download screenshot for vision if provided
    let screenshotBase64 = null;
    let screenshotMime = 'image/png';
    if (screenshotUrl) {
      try {
        const imgResp = await fetch(screenshotUrl);
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          screenshotBase64 = buf.toString('base64');
          screenshotMime = imgResp.headers.get('content-type') || 'image/png';
        }
      } catch (e) {
        console.warn(`[Edit] Failed to download screenshot: ${e.message}`);
      }
    }

    console.log(`[Edit] Editing scene ${sceneIndex} for ${projectId} with ${resolvedModel}${screenshotBase64 ? ' + screenshot' : ''}`);

    let newCode;
    let editTokens = { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };

    if (useGemini) {
      const userParts = [];
      if (screenshotBase64) {
        userParts.push({ inlineData: { mimeType: screenshotMime, data: screenshotBase64 } });
        userParts.push({ text: 'Above is a screenshot of the current animation render. Use it to understand the visual issue.\n\n' + userMessage });
      } else {
        userParts.push({ text: userMessage });
      }
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: editSystemPrompt }] },
            contents: [{ role: 'user', parts: userParts }],
            tools: [{
              functionDeclarations: [{
                name: 'write_segment_components',
                description: 'Write the modified Remotion segment component function',
                parameters: {
                  type: 'OBJECT',
                  properties: { components_code: { type: 'STRING', description: 'Modified function code' } },
                  required: ['components_code'],
                },
              }],
            }],
            toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['write_segment_components'] } },
            generationConfig: { maxOutputTokens: 16000 },
          }),
        }
      );
      if (!response.ok) throw new Error(`Gemini error ${response.status}: ${(await response.text()).substring(0, 300)}`);
      const data = await response.json();
      const fnCall = data.candidates?.[0]?.content?.parts?.find(p => p.functionCall);
      if (!fnCall) throw new Error('Gemini returned no function call');
      newCode = fnCall.functionCall.args.components_code;
      const usage = data.usageMetadata;
      if (usage) {
        editTokens.input = usage.promptTokenCount || 0;
        editTokens.output = usage.candidatesTokenCount || 0;
      }
    } else {
      const client = new Anthropic({ apiKey: anthropicKey });
      const userContent = [];
      if (screenshotBase64) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: screenshotMime, data: screenshotBase64 },
        });
        userContent.push({
          type: 'text',
          text: 'Above is a screenshot of the current animation render. Use it to understand the visual issue.\n\n' + userMessage,
        });
      } else {
        userContent.push({ type: 'text', text: userMessage });
      }
      const stream = client.messages.stream({
        model: resolvedModel,
        max_tokens: 16000,
        system: [{ type: 'text', text: editSystemPrompt }],
        messages: [{ role: 'user', content: userContent }],
        tools: [{
          name: 'write_segment_components',
          description: 'Write the modified Remotion segment component function',
          input_schema: {
            type: 'object',
            properties: { components_code: { type: 'string', description: 'Modified function code' } },
            required: ['components_code'],
          },
        }],
        tool_choice: { type: 'tool', name: 'write_segment_components' },
      });
      const response = await stream.finalMessage();
      const toolBlock = response.content.find(b => b.type === 'tool_use');
      if (!toolBlock?.input?.components_code) throw new Error('Claude returned no tool call');
      newCode = toolBlock.input.components_code;
      if (response.usage) {
        editTokens.input = response.usage.input_tokens || 0;
        editTokens.output = response.usage.output_tokens || 0;
        editTokens.cacheRead = response.usage.cache_read_input_tokens || 0;
        editTokens.cacheCreated = response.usage.cache_creation_input_tokens || 0;
      }
    }

    // Strip markdown fences if present
    newCode = newCode.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();

    // Validate function name
    if (!newCode.includes(`function ${segName}`) && !newCode.includes(`const ${segName}`)) {
      console.warn(`[Edit] Warning: output may not contain ${segName}`);
    }

    await supabase.from('project_scenes').update({
      animator_code: newCode,
      animator_code_status: 'completed',
    }).eq('project_id', projectId).eq('scene_index', sceneIndex);

    // Update tokens + cost (merge with existing)
    const { data: projCost } = await supabase.from('projects').select('animator_tokens, animator_cost_usd').eq('id', projectId).single();
    const prev = projCost?.animator_tokens || { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };
    const merged = {
      input: (prev.input || 0) + editTokens.input,
      output: (prev.output || 0) + editTokens.output,
      cacheRead: (prev.cacheRead || 0) + editTokens.cacheRead,
      cacheCreated: (prev.cacheCreated || 0) + editTokens.cacheCreated,
    };
    const prices = getModelPrices(resolvedModel);
    const newCost = useGemini
      ? (merged.input * prices.input / 1_000_000) + (merged.output * prices.output / 1_000_000)
      : (merged.input * prices.input / 1_000_000) +
        (merged.output * prices.output / 1_000_000) +
        (merged.cacheCreated * prices.cacheWrite / 1_000_000) +
        (merged.cacheRead * prices.cacheRead / 1_000_000);
    await supabase.from('projects').update({
      animator_tokens: merged,
      animator_cost_usd: newCost,
    }).eq('id', projectId);

    // Invalidate preview cache
    previewCache.delete(projectId);

    console.log(`[Edit] Scene ${sceneIndex} updated for ${projectId} (${newCode.length} chars, +${editTokens.input}/${editTokens.output} tokens)`);
    res.json({ success: true, sceneIndex, codeLength: newCode.length, tokens: editTokens });
  } catch (err) {
    console.error(`[Edit] Failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- QA Screenshots: capture one frame per scene at 80% ---
// Optional: pass sceneIndex to re-capture a single scene only
app.post('/animator/qa-screenshots', async (req, res) => {
  const { projectId, sceneIndex: singleSceneIndex } = req.body;
  const singleMode = singleSceneIndex != null;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });

  try {
    const { data: sceneRows, error: sceneErr } = await supabase
      .from('project_scenes')
      .select('scene_index, animator_code, animator_code_status')
      .eq('project_id', projectId)
      .eq('animator_code_status', 'completed')
      .order('scene_index', { ascending: true });

    if (sceneErr || !sceneRows?.length) {
      return res.status(400).json({ error: 'No completed animator scenes found' });
    }

    const { data: project } = await supabase.from('projects').select('scenes').eq('id', projectId).single();
    const segments = (project?.scenes || []).map(s => ({ start: s.startTime, end: s.endTime, text: s.text || '' }));
    if (segments.length === 0) return res.status(400).json({ error: 'No scenes in project' });

    const fps = 30;
    const totalDuration = segments[segments.length - 1].end;
    const durationInFrames = Math.ceil(totalDuration * fps);
    const allCode = sceneRows.map(s => s.animator_code).join('\n\n');

    // Branding config from channel preset
    const { data: calEntry } = await supabase
      .from('content_calendar').select('channel_id')
      .eq('project_id', projectId).not('channel_id', 'is', null).limit(1).single();
    let brandingConfig = null;
    if (calEntry?.channel_id) {
      const { data: ch } = await supabase.from('channels').select('animator_preset_id').eq('id', calEntry.channel_id).single();
      if (ch?.animator_preset_id) {
        const { data: preset } = await supabase.from('animator_presets').select('branding_config').eq('id', ch.animator_preset_id).single();
        if (preset) brandingConfig = preset.branding_config;
      }
    }

    const codeHash = crypto.createHash('md5').update(allCode).digest('hex').slice(0, 12);
    const qaDir = path.join(PREVIEW_DIR, `${codeHash}-qa`);
    const manifestPath = path.join(qaDir, 'manifest.json');

    // For full mode only: check cache
    if (!singleMode && fs.existsSync(manifestPath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (cached.screenshots?.length === sceneRows.length) {
          console.log(`[QA] Cache hit for ${projectId} (${codeHash})`);
          return res.json(cached);
        }
      } catch (e) { /* ignore corrupt cache */ }
    }

    if (!fs.existsSync(qaDir)) fs.mkdirSync(qaDir, { recursive: true });

    // Build composition (no audio needed for screenshots)
    const compName = `QAComp${codeHash}`;
    const compositionId = compName;
    const compositionCode = buildWrapper(compName, segments, null, fps, allCode, brandingConfig);

    const srcDir = path.join(qaDir, 'src');
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, `${compName}.tsx`), compositionCode, 'utf-8');

    fs.writeFileSync(path.join(srcDir, 'index.js'), `
import { registerRoot } from 'remotion';
import { Composition } from 'remotion';
import React from 'react';
import { ${compName} } from './${compName}';

const Root = () => (
  <>
    <Composition id="${compositionId}" component={${compName}} durationInFrames={${durationInFrames}} fps={${fps}} width={1920} height={1080} />
  </>
);

registerRoot(Root);
`, 'utf-8');

    console.log(`[QA] Bundling composition for ${projectId} (${singleMode ? `scene ${singleSceneIndex}` : `${sceneRows.length} scenes`})...`);
    const qaBundlePath = await bundle({
      entryPoint: path.join(srcDir, 'index.js'),
      webpackOverride: (config) => config,
      rootDir: qaDir,
    });

    const composition = await selectComposition({
      serveUrl: qaBundlePath,
      id: compositionId,
      inputProps: {},
    });

    const baseUrl = PUBLIC_BASE_URL
      ? PUBLIC_BASE_URL.replace('/remotion-renders', '/remotion-preview')
      : `http://localhost:${PORT}/preview-bundles`;

    // --- Single scene mode ---
    if (singleMode) {
      const seg = segments[singleSceneIndex];
      if (!seg) return res.status(400).json({ error: `Scene ${singleSceneIndex} not found in segments` });
      const targetTime = seg.start + (seg.end - seg.start) * 0.8;
      const targetFrame = Math.min(Math.round(targetTime * fps), durationInFrames - 1);
      const outputFile = path.join(qaDir, `scene_${String(singleSceneIndex).padStart(3, '0')}.png`);

      try {
        await renderStill({
          composition: { ...composition, durationInFrames, fps, width: 1920, height: 1080 },
          serveUrl: qaBundlePath,
          frame: targetFrame,
          output: outputFile,
          imageFormat: 'png',
          scale: 0.5,
        });
        const url = `${baseUrl}/${codeHash}-qa/scene_${String(singleSceneIndex).padStart(3, '0')}.png?t=${Date.now()}`;
        console.log(`[QA] Single screenshot done for scene ${singleSceneIndex}`);
        return res.json({ success: true, screenshot: { sceneIndex: singleSceneIndex, timestamp: targetTime, success: true, url } });
      } catch (err) {
        console.warn(`[QA] Single scene ${singleSceneIndex} screenshot failed: ${err.message}`);
        return res.json({ success: true, screenshot: { sceneIndex: singleSceneIndex, timestamp: targetTime, success: false, url: null, error: err.message } });
      }
    }

    // --- Full mode: capture all scenes ---
    const screenshots = [];
    const BATCH_SIZE = 5;

    for (let batchStart = 0; batchStart < segments.length; batchStart += BATCH_SIZE) {
      const batch = segments.slice(batchStart, batchStart + BATCH_SIZE);
      const batchPromises = batch.map(async (seg, batchIdx) => {
        const sceneIndex = batchStart + batchIdx;
        const targetTime = seg.start + (seg.end - seg.start) * 0.8;
        const targetFrame = Math.min(Math.round(targetTime * fps), durationInFrames - 1);
        const outputFile = path.join(qaDir, `scene_${String(sceneIndex).padStart(3, '0')}.png`);

        try {
          await renderStill({
            composition: { ...composition, durationInFrames, fps, width: 1920, height: 1080 },
            serveUrl: qaBundlePath,
            frame: targetFrame,
            output: outputFile,
            imageFormat: 'png',
            scale: 0.5,
          });
          return { sceneIndex, timestamp: targetTime, success: true };
        } catch (err) {
          console.warn(`[QA] Scene ${sceneIndex} screenshot failed: ${err.message}`);
          return { sceneIndex, timestamp: targetTime, success: false, error: err.message };
        }
      });
      const batchResults = await Promise.all(batchPromises);
      screenshots.push(...batchResults);
    }

    const result = {
      success: true,
      total: screenshots.length,
      completed: screenshots.filter(s => s.success).length,
      failed: screenshots.filter(s => !s.success).length,
      screenshots: screenshots.map(s => ({
        ...s,
        url: s.success ? `${baseUrl}/${codeHash}-qa/scene_${String(s.sceneIndex).padStart(3, '0')}.png` : null,
      })),
    };

    // Save manifest for caching
    fs.writeFileSync(manifestPath, JSON.stringify(result), 'utf-8');

    console.log(`[QA] Screenshots done for ${projectId}: ${result.completed}/${result.total} OK`);
    res.json(result);
  } catch (err) {
    console.error(`[QA] Failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Worker mode: poll Supabase for pending remotion jobs ---
let workerInterval = null;
const WORKER_POLL_MS = parseInt(process.env.WORKER_POLL_MS || '5000', 10);
const WORKER_ENABLED = process.env.WORKER_MODE === 'true';

async function pollForJobs() {
  if (!supabase || !bundleLocation) return;
  if (activeJobs.size > 0) {
    const rendering = [...activeJobs.values()].filter(j => j.status === 'rendering');
    if (rendering.length >= (parseInt(process.env.MAX_CONCURRENT_RENDERS || '2', 10))) return;
  }

  try {
    const { data: jobs, error } = await supabase
      .from('remotion_render_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error || !jobs || jobs.length === 0) return;

    const job = jobs[0];
    console.log(`[Worker] Claimed job ${job.id} (composition: ${job.composition_id})`);

    await supabase.from('remotion_render_jobs').update({ status: 'claimed' }).eq('id', job.id);

    const outputFile = path.join(TEMP_DIR, `${job.id}.mp4`);

    activeJobs.set(job.id, {
      status: 'rendering',
      progress: 0,
      startedAt: Date.now(),
      compositionId: job.composition_id,
    });

    try {
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: job.composition_id,
        inputProps: job.input_props || {},
      });

      const finalDuration = job.duration_in_frames || composition.durationInFrames;
      const finalFps = job.fps || composition.fps;
      const finalWidth = job.width || composition.width;
      const finalHeight = job.height || composition.height;

      await supabase.from('remotion_render_jobs').update({ status: 'rendering', progress: 0 }).eq('id', job.id);

      await renderMedia({
        composition: {
          ...composition,
          durationInFrames: finalDuration,
          fps: finalFps,
          width: finalWidth,
          height: finalHeight,
        },
        serveUrl: bundleLocation,
        codec: job.codec || 'h264',
        outputLocation: outputFile,
        inputProps: job.input_props || {},
        ...(job.crf !== undefined ? { crf: job.crf } : {}),
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          const activeJob = activeJobs.get(job.id);
          if (activeJob) activeJob.progress = pct;

          if (pct % 10 === 0) {
            supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', job.id).then(() => {});
          }
        },
      });

      const videoUrl = buildVideoUrl(`${job.id}.mp4`);

      activeJobs.get(job.id).status = 'completed';
      activeJobs.get(job.id).progress = 100;
      activeJobs.get(job.id).videoUrl = videoUrl;

      await supabase.from('remotion_render_jobs').update({
        status: 'completed',
        progress: 100,
        video_url: videoUrl,
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);

      console.log(`[Worker] Job ${job.id} completed: ${videoUrl}`);
    } catch (err) {
      console.error(`[Worker] Job ${job.id} failed:`, err);
      activeJobs.get(job.id).status = 'failed';
      activeJobs.get(job.id).error = err.message;

      await supabase.from('remotion_render_jobs').update({
        status: 'failed',
        error_message: err.message,
      }).eq('id', job.id);
    }
  } catch (err) {
    console.error('[Worker] Poll error:', err.message);
  }
}

// --- Startup ---
(async () => {
  try {
    await initBrowser();
    await initBundle();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Remotion] Service running on port ${PORT}`);
      console.log(`[Remotion] Worker mode: ${WORKER_ENABLED ? 'ON' : 'OFF'}`);
    });

    if (WORKER_ENABLED) {
      console.log(`[Worker] Polling every ${WORKER_POLL_MS}ms for pending jobs`);
      workerInterval = setInterval(pollForJobs, WORKER_POLL_MS);
    }
  } catch (err) {
    console.error('[Remotion] Failed to start:', err);
    process.exit(1);
  }
})();

process.on('SIGTERM', () => {
  console.log('[Remotion] SIGTERM received, shutting down...');
  if (workerInterval) clearInterval(workerInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Remotion] SIGINT received, shutting down...');
  if (workerInterval) clearInterval(workerInterval);
  process.exit(0);
});
