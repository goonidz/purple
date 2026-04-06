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
