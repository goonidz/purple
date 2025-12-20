const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create temp directory (must be defined before use)
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve video files directly from temp directory
app.use('/videos', express.static(TEMP_DIR));

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Job status storage (in-memory, could be moved to Redis/DB for production)
const jobs = new Map();

// Helper function to download file
async function downloadFile(url, filepath) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });
  
  const writer = fs.createWriteStream(filepath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Helper function to generate SRT subtitle file
function generateSRT(scenes, subtitleSettings) {
  if (!subtitleSettings || !subtitleSettings.enabled) {
    return null;
  }

  let srt = '';
  scenes.forEach((scene, index) => {
    if (!scene.text) return;
    
    const startTime = formatSRTTime(scene.startTime);
    const endTime = formatSRTTime(scene.endTime);
    
    srt += `${index + 1}\n`;
    srt += `${startTime} --> ${endTime}\n`;
    srt += `${scene.text}\n\n`;
  });
  
  return srt;
}

function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// Helper function to create concat file for ffmpeg (video segments)
function createConcatFileForVideos(scenes, workDir) {
  let concat = '';
  scenes.forEach((scene, index) => {
    const segmentPath = path.join(workDir, 'segments', `segment_${index}.mp4`);
    concat += `file '${segmentPath}'\n`;
  });
  return concat;
}

// Generate Pan effect parameters for a scene (no zoom, just movement)
function getPanEffect(sceneIndex, duration, width, height, framerate) {
  const totalFrames = Math.ceil(duration * framerate);
  
  // Pan directions for variety (only horizontal and vertical, no diagonal)
  const panDirections = ['pan_left', 'pan_right', 'pan_up', 'pan_down'];
  const direction = panDirections[sceneIndex % panDirections.length];
  
  // For pan to work, we need a slight zoom (1.2 = 20% zoom) to create margin for panning
  // This is much less than the 6x upscale used for Ken Burns, so it's still fast
  const zoomLevel = 1.2; // 20% zoom creates enough margin for visible pan
  const zoomExpr = String(zoomLevel);
  
  // Pan distance: move 4% of the image width/height (relative to zoomed size)
  // This creates slower, more subtle movement within the zoomed area
  const panAmount = 0.04;
  
  let xExpr, yExpr;
  // Center position (starting point) - when zoomed, center is (iw-iw/zoom)/2
  const centerXExpr = `(iw-iw/${zoomLevel})/2`;
  const centerYExpr = `(ih-ih/${zoomLevel})/2`;
  
  // Pan distance in pixels (relative to image dimensions)
  const panDistXExpr = `iw*${panAmount}`;
  const panDistYExpr = `ih*${panAmount}`;
  
  switch (direction) {
    case 'pan_left':
      // Pan left: start viewing right side, move to left
      xExpr = `${centerXExpr}+${panDistXExpr}*(1-on/${totalFrames})-${panDistXExpr}*(on/${totalFrames})`;
      yExpr = centerYExpr;
      break;
    case 'pan_right':
      // Pan right: start viewing left side, move to right
      xExpr = `${centerXExpr}-${panDistXExpr}*(1-on/${totalFrames})+${panDistXExpr}*(on/${totalFrames})`;
      yExpr = centerYExpr;
      break;
    case 'pan_up':
      // Pan up: start viewing bottom, move to top
      xExpr = centerXExpr;
      yExpr = `${centerYExpr}+${panDistYExpr}*(1-on/${totalFrames})-${panDistYExpr}*(on/${totalFrames})`;
      break;
    case 'pan_down':
      // Pan down: start viewing top, move to bottom
      xExpr = centerXExpr;
      yExpr = `${centerYExpr}-${panDistYExpr}*(1-on/${totalFrames})+${panDistYExpr}*(on/${totalFrames})`;
      break;
    default:
      xExpr = centerXExpr;
      yExpr = centerYExpr;
  }
  
  return {
    // Use zoompan with slight zoom (1.2x) to create margin for panning
    // This is much faster than 6x upscale for Ken Burns
    filter: `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${width}x${height}:fps=${framerate}`,
    effect: direction
  };
}

// Generate Ken Burns effect parameters for a scene
function getKenBurnsEffect(sceneIndex, duration, width, height, framerate) {
  // Various zoom and pan directions for variety
  const effects = ['zoom_in', 'zoom_out', 'zoom_in_left', 'zoom_out_right', 'zoom_in_top', 'zoom_out_bottom'];
  const effect = effects[sceneIndex % effects.length]; // Deterministic but varied
  
  const totalFrames = Math.ceil(duration * framerate);
  const zoomAmount = 0.08; // 8% zoom - subtle but visible
  
  // ULTIMATE FIX FOR JIGGLE:
  // 1. Scale up the image 6x (more resolution = less rounding errors)
  // 2. Apply zoompan at 6x resolution
  // 3. Scale back down to target resolution
  // This completely eliminates sub-pixel jitter
  // Note: The final video is downscaled, so file size is based on target resolution
  
  const scaleFactor = 6;
  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;
  
  let zoomExpr, xExpr, yExpr;
  
  // Simple zoom expressions - the upscaling handles the precision
  switch (effect) {
    case 'zoom_in':
      // Zoom in towards center: 1.0 -> 1.08
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_out':
      // Zoom out from center: 1.08 -> 1.0
      zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_in_left':
      // Zoom in towards left side
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/4`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_out_right':
      // Zoom out towards right side
      zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)*3/4`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_in_top':
      // Zoom in towards top
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/4`;
      break;
    case 'zoom_out_bottom':
      // Zoom out towards bottom
      zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)*3/4`;
      break;
    default:
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/2`;
  }
  
  return {
    // Pipeline: scale up 4x -> zoompan at high res -> scale back down
    // This eliminates jiggle by having more precision during the zoom
    filter: `scale=${scaledWidth}:${scaledHeight},zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${scaledWidth}x${scaledHeight}:fps=${framerate},scale=${width}:${height}`,
    effect
  };
}

// Render a single scene with effect (Ken Burns or Pan)
async function renderSceneWithEffect(imagePath, outputPath, duration, width, height, framerate, sceneIndex, jobId, effectType = 'zoom') {
  return new Promise((resolve, reject) => {
    console.log(`[${jobId}] Rendering scene ${sceneIndex} with effectType: "${effectType}" (type: ${typeof effectType})`);
    const isPan = String(effectType).toLowerCase().trim() === 'pan';
    console.log(`[${jobId}] Is pan effect? ${isPan}`);
    console.log(`[${jobId}] Comparison: "${String(effectType).toLowerCase().trim()}" === "pan" ? ${isPan}`);
    
    const { filter, effect } = isPan
      ? getPanEffect(sceneIndex, duration, width, height, framerate)
      : getKenBurnsEffect(sceneIndex, duration, width, height, framerate);
    
    console.log(`[${jobId}] Scene ${sceneIndex}: ${effect} effect (effectType: "${effectType}", isPan: ${isPan}), ${duration.toFixed(2)}s`);
    console.log(`[${jobId}] Filter: ${filter}`);
    
    // Use zoompan filter directly on the image - it generates frames from a single image
    // The filter chain handles format conversion (yuv444p -> zoompan -> yuv420p)
    ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop', '1']) // Loop the single image
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'ultrafast',  // Much faster encoding (trades some quality for speed)
        '-crf', '23',
        '-t', duration.toString() // Duration of the output
      ])
      .videoFilters([filter])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`[${jobId}] Scene ${sceneIndex} FFmpeg: ${cmd}`);
      })
      .on('end', () => {
        console.log(`[${jobId}] Scene ${sceneIndex} completed`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[${jobId}] Scene ${sceneIndex} error:`, err.message);
        reject(err);
      })
      .run();
  });
}

