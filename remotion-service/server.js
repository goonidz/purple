const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, getCompositions, ensureBrowser } = require('@remotion/renderer');

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
const { generateComposition, generateSingleScene, validateComponentCode, buildWrapper, stripSharedDeclarations } = require('./animator/claude-generator');
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

// --- Animator: per-scene generation ---

const SCENE_CONCURRENCY = parseInt(process.env.SCENE_CONCURRENCY || '5', 10);

app.post('/animator/generate-all-scenes', async (req, res) => {
  const {
    anthropicKey,
    segments,
    componentName,
    audioUrl,
    brandingConfig,
    brandingMarkdown,
    extraPrompt,
    selectedSkills,
    model,
    fps = 30,
    width = 1920,
    height = 1080,
    projectId,
    userId,
  } = req.body;

  if (!anthropicKey) return res.status(400).json({ error: 'anthropicKey is required' });
  if (!segments || segments.length === 0) return res.status(400).json({ error: 'segments are required' });
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  const jobId = `animator-scenes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const effectiveName = componentName || `Anim${jobId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const effectiveModel = model || 'claude-sonnet-4-6';

  activeJobs.set(jobId, { status: 'generating', progress: 0, startedAt: Date.now(), totalScenes: segments.length, completedScenes: 0, failedScenes: 0 });

  if (supabase && userId) {
    await supabase.from('remotion_render_jobs').insert({
      id: jobId, user_id: userId, project_id: projectId,
      status: 'generating', composition_id: effectiveName,
      input_props: { segments, brandingConfig, extraPrompt }, fps, width, height,
    }).then(() => {});
  }

  res.json({ success: true, jobId, status: 'generating', totalScenes: segments.length });

  (async () => {
    try {
      const { systemPrompt, skillsLoaded } = buildSystemPrompt(brandingConfig, extraPrompt, brandingMarkdown, selectedSkills);
      const client = new Anthropic({ apiKey: anthropicKey });

      console.log(`[Animator] Per-scene generation "${effectiveName}" | ${segments.length} scenes | model: ${effectiveModel} | concurrency: ${SCENE_CONCURRENCY}`);
      console.log(`  Skills: ${skillsLoaded.join(', ')}`);

      if (supabase) {
        const upserts = segments.map((_, i) => ({
          project_id: projectId, scene_index: i,
          animator_code_status: 'pending', animator_code: null,
        }));
        for (const u of upserts) {
          await supabase.from('project_scenes').upsert(u, { onConflict: 'project_id,scene_index' });
        }
      }

      const results = new Array(segments.length).fill(null);
      const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };

      async function processScene(idx) {
        const seg = segments[idx];
        const segIndex = idx + 1;

        if (supabase) {
          await supabase.from('project_scenes').update({ animator_code_status: 'generating' })
            .eq('project_id', projectId).eq('scene_index', idx);
        }

        const neighborContext = {
          prevTexts: segments.slice(Math.max(0, idx - 2), idx).map(s => s.text),
          nextTexts: segments.slice(idx + 1, idx + 3).map(s => s.text),
          prevCode: idx > 0 && results[idx - 1]?.code ? results[idx - 1].code : null,
        };

        const result = await generateSingleScene(
          client, effectiveModel, systemPrompt, seg, segIndex, segments.length, extraPrompt, neighborContext
        );

        results[idx] = result;

        const job = activeJobs.get(jobId);
        if (result.error) {
          if (supabase) {
            await supabase.from('project_scenes').update({
              animator_code_status: 'failed',
              animator_code: result.code || result.error,
            }).eq('project_id', projectId).eq('scene_index', idx);
          }
          if (job) job.failedScenes = (job.failedScenes || 0) + 1;
        } else {
          if (supabase) {
            await supabase.from('project_scenes').update({
              animator_code_status: 'completed',
              animator_code: result.code,
            }).eq('project_id', projectId).eq('scene_index', idx);
          }
          if (job) job.completedScenes = (job.completedScenes || 0) + 1;
          totalTokens.input += result.tokens.input;
          totalTokens.output += result.tokens.output;
          totalTokens.cacheRead += result.tokens.cacheRead;
          totalTokens.cacheCreated += result.tokens.cacheCreated;
        }
        if (job) job.progress = Math.round(((job.completedScenes || 0) + (job.failedScenes || 0)) / segments.length * 100);
      }

      // Process with concurrency limit — sequential batches for style coherence
      for (let i = 0; i < segments.length; i += SCENE_CONCURRENCY) {
        const batch = [];
        for (let j = i; j < Math.min(i + SCENE_CONCURRENCY, segments.length); j++) {
          batch.push(processScene(j));
        }
        await Promise.all(batch);
      }

      const PRICES = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };
      const costUsd =
        (totalTokens.input * PRICES.input / 1_000_000) +
        (totalTokens.output * PRICES.output / 1_000_000) +
        (totalTokens.cacheCreated * PRICES.cacheWrite / 1_000_000) +
        (totalTokens.cacheRead * PRICES.cacheRead / 1_000_000);

      const completedCount = results.filter(r => r && !r.error).length;
      const failedCount = results.filter(r => r && r.error).length;

      const job = activeJobs.get(jobId);
      if (job) {
        job.status = failedCount > 0 ? 'partial' : 'scenes_ready';
        job.tokens = totalTokens;
        job.costUsd = costUsd;
        job.completedScenes = completedCount;
        job.failedScenes = failedCount;
      }

      if (supabase && userId) {
        await supabase.from('remotion_render_jobs').update({
          status: failedCount > 0 ? 'partial' : 'scenes_ready',
          cost_usd: costUsd,
          tokens: totalTokens,
        }).eq('id', jobId);
        if (projectId) {
          await supabase.from('projects').update({
            animator_tokens: totalTokens,
            animator_cost_usd: costUsd,
          }).eq('id', projectId);
        }
      }

      console.log(`[Animator] Per-scene generation done: ${completedCount}/${segments.length} OK, ${failedCount} failed | $${costUsd.toFixed(4)}`);
    } catch (err) {
      console.error(`[Animator] Per-scene generation fatal error for ${jobId}:`, err.message);
      const job = activeJobs.get(jobId);
      if (job) { job.status = 'failed'; job.error = err.message; }
      if (supabase && projectId) {
        await supabase.from('remotion_render_jobs').update({ status: 'failed', error_message: err.message }).eq('id', jobId);
      }
    }
  })();
});

