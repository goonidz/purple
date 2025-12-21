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

// Version identifier - update this when making pan/zoom changes
const SERVICE_VERSION = 'v2.11-pan-zoom-1.2x';

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
  
  // Log pan parameters for debugging (only for long scenes to avoid spam)
  if (duration >= 9) {
    console.log(`[PAN DEBUG] Scene ${sceneIndex}: duration=${duration}s, totalFrames=${totalFrames}`);
  }
  
  // For pan to work, we need zoom to create margin for panning
  // Fixed zoom at 1.2x for all scenes to show more of the image
  const zoomLevel = 1.2; // 20% zoom - fixed for all scenes
  const zoomExpr = String(zoomLevel);
  
  // Center position (starting point) - when zoomed, center is (iw-iw/zoom)/2
  const centerXExpr = `(iw-iw/${zoomLevel})/2`;
  const centerYExpr = `(ih-ih/${zoomLevel})/2`;
  
  // Calculate panAmount based on zoom level and scene duration
  // Available margin from center to edge = (iw - iw/zoom)/2 = iw*(1 - 1/zoom)/2
  // As percentage of image width: (1 - 1/zoom)/2
  // For short scenes: use less pan to keep movement slow and smooth
  // For long scenes: use more pan to avoid pixel-by-pixel stuttering
  // Use 100% of available margin to go all the way to the edge
  const maxPanAmount = (1 - 1 / zoomLevel) / 2;
  let panAmount;
  if (duration < 5) {
    panAmount = maxPanAmount * 0.4; // 40% of margin for very short scenes (< 5s) - slow movement
  } else if (duration < 9) {
    panAmount = maxPanAmount * 0.6; // 60% of margin for short scenes (5-9s) - moderate movement
  } else {
    panAmount = maxPanAmount; // 100% of margin for long scenes (>= 9s) - full movement
  }
  const panDistXExpr = `iw*${panAmount}`;
  const panDistYExpr = `ih*${panAmount}`;
  
  // Log pan parameters for debugging (only for long scenes to avoid spam)
  if (duration >= 9) {
    console.log(`[PAN DEBUG] Scene ${sceneIndex}: duration=${duration}s, zoom=${zoomLevel}x, panAmount=${panAmount} (${(panAmount*100).toFixed(0)}%)`);
  }
  
  // For scenes >= 9 seconds, use multiple pans in different directions
  // This avoids slow pixel-by-pixel movement that causes stuttering
  // Each segment pans a significant distance, making movement fast and smooth
  const longSceneThreshold = 9.0; // seconds
  let xExpr, yExpr, effect;
  
  if (duration >= longSceneThreshold) {
    // Long scene: up to 1.5 back-and-forth pans (1 complete cycle + 0.5, stopping at peak)
    // The panAmount is now correctly calculated to use full margin without edge sticking
    
    // Choose primary direction based on scene index (alternating between X and Y)
    const useHorizontal = (sceneIndex % 2) === 0;
    
    // Global progress: 0 to 1 over entire scene
    const globalProgress = `on/${totalFrames}`;
    
    // 1.5 cycles: mod(1.5 * progress, 1) creates 1.5 cycles, then apply triangular wave
    // At progress=1, mod(1.5, 1)=0.5, so we're at the peak of the 2nd cycle
    const cycleProgress = `mod(1.5*${globalProgress},1)`;
    const triangularWave = `(1-abs(2*${cycleProgress}-1))`;
    
    // Pure linear motion - only horizontal OR vertical, never diagonal
    if (useHorizontal) {
      // Horizontal pan only (up to 1.5 back-and-forth)
      xExpr = `${centerXExpr}+iw*${panAmount}*${triangularWave}`;
      yExpr = centerYExpr; // No vertical movement
      effect = 'continuous_pan_horizontal';
    } else {
      // Vertical pan only (up to 1.5 back-and-forth)
      xExpr = centerXExpr; // No horizontal movement
      yExpr = `${centerYExpr}+ih*${panAmount}*${triangularWave}`;
      effect = 'continuous_pan_vertical';
    }
    
    console.log(`[PAN DEBUG] Scene ${sceneIndex}: 1.5 cycles, panAmount=${panAmount.toFixed(4)}`);
    
  } else {
    // Short scene: single pan direction
    // Start at center and pan immediately (no delay)
    const panDirections = ['pan_left', 'pan_right', 'pan_up', 'pan_down'];
    const direction = panDirections[sceneIndex % panDirections.length];
    
    switch (direction) {
      case 'pan_left':
        // Pan left: start at center, move left (increase X)
        xExpr = `${centerXExpr}+${panDistXExpr}*(on/${totalFrames})`;
        yExpr = centerYExpr;
        break;
      case 'pan_right':
        // Pan right: start at center, move right (decrease X)
        xExpr = `${centerXExpr}-${panDistXExpr}*(on/${totalFrames})`;
        yExpr = centerYExpr;
        break;
      case 'pan_up':
        // Pan up: start at center, move up (increase Y)
        xExpr = centerXExpr;
        yExpr = `${centerYExpr}+${panDistYExpr}*(on/${totalFrames})`;
        break;
      case 'pan_down':
        // Pan down: start at center, move down (decrease Y)
        xExpr = centerXExpr;
        yExpr = `${centerYExpr}-${panDistYExpr}*(on/${totalFrames})`;
        break;
      default:
        xExpr = centerXExpr;
        yExpr = centerYExpr;
    }
    effect = direction;
  }
  
  return {
    // Use zoompan with slight zoom (1.2x) to create margin for panning
    // This is much faster than 6x upscale for Ken Burns
    filter: `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${width}x${height}:fps=${framerate}`,
    effect: effect
  };
}

