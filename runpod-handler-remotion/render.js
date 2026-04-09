const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition, ensureBrowser } = require('@remotion/renderer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VPS_UPLOAD_URL = process.env.VPS_UPLOAD_URL;
const VPS_UPLOAD_TOKEN = process.env.VPS_UPLOAD_TOKEN;
const CHROMIUM = process.env.REMOTION_CHROME_EXECUTABLE || '/usr/bin/chromium';

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (e) => { file.close(); reject(e); });
  });
}

async function uploadToVPS(filePath, filename) {
  if (!VPS_UPLOAD_URL || !VPS_UPLOAD_TOKEN) {
    throw new Error('VPS upload credentials not configured');
  }

  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const fileBuffer = fs.readFileSync(filePath);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);

  const url = new URL(VPS_UPLOAD_URL);
  const proto = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = proto.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Authorization': `Bearer ${VPS_UPLOAD_TOKEN}`,
      },
      timeout: 300000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`VPS upload failed: ${res.statusCode} - ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    console.error('Usage: node render.js <input.json> <output.json>');
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
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
  } = input;

  if (!code || !compositionId || !durationInFrames || !componentName) {
    throw new Error('Missing required fields: code, componentName, compositionId, durationInFrames');
  }

  const workDir = path.join(os.tmpdir(), `render-${jobId || Date.now()}`);
  const srcDir = path.join(workDir, 'src');
  const publicDir = path.join(workDir, 'public');
  let bundleLocation = null;

  console.log(`[Render] ${jobId} — ${durationInFrames} frames (${Math.round(durationInFrames / fps / 60)} min)`);

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
        await downloadFile(audioUrl, path.join(publicDir, audioFilename));
        console.log(`[Render] Audio ready: ${audioFilename}`);
      } catch (e) {
        console.warn(`[Render] Audio download failed: ${e.message}`);
      }
    }

    fs.symlinkSync('/app/node_modules', path.join(workDir, 'node_modules'));

    console.log(`[Render] Bundling...`);
    await ensureBrowser({ browserExecutable: CHROMIUM });
    const entryPoint = path.join(srcDir, 'index.js');
    bundleLocation = await bundle({
      entryPoint,
      webpackOverride: (c) => c,
      publicDir,
    });
    console.log(`[Render] Bundle ready`);

    const outputFile = path.join(workDir, 'output.mp4');
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps: {},
      browserExecutable: CHROMIUM,
    });

    const cpus = require('os').cpus().length;
    const concurrency = Math.max(4, cpus);
    console.log(`[Render] Using concurrency ${concurrency} (${cpus} CPUs detected)`);

    let lastReportedPct = -1;
    await renderMedia({
      composition: { ...composition, durationInFrames, fps, width, height },
      serveUrl: bundleLocation,
      codec,
      concurrency,
      outputLocation: outputFile,
      inputProps: {},
      browserExecutable: CHROMIUM,
      ...(crf !== undefined ? { crf } : {}),
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct !== lastReportedPct && pct % 5 === 0) {
          lastReportedPct = pct;
          console.log(`[Render] ${jobId} — ${pct}%`);
          if (supabase && jobId) {
            supabase.from('remotion_render_jobs').update({ progress: pct }).eq('id', jobId).then(() => {});
          }
        }
      },
    });

    console.log(`[Render] Render complete`);

    let videoUrl = null;

    if (VPS_UPLOAD_URL) {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `${dateStr}_animator_${jobId || Date.now()}.mp4`;
      const uploadResult = await uploadToVPS(outputFile, filename);
      videoUrl = uploadResult.url;
      console.log(`[Render] Uploaded to VPS: ${videoUrl} (${uploadResult.sizeMB} MB)`);
    }

    if (supabase && jobId) {
      await supabase.from('remotion_render_jobs').update({
        status: 'completed',
        progress: 100,
        video_url: videoUrl,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);

      if (projectId) {
        await supabase.from('projects').update({ animator_video_url: videoUrl }).eq('id', projectId);
      }
    }

    fs.rmSync(workDir, { recursive: true, force: true });
    if (bundleLocation) fs.rmSync(bundleLocation, { recursive: true, force: true });

    const result = { success: true, videoUrl, jobId };
    fs.writeFileSync(outputPath, JSON.stringify(result));
    console.log(`[Render] Done: ${JSON.stringify(result)}`);

  } catch (err) {
    console.error(`[Render] Failed: ${err.message}`);
    if (supabase && jobId) {
      await supabase.from('remotion_render_jobs').update({
        status: 'failed',
        error_message: err.message,
      }).eq('id', jobId);
    }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    if (bundleLocation) try { fs.rmSync(bundleLocation, { recursive: true, force: true }); } catch {}

    fs.writeFileSync(outputPath, JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Render] Fatal:', err);
  process.exit(1);
});
