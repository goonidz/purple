const express = require('express');
const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, getCompositions } = require('@remotion/renderer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const os = require('os');

require('dotenv').config();

const app = express();
const PORT = process.env.REMOTION_PORT || 3002;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let bundleLocation = null;
let isRendering = false;
const renderQueue = [];

app.use(express.json({ limit: '50mb' }));

// ─── Bundle on startup ──────────────────────────────────────────────
async function ensureBundle() {
  if (bundleLocation) return bundleLocation;

  console.log('[Remotion] Bundling compositions...');
  const startTime = Date.now();

  bundleLocation = await bundle({
    entryPoint: path.resolve(__dirname, 'src/index.js'),
    webpackOverride: (config) => config,
  });

  console.log(`[Remotion] Bundle ready in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  return bundleLocation;
}

// ─── Health check ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'remotion-render-service',
    bundled: !!bundleLocation,
    rendering: isRendering,
    queueLength: renderQueue.length,
    uptime: process.uptime(),
  });
});

// ─── List compositions ──────────────────────────────────────────────
app.get('/compositions', async (req, res) => {
  try {
    const bundleLoc = await ensureBundle();
    const compositions = await getCompositions(bundleLoc);
    res.json({
      success: true,
      compositions: compositions.map((c) => ({
        id: c.id,
        width: c.width,
        height: c.height,
        fps: c.fps,
        durationInFrames: c.durationInFrames,
      })),
    });
  } catch (err) {
    console.error('[Remotion] Error listing compositions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Render endpoint ────────────────────────────────────────────────
app.post('/render', async (req, res) => {
  const {
    compositionId,
    inputProps = {},
    codec = 'h264',
    fps,
    width,
    height,
    durationInFrames,
    jobId,
    outputFormat = 'mp4',
  } = req.body;

  if (!compositionId) {
    return res.status(400).json({ success: false, error: 'compositionId is required' });
  }

  const renderJobId = jobId || `render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outputFile = path.join(OUTPUT_DIR, `${renderJobId}.${outputFormat === 'webm' ? 'webm' : 'mp4'}`);

  console.log(`[Remotion] Render request: ${compositionId} -> ${renderJobId}`);

  // Return immediately, process in background
  res.json({
    success: true,
    jobId: renderJobId,
    status: 'queued',
    message: 'Render job queued',
  });

  // Queue the render
  renderQueue.push({
    renderJobId,
    compositionId,
    inputProps,
    codec,
    fps,
    width,
    height,
    durationInFrames,
    outputFile,
    outputFormat,
  });

  processQueue();
});

// ─── Queue processor ────────────────────────────────────────────────
async function processQueue() {
  if (isRendering || renderQueue.length === 0) return;

  isRendering = true;
  const job = renderQueue.shift();

  try {
    await updateJobStatus(job.renderJobId, 'rendering', 0, 'Bundling...');

    const bundleLoc = await ensureBundle();

    await updateJobStatus(job.renderJobId, 'rendering', 5, 'Selecting composition...');

    const compositionOverrides = {};
    if (job.fps) compositionOverrides.fps = job.fps;
    if (job.width) compositionOverrides.width = job.width;
    if (job.height) compositionOverrides.height = job.height;
    if (job.durationInFrames) compositionOverrides.durationInFrames = job.durationInFrames;

    const composition = await selectComposition({
      serveUrl: bundleLoc,
      id: job.compositionId,
      inputProps: job.inputProps,
      ...compositionOverrides,
    });

    console.log(`[Remotion] Rendering ${composition.id}: ${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames`);

    await updateJobStatus(job.renderJobId, 'rendering', 10, 'Rendering frames...');

    await renderMedia({
      composition,
      serveUrl: bundleLoc,
      codec: job.codec || 'h264',
      outputLocation: job.outputFile,
      inputProps: job.inputProps,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 10 === 0) {
          console.log(`[Remotion] ${job.renderJobId}: ${pct}%`);
          updateJobStatus(job.renderJobId, 'rendering', pct, `Rendering: ${pct}%`);
        }
      },
    });

    const stats = fs.statSync(job.outputFile);
    console.log(`[Remotion] Render complete: ${job.outputFile} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    await updateJobStatus(job.renderJobId, 'completed', 100, 'Render complete', {
      outputFile: job.outputFile,
      fileSize: stats.size,
    });

  } catch (err) {
    console.error(`[Remotion] Render failed for ${job.renderJobId}:`, err);
    await updateJobStatus(job.renderJobId, 'failed', 0, err.message);
  } finally {
    isRendering = false;
    if (renderQueue.length > 0) processQueue();
  }
}

// ─── Download rendered file ─────────────────────────────────────────
app.get('/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const mp4Path = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  const webmPath = path.join(OUTPUT_DIR, `${jobId}.webm`);

  const filePath = fs.existsSync(mp4Path) ? mp4Path : fs.existsSync(webmPath) ? webmPath : null;

  if (!filePath) {
    return res.status(404).json({ success: false, error: 'Rendered file not found' });
  }

  const ext = path.extname(filePath);
  const contentType = ext === '.webm' ? 'video/webm' : 'video/mp4';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${jobId}${ext}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ─── Job status (via Supabase or in-memory) ─────────────────────────
const jobStatuses = new Map();

app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const status = jobStatuses.get(jobId);

  if (!status) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  res.json({ success: true, ...status });
});

async function updateJobStatus(jobId, status, progress, message, extra = {}) {
  const statusObj = {
    jobId,
    status,
    progress,
    message,
    updatedAt: new Date().toISOString(),
    ...extra,
  };

  jobStatuses.set(jobId, statusObj);

  if (supabase) {
    try {
      await supabase.from('remotion_render_jobs').upsert({
        id: jobId,
        status,
        progress,
        current_step: message,
        video_url: extra.outputFile || null,
        error_message: status === 'failed' ? message : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (err) {
      console.warn(`[Remotion] DB update failed for ${jobId}:`, err.message);
    }
  }
}

// ─── Serve output files statically ──────────────────────────────────
app.use('/output', express.static(OUTPUT_DIR));

// ─── Cleanup old renders ────────────────────────────────────────────
function cleanupOldRenders() {
  const MAX_AGE_HOURS = 24;
  const now = Date.now();

  [OUTPUT_DIR, TEMP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      try {
        const stats = fs.statSync(filePath);
        const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60);
        if (ageHours > MAX_AGE_HOURS) {
          fs.unlinkSync(filePath);
          console.log(`[Remotion] Cleaned up old file: ${file}`);
        }
      } catch (e) { /* ignore */ }
    });
  });
}

setInterval(cleanupOldRenders, 60 * 60 * 1000);

// ─── Worker mode: poll Supabase for pending jobs ────────────────────
const WORKER_MODE = (process.env.REMOTION_WORKER_MODE || '').toLowerCase() === 'true';
const POLL_INTERVAL = parseInt(process.env.REMOTION_POLL_INTERVAL || '5000', 10);

async function pollForJobs() {
  if (!supabase) {
    console.warn('[Remotion Worker] No Supabase config, skipping poll');
    return;
  }

  try {
    const { data: jobs, error } = await supabase
      .from('remotion_render_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('[Remotion Worker] Poll error:', error.message);
      return;
    }

    if (!jobs || jobs.length === 0) return;

    const job = jobs[0];
    console.log(`[Remotion Worker] Picked up job: ${job.id}`);

    const { error: claimError } = await supabase
      .from('remotion_render_jobs')
      .update({ status: 'rendering', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'pending');

    if (claimError) {
      console.warn('[Remotion Worker] Failed to claim job:', claimError.message);
      return;
    }

    const meta = job.metadata || {};

    renderQueue.push({
      renderJobId: job.id,
      compositionId: meta.compositionId || 'Slideshow',
      inputProps: meta.inputProps || {},
      codec: meta.codec || 'h264',
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
      durationInFrames: meta.durationInFrames,
      outputFile: path.join(OUTPUT_DIR, `${job.id}.mp4`),
      outputFormat: meta.outputFormat || 'mp4',
    });

    processQueue();
  } catch (err) {
    console.error('[Remotion Worker] Unexpected error:', err);
  }
}

// ─── Start server ───────────────────────────────────────────────────
async function start() {
  console.log('[Remotion] Starting render service...');

  try {
    await ensureBundle();
    console.log('[Remotion] Initial bundle complete');
  } catch (err) {
    console.error('[Remotion] Initial bundle failed:', err.message);
    console.log('[Remotion] Will retry on first render request');
    bundleLocation = null;
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Remotion] Render service listening on port ${PORT}`);
    console.log(`[Remotion] Worker mode: ${WORKER_MODE ? 'ENABLED' : 'DISABLED (API-only)'}`);
    console.log(`[Remotion] Supabase: ${supabase ? 'connected' : 'not configured'}`);
  });

  if (WORKER_MODE) {
    console.log(`[Remotion Worker] Polling every ${POLL_INTERVAL}ms`);
    setInterval(pollForJobs, POLL_INTERVAL);
  }
}

start().catch((err) => {
  console.error('[Remotion] Fatal error:', err);
  process.exit(1);
});