// Generate Ken Burns effect parameters for a scene
function getKenBurnsEffect(sceneIndex, duration, width, height, framerate, renderMethod = 'standard') {
  // Various zoom and pan directions for variety
  const effects = ['zoom_in', 'zoom_out', 'zoom_in_left', 'zoom_out_right', 'zoom_in_top', 'zoom_out_bottom'];
  const effect = effects[sceneIndex % effects.length]; // Deterministic but varied
  
  const totalFrames = Math.ceil(duration * framerate);
  const zoomAmount = 0.08; // 8% zoom - subtle but visible
  
  // Choose rendering method
  const useLanczos = renderMethod === 'lanczos';
  
  // Scale factor based on method
  const scaleFactor = useLanczos ? 2 : 6; // Lanczos: 2x, Standard: 6x
  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;
  
  // Generate zoom expressions (same for both methods)
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
  
  // Build filter chain based on method
  let filter;
  if (useLanczos) {
    // Lanczos method: use Lanczos interpolation for upscale and downscale
    const upscaleFilter = `scale=${scaledWidth}:${scaledHeight}:flags=lanczos`;
    const zoompanFilter = `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${scaledWidth}x${scaledHeight}:fps=${framerate}`;
    const downscaleFilter = `scale=${width}:${height}:flags=lanczos`;
    filter = `${upscaleFilter},${zoompanFilter},${downscaleFilter}`;
  } else {
    // Standard method: default interpolation (6x upscale)
    filter = `scale=${scaledWidth}:${scaledHeight},zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${scaledWidth}x${scaledHeight}:fps=${framerate},scale=${width}:${height}`;
  }
  
  return {
    filter,
    effect: useLanczos ? `${effect}_lanczos` : effect
  };
}