// Process render job in background
async function processRenderJob(jobId, renderData) {
  const startTime = Date.now();
  const workDir = path.join(TEMP_DIR, jobId);
  
  // Helper function to clamp progress between 0 and 100
  function clampProgress(progress) {
    return Math.max(0, Math.min(100, Math.round(progress || 0)));
  }

  // Helper function to add step and update job
  function addStep(step, progress = null, isCurrent = false) {
    const job = jobs.get(jobId);
    if (job) {
      job.steps = job.steps || [];
      if (isCurrent) {
        // Update current step message
        job.currentStep = step;
      } else {
        // Add completed step
        job.steps.push({ message: step, timestamp: new Date().toISOString() });
        // Clear current step when a step is completed
        job.currentStep = null;
      }
      if (progress !== null) {
        job.progress = clampProgress(progress);
      }
      jobs.set(jobId, job);
    }
  }
  
  try {
    // Update job status with steps array
    jobs.set(jobId, { status: 'processing', progress: 0, startTime, steps: [], currentStep: null });
    
    // Create working directory
    await mkdir(workDir, { recursive: true });
    
    const {
      scenes,
      audioUrl,
      subtitleSettings,
      videoSettings = {},
      projectId,
      userId,
      effectType = 'zoom' // 'zoom' for Ken Burns, 'pan' for pan effects
    } = renderData;
    
    console.log(`[${jobId}] Received effectType: ${effectType} (type: ${typeof effectType})`);
    console.log(`[${jobId}] Full renderData keys:`, Object.keys(renderData));

    if (!scenes || scenes.length === 0) {
      throw new Error('No scenes provided');
    }

    if (!audioUrl) {
      throw new Error('No audio URL provided');
    }

    const {
      width = 1920,
      height = 1080,
      framerate = 25,
      format = 'mp4'
    } = videoSettings;

    addStep(`Démarrage du rendu: ${scenes.length} scènes, ${width}x${height}@${framerate}fps`, 5);

    // Step 1: Download audio
    addStep('Téléchargement de l\'audio...', 10, true);
    const audioPath = path.join(workDir, 'audio.mp3');
    await downloadFile(audioUrl, audioPath);
    addStep('Audio téléchargé', 15);

    // Step 2: Download all images
    addStep(`Téléchargement de ${scenes.length} images...`, 20, true);
    const imagesDir = path.join(workDir, 'images');
    await mkdir(imagesDir, { recursive: true });
    
    let downloadedCount = 0;
    const imagePromises = scenes.map(async (scene, index) => {
      if (!scene.imageUrl) {
        throw new Error(`Scene ${index} has no image URL`);
      }
      const imagePath = path.join(imagesDir, `scene_${index}.jpg`);
      await downloadFile(scene.imageUrl, imagePath);
      downloadedCount++;
      // Update current step with progress
      const job = jobs.get(jobId);
      if (job) {
        job.currentStep = `Téléchargement des images... ${downloadedCount}/${scenes.length}`;
        jobs.set(jobId, job);
      }
      return imagePath;
    });
    
    await Promise.all(imagePromises);
    addStep(`Toutes les images téléchargées (${scenes.length}/${scenes.length})`, 30);

    // Step 3: Create segments directory for Ken Burns rendered scenes
    const segmentsDir = path.join(workDir, 'segments');
    await mkdir(segmentsDir, { recursive: true });

    // Step 4: Render each scene with effect
    const effectLabel = effectType === 'pan' ? 'pan' : 'Ken Burns';
    addStep(`Application de l'effet ${effectLabel} sur les scènes...`, 35);
    
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imagePath = path.join(imagesDir, `scene_${i}.jpg`);
      const segmentPath = path.join(segmentsDir, `segment_${i}.mp4`);
      const duration = scene.endTime - scene.startTime;
      
      // Show current scene being processed (updates the same line)
      const job = jobs.get(jobId);
      if (job) {
        job.currentStep = `Rendu de la scène ${i + 1}/${scenes.length}...`;
        jobs.set(jobId, job);
      }
      
      await renderSceneWithEffect(
        imagePath, 
        segmentPath, 
        duration, 
        width, 
        height, 
        framerate, 
        i, 
        jobId,
        effectType
      );
      
      // Update current step to show completed (replaces the line)
      const jobAfter = jobs.get(jobId);
      if (jobAfter) {
        jobAfter.currentStep = `Scène ${i + 1}/${scenes.length} terminée`;
        // Update progress for each scene rendered
        const sceneProgress = 35 + Math.floor((i + 1) / scenes.length * 25);
        jobAfter.progress = clampProgress(sceneProgress);
        jobs.set(jobId, jobAfter);
        console.log(`[${jobId}] Updated currentStep: ${jobAfter.currentStep}`);
      }
      
      // Small delay to ensure the update is visible before moving to next scene
      // This helps the frontend catch the update
      if (i < scenes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Keep the last "Scène X/9 terminée" visible until we start the next phase
    addStep(`Toutes les scènes rendues avec effet ${effectLabel}`, 60);

    // Step 5: Create concat file for video segments
    // Clear current step when starting next phase
    const concatJob = jobs.get(jobId);
    if (concatJob) {
      concatJob.currentStep = null;
      jobs.set(jobId, concatJob);
    }
    addStep('Création du fichier de concaténation...', 65, true);
    const concatContent = createConcatFileForVideos(scenes, workDir);
    const concatPath = path.join(workDir, 'concat.txt');
    await writeFile(concatPath, concatContent, 'utf8');
    addStep('Fichier de concaténation créé', 68);

    // Step 6: Concatenate all segments and add audio
    addStep('Concaténation des segments et ajout de l\'audio...', 70, true);
    const outputPath = path.join(workDir, `output.${format}`);
    
    return new Promise((resolve, reject) => {
      let ffmpegCommand = ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset', 'medium',  // Better compression for smaller files
          '-crf', '28',  // Higher CRF = smaller file size (28 is good balance for storage)
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-threads', '0', // Use all available cores
          '-shortest' // End when shortest stream ends
        ])
        .output(outputPath);

      // Store FFmpeg command reference in job for cancellation
      const job = jobs.get(jobId);
      if (job) {
        job.ffmpegCommand = ffmpegCommand;
        jobs.set(jobId, job);
      }

      ffmpegCommand
        .on('start', (commandLine) => {
          console.log(`[${jobId}] FFmpeg command: ${commandLine}`);
          addStep('Encodage vidéo en cours...', 75, true);
        })
        .on('progress', (progress) => {
          if (progress.percent !== undefined && progress.percent !== null) {
            // Parse percent (can be string or number from FFmpeg)
            let percent = typeof progress.percent === 'string' 
              ? parseFloat(progress.percent) 
              : Number(progress.percent);
            
            // Clamp percent between 0 and 100 (FFmpeg can sometimes report > 100)
            percent = Math.max(0, Math.min(100, percent));
            
            // Map FFmpeg progress (0-100) to our progress range (75-95)
            const mappedProgress = 75 + Math.floor(percent * 0.2);
            // Clamp final progress between 75 and 95
            const finalProgress = clampProgress(Math.max(75, Math.min(95, mappedProgress)));
            
            // Update job progress and current step
            const job = jobs.get(jobId);
            if (job) {
              job.progress = finalProgress;
              job.currentStep = `Encodage vidéo en cours... ${Math.round(percent)}%`;
              jobs.set(jobId, job);
            }
          }
        })
        .on('end', async () => {
          addStep('Encodage terminé', 95);
          
          try {
            // Step 6: Generate VPS URL instead of uploading to Supabase
            // Files are served directly from VPS and cleaned up after 3 days
            const fileSize = fs.statSync(outputPath).size;
            const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
            addStep(`Fichier vidéo créé: ${fileSizeMB} MB`, 98);
            
            // Get VPS public URL from environment or use default
            const vpsPublicUrl = process.env.VPS_PUBLIC_URL || `http://51.91.158.233:${PORT}`;
            
            // Generate URL path (relative to temp directory)
            const relativePath = path.relative(TEMP_DIR, outputPath);
            const videoUrl = `${vpsPublicUrl}/videos/${relativePath}`;
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            addStep('Rendu terminé !', 100);
            
            // Update job status to completed with VPS URL
            const job = jobs.get(jobId);
            jobs.set(jobId, {
              ...job,
              status: 'completed',
              progress: clampProgress(100),
              videoUrl: videoUrl,
              jobId,
              duration: parseFloat(duration),
              fileSize: fileSize,
              fileSizeMB: parseFloat(fileSizeMB),
              createdAt: new Date().toISOString(), // For cleanup script
              completedAt: new Date().toISOString()
            });
            
            resolve();
          } catch (error) {
            await cleanup(workDir);
            reject(error);
          }
        })
        .on('error', async (err) => {
          console.error(`[${jobId}] FFmpeg error:`, err);
          // Remove FFmpeg command reference
          const job = jobs.get(jobId);
          if (job) {
            job.ffmpegCommand = null;
            jobs.set(jobId, job);
          }
          await cleanup(workDir);
          reject(err);
        })
        .on('end', () => {
          // Remove FFmpeg command reference when done
          const job = jobs.get(jobId);
          if (job) {
            job.ffmpegCommand = null;
            jobs.set(jobId, job);
          }
        })
        .run();
    });

  } catch (error) {
    console.error(`[${jobId}] Error:`, error);
    await cleanup(workDir).catch(() => {});
    
    // Update job status to failed
    jobs.set(jobId, {
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });
  }
}

