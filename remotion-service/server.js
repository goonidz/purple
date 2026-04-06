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

      const videoUrl = `http://localhost:${PORT}/renders/${jobId}.mp4`;

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
const { generateComposition } = require('./animator/claude-generator');

app.post('/animator/generate', async (req, res) => {
  const {
    anthropicKey,
    segments,
    componentName,
    audioFilename,
    brandingConfig,
    brandingMarkdown,
    extraPrompt,
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

        const videoUrl = `http://${process.env.VPS_HOST || 'localhost'}:${PORT}/renders/${jobId}.mp4`;

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
    brandingConfig,
    brandingMarkdown,
    extraPrompt,
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
        audioFilename, brandingConfig, brandingMarkdown, extraPrompt, model, chunkSize, fps, width, height,
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

      const videoUrl = `http://${process.env.VPS_HOST || 'localhost'}:${PORT}/renders/${jobId}.mp4`;
      const j = activeJobs.get(jobId);
      if (j) { j.status = 'completed'; j.progress = 100; j.videoUrl = videoUrl; }

      if (supabase) {
        await supabase.from('remotion_render_jobs').update({
          status: 'completed', progress: 100, video_url: videoUrl, completed_at: new Date().toISOString(),
        }).eq('id', jobId);
        if (projectId) {
          await supabase.from('projects').update({ animator_video_url: videoUrl }).eq('id', projectId);
        }
      }
      console.log(`[Animator] Full pipeline complete: ${jobId} -> ${videoUrl}`);
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

      const videoUrl = `http://${process.env.VPS_HOST || 'localhost'}:${PORT}/renders/${job.id}.mp4`;

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