// Render a single scene with effect (Ken Burns or Pan)
async function renderSceneWithEffect(imagePath, outputPath, duration, width, height, framerate, sceneIndex, jobId, effectType = 'zoom', renderMethod = 'standard') {
  return new Promise((resolve, reject) => {
    console.log(`[${jobId}] Rendering scene ${sceneIndex} with effectType: "${effectType}" (type: ${typeof effectType})`);
    const isPan = String(effectType).toLowerCase().trim() === 'pan';
    console.log(`[${jobId}] Is pan effect? ${isPan}`);
    console.log(`[${jobId}] Comparison: "${String(effectType).toLowerCase().trim()}" === "pan" ? ${isPan}`);
    
    const { filter, effect } = isPan
      ? getPanEffect(sceneIndex, duration, width, height, framerate)
      : getKenBurnsEffect(sceneIndex, duration, width, height, framerate, renderMethod);
    
    console.log(`[${jobId}] Scene ${sceneIndex}: ${effect} effect (effectType: "${effectType}", isPan: ${isPan}), ${duration.toFixed(2)}s`);
    console.log(`[${jobId}] Filter: ${filter}`);
    console.log(`[${jobId}] Target dimensions: ${width}x${height}`);
    console.log(`[${jobId}] Image path: ${imagePath}`);
    
    // Preprocessing: Scale and crop image to fill the frame completely (avoid black bars)
    // This ensures images from zimage or other sources fill the entire frame
    // Use scale to fit the larger dimension, then crop to exact size
    // Note: If image is already at target size (e.g., 1920x1088), scale will preserve it
    const preprocessFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    
    // Combine preprocessing with the effect filter
    const finalFilter = isPan 
      ? `${preprocessFilter},${filter}` // For pan: preprocess then apply pan effect
      : `${preprocessFilter},${filter}`; // For zoom: preprocess then apply zoom effect
    
    // Use zoompan filter directly on the image - it generates frames from a single image
    // The filter chain handles format conversion (yuv444p -> zoompan -> yuv420p)
    const sceneFfmpegCommand = ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop', '1']) // Loop the single image
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'ultrafast',  // Much faster encoding (trades some quality for speed)
        '-crf', '23',
        '-t', duration.toString() // Duration of the output
      ])
      .videoFilters([finalFilter])
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
      });
    
    // Store scene FFmpeg command in job for cancellation
    const job = jobs.get(jobId);
    if (job) {
      if (!job.sceneCommands) {
        job.sceneCommands = [];
      }
      job.sceneCommands.push(sceneFfmpegCommand);
      jobs.set(jobId, job);
    }
    
    sceneFfmpegCommand.run();
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
      effectType = 'zoom', // 'zoom' for Ken Burns, 'pan' for pan effects
      renderMethod = 'standard' // 'standard' = 6x upscale, 'lanczos' = 2x upscale with Lanczos
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

    console.log(`[${jobId}] Video settings received: width=${width}, height=${height}, framerate=${framerate}`);
    console.log(`[${jobId}] Full videoSettings:`, JSON.stringify(videoSettings));
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
        effectType,
        renderMethod
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
          '-shortest', // End when shortest stream ends
          '-stats_period', '0.5' // Force FFmpeg to emit stats every 0.5 seconds
        ])
        .output(outputPath);

      // Store FFmpeg command reference in job for cancellation
      const job = jobs.get(jobId);
      if (job) {
        job.ffmpegCommand = ffmpegCommand;
        jobs.set(jobId, job);
      }

      // Track encoding start time for fallback progress estimation
      let encodingStartTime = null;
      let lastProgressUpdate = null;
      let lastPercent = 0;

      ffmpegCommand
        .on('start', (commandLine) => {
          console.log(`[${jobId}] FFmpeg command: ${commandLine}`);
          encodingStartTime = Date.now();
          lastProgressUpdate = Date.now();
          addStep('Encodage vidéo en cours...', 75, true);
        })
        .on('progress', (progress) => {
          const now = Date.now();
          lastProgressUpdate = now;
          
          // Log all progress data for debugging
          console.log(`[${jobId}] FFmpeg progress:`, JSON.stringify(progress));
          
          if (progress.percent !== undefined && progress.percent !== null) {
            // Parse percent (can be string or number from FFmpeg)
            let percent = typeof progress.percent === 'string' 
              ? parseFloat(progress.percent) 
              : Number(progress.percent);
            
            // Clamp percent between 0 and 100 (FFmpeg can sometimes report > 100)
            percent = Math.max(0, Math.min(100, percent));
            lastPercent = percent;
            
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
            
            console.log(`[${jobId}] Progress updated: ${Math.round(percent)}% (mapped to ${finalProgress}%)`);
          } else if (progress.timemark) {
            // If we have timemark but no percent, log it
            console.log(`[${jobId}] FFmpeg timemark: ${progress.timemark}, target: ${progress.targetSize || 'N/A'}, current: ${progress.currentKbps || 'N/A'} kbps`);
          }
        })
        .on('stderr', (stderrLine) => {
          // Capture FFmpeg stderr output for debugging
          // Look for progress indicators in stderr
          if (stderrLine.includes('time=') || stderrLine.includes('frame=') || stderrLine.includes('bitrate=')) {
            console.log(`[${jobId}] FFmpeg stderr: ${stderrLine.trim()}`);
            lastProgressUpdate = Date.now();
          }
        })
        .on('end', async () => {
          // Clean up fallback interval
          if (fallbackInterval) {
            clearInterval(fallbackInterval);
          }
          
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
          // Clean up fallback interval
          if (fallbackInterval) {
            clearInterval(fallbackInterval);
          }
          
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

      // Fallback progress updater: if no progress events for 2 seconds, estimate based on time
      const fallbackInterval = setInterval(() => {
        if (encodingStartTime && lastProgressUpdate) {
          const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
          // If no progress update for 2 seconds, assume we're still encoding
          if (timeSinceLastUpdate > 2000) {
            const job = jobs.get(jobId);
            if (job && job.status === 'processing') {
              // Estimate progress based on elapsed time (very rough, but better than nothing)
              const elapsed = Date.now() - encodingStartTime;
              // Assume encoding takes at least 10 seconds, cap at 94%
              const estimatedPercent = Math.min(94, 75 + Math.floor((elapsed / 10000) * 19));
              job.progress = clampProgress(estimatedPercent);
              job.currentStep = `Encodage vidéo en cours... (estimation)`;
              jobs.set(jobId, job);
              console.log(`[${jobId}] Fallback progress: ${estimatedPercent}% (no update for ${Math.round(timeSinceLastUpdate/1000)}s)`);
            }
          }
        }
      }, 1000);
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
    // Kill all FFmpeg processes (scenes and final concatenation)
    if (job.sceneCommands && Array.isArray(job.sceneCommands)) {
      console.log(`[${jobId}] Killing ${job.sceneCommands.length} scene FFmpeg processes...`);
      job.sceneCommands.forEach((cmd, index) => {
        try {
          cmd.kill('SIGTERM');
        } catch (err) {
          console.error(`[${jobId}] Error killing scene ${index}:`, err);
        }
      });
      // Force kill after delay
      setTimeout(() => {
        job.sceneCommands?.forEach((cmd, index) => {
          try {
            cmd.kill('SIGKILL');
          } catch (err) {
            // Ignore errors
          }
        });
      }, 2000);
    }
    
    // Kill final concatenation FFmpeg process if it exists
    if (job.ffmpegCommand) {
      console.log(`[${jobId}] Killing final FFmpeg concatenation process...`);
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
      ffmpegCommand: null,
      sceneCommands: []
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
  res.json({ 
    status: 'ok', 
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString() 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Video Render Service running on port ${PORT}`);
  console.log(`Service Version: ${SERVICE_VERSION}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
