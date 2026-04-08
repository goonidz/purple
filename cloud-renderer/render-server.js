const express = require('express');
const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, ensureBrowser } = require('@remotion/renderer');
const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;
const GCS_BUCKET = process.env.GCS_BUCKET_NAME;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHROMIUM = process.env.REMOTION_CHROME_EXECUTABLE || '/usr/bin/chromium';

const storage = GCS_BUCKET ? new Storage() : null;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

ensureBrowser({ browserExecutable: CHROMIUM })
  .then(() => console.log('[Renderer] Browser ready'))
  .catch(e => console.error('[Renderer] Browser init failed:', e.message));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/render', async (req, res) => {
  const {
    jobId,
    projectId,
    code,
    componentName,
    compositionId,
    durationInFrames,
    fps = 30,
    width = 1920,
    height = 1080,
    codec = 'h264',
    crf,
    audioUrl,
    audioFilename,
  } = req.body;

  if (!code || !compositionId || !durationInFrames || !componentName) {
    return res.status(400).json({ error: 'Missing: code, componentName, compositionId, durationInFrames' });
  }

  const workDir = path.join(os.tmpdir(), `render-${jobId || Date.now()}`);
  const srcDir = path.join(workDir, 'src');
  const publicDir = path.join(workDir, 'public');
  let bundleLocation = null;

  console.log(`[Renderer] ${jobId} — ${durationInFrames} frames (${Math.round(durationInFrames / fps / 60)} min)`);

  try {
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, `${componentName}.tsx`), code);

    fs.writeFileSync(path.join(srcDir, 'Root.jsx'),
`import React from 'react';
import { Composition } from 'remotion';
import { ${componentName} } from './${componentName}';

export const RemotionRoot = () => (
  <>
    <Composition id="${compositionId}" component={${componentName}} durationInFrames={${durationInFrames}} fps={${fps}} width={${width}} height={${height}} defaultProps={{}} />
  </>
);
`);

    fs.writeFileSync(path.join(srcDir, 'index.js'),
      "import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\nregisterRoot(RemotionRoot);\n"
    );

    if (audioUrl && audioFilename) {
      try {
        const resp = await fetch(audioUrl);
        if (resp.ok) {
          fs.writeFileSync(path.join(publicDir, audioFilename), Buffer.from(await resp.arrayBuffer()));
          console.log(`[Renderer] Audio ready: ${audioFilename}`);
        }
      } catch (e) {
        console.warn(`[Renderer] Audio download failed: ${e.message}`);
      }
    }

    fs.symlinkSync('/app/node_modules', path.join(workDir, 'node_modules'));

    console.log(`[Renderer] Bundling ${jobId}...`);
    const entryPoint = path.join(srcDir, 'index.js');
    bundleLocation = await bundle({
      entryPoint,
      webpackOverride: (c) => c,
      publicDir,
    });
    console.log(`[Renderer] Bundle ready`);

    const outputFile = path.join(workDir, 'output.mp4');
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps: {},
      browserExecutable: CHROMIUM,
    });

    let lastReportedPct = -1;
    await renderMedia({
      composition: { ...composition, durationInFrames, fps, width, height },
      serveUrl: bundleLocation,
      codec,
      outputLocation: outputFile,
      inputProps: {},
      browserExecutable: CHROMIUM,
      ...(crf !== undefined ? { crf } : {}),
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct !== lastReportedPct && pct % 5 === 0) {
          lastReportedPct = pct;
          console.log(`[Renderer] ${jobId} — ${pct}%`);
          if (supabase && jobId) {
            supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', jobId).then(() => {});
          }
        }
      },
    });

    console.log(`[Renderer] Render complete: ${jobId}`);

    let videoUrl = null;
    if (storage && GCS_BUCKET) {
      const gcsPath = `renders/${jobId}.mp4`;
      await storage.bucket(GCS_BUCKET).upload(outputFile, {
        destination: gcsPath,
        metadata: { contentType: 'video/mp4' },
      });
      videoUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${gcsPath}`;
      console.log(`[Renderer] Uploaded: ${videoUrl}`);
    }

    if (supabase && jobId) {
      await supabase.from('remotion_render_jobs').update({
        status: 'completed', progress: 100, video_url: videoUrl, completed_at: new Date().toISOString(),
      }).eq('id', jobId);
      if (projectId) {
        await supabase.from('projects').update({ animator_video_url: videoUrl }).eq('id', projectId);
      }
    }

    fs.rmSync(workDir, { recursive: true, force: true });
    if (bundleLocation) fs.rmSync(bundleLocation, { recursive: true, force: true });

    res.json({ success: true, videoUrl, jobId });

  } catch (err) {
    console.error(`[Renderer] Failed ${jobId}:`, err.message);
    if (supabase && jobId) {
      supabase.from('remotion_render_jobs').update({
        status: 'failed', error_message: err.message,
      }).eq('id', jobId).then(() => {});
    }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    if (bundleLocation) try { fs.rmSync(bundleLocation, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: err.message, jobId });
  }
});

app.listen(PORT, () => console.log(`[Renderer] Running on port ${PORT}`));