// Main render endpoint - returns immediately with jobId
app.post('/render', async (req, res) => {
  const jobId = `render_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Log received data for debugging
  console.log(`[${jobId}] POST /render - Received effectType:`, req.body.effectType, '(type:', typeof req.body.effectType, ')');
  console.log(`[${jobId}] POST /render - Request body keys:`, Object.keys(req.body));

  // Initialize job status
  jobs.set(jobId, { status: 'pending', progress: 0, steps: [], createdAt: new Date().toISOString() });

  // Start processing in background (don't await)
  processRenderJob(jobId, req.body).catch((error) => {
    console.error(`[${jobId}] Background job error:`, error);
    jobs.set(jobId, {
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });
  });
  
  // Return immediately
  res.json({
    success: true,
    jobId,
    status: 'pending',
    message: 'Render job started'
  });
});

// Status endpoint
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  // Don't expose internal FFmpeg command reference
  const { ffmpegCommand, ...jobData } = job;
  
  res.json({
    success: true,
    jobId,
    ...jobData
  });
});

// Cancel endpoint - stops FFmpeg process and cleans up
app.delete('/cancel/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  // Check if job is already completed or failed
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return res.json({
      success: true,
      message: 'Job already finished',
      jobId
    });
  }
  
  try {
    // Kill FFmpeg process if it exists
    if (job.ffmpegCommand) {
      console.log(`[${jobId}] Killing FFmpeg process...`);
      job.ffmpegCommand.kill('SIGTERM');
      // Wait a bit, then force kill if still running
      setTimeout(() => {
        if (job.ffmpegCommand) {
          job.ffmpegCommand.kill('SIGKILL');
        }
      }, 2000);
    }
    
    // Cleanup work directory
    const workDir = path.join(TEMP_DIR, jobId);
    await cleanup(workDir).catch(err => {
      console.error(`[${jobId}] Cleanup error:`, err);
    });
    
    // Update job status
    jobs.set(jobId, {
      ...job,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      ffmpegCommand: null
    });
    
    // Note: Supabase update is handled by the frontend
    
    console.log(`[${jobId}] Job cancelled successfully`);
    res.json({
      success: true,
      message: 'Job cancelled',
      jobId
    });
  } catch (error) {
    console.error(`[${jobId}] Error cancelling job:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to convert hex color to ASS format
function hexToAssColor(hex) {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // ASS format: &HBBGGRR& (BGR, not RGB)
  return `&H${b.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}&`;
}

// Cleanup function
async function cleanup(workDir) {
  try {
    if (fs.existsSync(workDir)) {
      const files = fs.readdirSync(workDir);
      for (const file of files) {
        const filePath = path.join(workDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          await cleanup(filePath);
        } else {
          await unlink(filePath);
        }
      }
      fs.rmdirSync(workDir);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Video Render Service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