app.post('/animator/generate-scene', async (req, res) => {
  const {
    anthropicKey,
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

  if (!anthropicKey) return res.status(400).json({ error: 'anthropicKey is required' });
  if (!segment) return res.status(400).json({ error: 'segment is required' });
  if (segIndex == null) return res.status(400).json({ error: 'segIndex is required' });

  try {
    const effectiveModel = model || 'claude-sonnet-4-6';
    const { systemPrompt } = buildSystemPrompt(brandingConfig, extraPrompt, brandingMarkdown, selectedSkills);
    const client = new Anthropic({ apiKey: anthropicKey });

    if (supabase && projectId) {
      await supabase.from('project_scenes').update({ animator_code_status: 'generating' })
        .eq('project_id', projectId).eq('scene_index', segIndex);
    }

    const result = await generateSingleScene(
      client, effectiveModel, systemPrompt, segment, segIndex + 1, totalSegments || 1, extraPrompt, neighborContext
    );

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
      const PRICES = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };
      const newCost =
        (merged.input * PRICES.input / 1_000_000) +
        (merged.output * PRICES.output / 1_000_000) +
        (merged.cacheCreated * PRICES.cacheWrite / 1_000_000) +
        (merged.cacheRead * PRICES.cacheRead / 1_000_000);
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
