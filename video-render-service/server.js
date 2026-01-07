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
const SERVICE_VERSION = 'v2.16-cleanup-endpoint';

// Path to FFmpeg fork with subpixel zoom support
// Install with: ./install-ffmpeg-subpixel.sh
const FFMPEG_SUBPIXEL_PATH = '/home/ubuntu/ffmpeg-subpixel-build/bin/ffmpeg';

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

async function tryUpdateProjectTranscriptFromElevenLabs({ projectId, userId, audioPath, audioUrl }) {
  if (!supabase || !projectId || !userId || !audioPath) return;

  try {
    // Fetch user's ElevenLabs API key from Vault
    const { data: apiKey, error: apiKeyError } = await supabase.rpc('get_user_api_key_for_service', {
      target_user_id: userId,
      key_name: 'eleven_labs',
    });

    if (apiKeyError || !apiKey) {
      console.warn(`[transcript] ElevenLabs key missing for user ${userId}; cannot transcribe on VPS`);
      return;
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.mp3');
    formData.append('model_id', 'scribe_v1');
    formData.append('diarize', 'true');
    formData.append('timestamps_granularity', 'word');

    console.log(`[transcript] Sending audio to ElevenLabs STT for project ${projectId}...`);

    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: formData,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`ElevenLabs STT error ${resp.status}: ${errText}`);
    }

    const transcriptionData = await resp.json();

    const formattedTranscript = {
      segments: (transcriptionData.words || [])
        .filter((w) => w && w.type === 'word')
        .map((w) => ({
          text: w.text,
          start_time: w.start,
          end_time: w.end,
        })),
      language_code: transcriptionData.language_code || 'en',
      full_text: transcriptionData.text || '',
    };

    await supabase
      .from('projects')
      .update({
        transcript_json: formattedTranscript,
        audio_url: audioUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    console.log(`[transcript] Updated transcript_json from ElevenLabs for project ${projectId} (segments=${formattedTranscript.segments.length})`);
  } catch (e) {
    console.error(`[transcript] Failed ElevenLabs transcription for project ${projectId}:`, e.message || e);
  }
}

async function shouldTranscribeWithElevenLabs({ projectId }) {
  if (!supabase || !projectId) return true;
  try {
    const { data: job, error } = await supabase
      .from('generation_jobs')
      .select('metadata, created_at')
      .eq('project_id', projectId)
      .eq('job_type', 'audio_generation')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const flag = job?.metadata?.forceElevenLabsTranscription;
    if (flag === false) {
      console.log(`[transcript] forceElevenLabsTranscription=false for project ${projectId} (skip ElevenLabs STT)`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[transcript] Failed to read generation_jobs metadata for ${projectId}; defaulting to transcribe.`, e.message || e);
    return true;
  }
}

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
// Simple format - let FFmpeg read duration from each file's metadata
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
  const totalFrames = Math.max(1, Math.ceil(duration * framerate)); // Ensure at least 1 frame
  
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
  // For short scenes: use more pan and faster movement to avoid stuttering
  // For long scenes: use full pan with smooth back-and-forth movement
  const maxPanAmount = (1 - 1 / zoomLevel) / 2;
  let panAmount;
  if (duration < 5) {
    panAmount = maxPanAmount * 1.0; // 100% of margin for very short scenes (< 5s) - maximum speed to avoid stuttering
  } else if (duration < 9) {
    panAmount = maxPanAmount * 0.95; // 95% of margin for short scenes (5-9s) - fast movement
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
    // Short scene: single pan direction with LINEAR movement (constant speed)
    const progress = `on/${totalFrames}`; // Linear 0 to 1
    
    const panDirections = ['pan_left', 'pan_right', 'pan_up', 'pan_down'];
    const direction = panDirections[sceneIndex % panDirections.length];
    
    switch (direction) {
      case 'pan_left':
        // Pan left: start at center, move left (increase X)
        xExpr = `${centerXExpr}+${panDistXExpr}*${progress}`;
        yExpr = centerYExpr;
        break;
      case 'pan_right':
        // Pan right: start at center, move right (decrease X)
        xExpr = `${centerXExpr}-${panDistXExpr}*${progress}`;
        yExpr = centerYExpr;
        break;
      case 'pan_up':
        // Pan up: start at center, move up (increase Y)
        xExpr = centerXExpr;
        yExpr = `${centerYExpr}+${panDistYExpr}*${progress}`;
        break;
      case 'pan_down':
        // Pan down: start at center, move down (decrease Y)
        xExpr = centerXExpr;
        yExpr = `${centerYExpr}-${panDistYExpr}*${progress}`;
        break;
      default:
        xExpr = centerXExpr;
        yExpr = centerYExpr;
    }
    effect = direction;
    
    // Log pan parameters for short scenes to help debug
    console.log(`[PAN DEBUG] Scene ${sceneIndex}: short scene (${duration.toFixed(2)}s), panAmount=${panAmount.toFixed(4)} (${(panAmount*100).toFixed(0)}%), direction=${direction}`);
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
  
  const totalFrames = Math.max(1, Math.ceil(duration * framerate)); // Ensure at least 1 frame
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

// Generate Subpixel Zoom effect parameters for a scene
// Uses the FFmpeg fork with subpixel=1 for smoother zoom animations
// Source: https://github.com/pYtoner/FFmpeg/tree/subpixel_zoompan
function getSubpixelZoomEffect(sceneIndex, duration, width, height, framerate) {
  // Various zoom and pan directions for variety (same as Ken Burns)
  const effects = ['zoom_in', 'zoom_out', 'zoom_in_left', 'zoom_out_right', 'zoom_in_top', 'zoom_out_bottom'];
  const effect = effects[sceneIndex % effects.length];
  
  const totalFrames = Math.max(1, Math.ceil(duration * framerate));
  const zoomAmount = 0.08; // 8% zoom - subtle but visible
  
  let zoomExpr, xExpr, yExpr;
  
  switch (effect) {
    case 'zoom_in':
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_out':
      zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_in_left':
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/4`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_out_right':
      zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)*3/4`;
      yExpr = `(ih-ih/zoom)/2`;
      break;
    case 'zoom_in_top':
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/4`;
      break;
    case 'zoom_out_bottom':
      zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)*3/4`;
      break;
    default:
      zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
      xExpr = `(iw-iw/zoom)/2`;
      yExpr = `(ih-ih/zoom)/2`;
  }
  
  // The key difference: subpixel=1 enables bilinear interpolation for smoother animations
  const filter = `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${width}x${height}:fps=${framerate}:subpixel=1`;
  
  return {
    filter,
    effect: `${effect}_subpixel`
  };
}

// Render a video scene (from animated video URL) - just transcode to match duration and format
async function renderVideoScene(videoPath, outputPath, duration, width, height, framerate, sceneIndex, jobId) {
  return new Promise((resolve, reject) => {
    console.log(`[${jobId}] Rendering animated video scene ${sceneIndex}`);
    console.log(`[${jobId}] Video file: ${videoPath}`);
    console.log(`[${jobId}] Target: ${width}x${height}@${framerate}fps, duration: ${duration}s`);
    
    // Validate video exists
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Video file not found: ${videoPath}`));
    }
    
    // Validate video is readable
    try {
      fs.accessSync(videoPath, fs.constants.R_OK);
    } catch (accessErr) {
      return reject(new Error(`Video file is not readable: ${videoPath} - ${accessErr.message}`));
    }
    
    // Validate output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      try {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`[${jobId}] Created output directory: ${outputDir}`);
      } catch (mkdirErr) {
        return reject(new Error(`Failed to create output directory: ${mkdirErr.message}`));
      }
    }
    
    // Get video info
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(`[${jobId}] Error probing video ${sceneIndex}:`, err);
        return reject(new Error(`Failed to probe video: ${err.message}`));
      }
      
      const videoStream = metadata?.streams?.find(s => s.codec_type === 'video');
      const actualWidth = videoStream?.width || 0;
      const actualHeight = videoStream?.height || 0;
      const videoDuration = parseFloat(metadata?.format?.duration) || 0;
      
      console.log(`[${jobId}] Scene ${sceneIndex} video info:`);
      console.log(`[${jobId}]   File: ${videoPath}`);
      console.log(`[${jobId}]   Dimensions: ${actualWidth}x${actualHeight}`);
      console.log(`[${jobId}]   Duration: ${videoDuration.toFixed(3)}s`);
      console.log(`[${jobId}]   Target dimensions: ${width}x${height}`);
      console.log(`[${jobId}]   Target duration: ${duration.toFixed(3)}s`);
      
      if (actualWidth === 0 || actualHeight === 0) {
        return reject(new Error(`Invalid video dimensions: ${actualWidth}x${actualHeight}`));
      }
      
      // Build FFmpeg command to transcode video
      // Scale to target dimensions, trim/extend to target duration, match framerate
      const sceneFfmpegCommand = ffmpeg(videoPath);
      
      // If video is shorter than target duration, loop it
      // If video is longer, trim it
      const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,crop=${width}:${height}`;
      
      // Calculate how many loops needed if video is shorter
      const loopsNeeded = videoDuration < duration ? Math.ceil(duration / videoDuration) : 1;
      
      if (loopsNeeded > 1) {
        // Video is shorter - loop it first, then trim
        sceneFfmpegCommand
          .inputOptions(['-stream_loop', loopsNeeded.toString()])
          .videoCodec('libx264')
          .outputOptions([
            '-preset', 'ultrafast',
            '-crf', '23',
            '-vsync', 'cfr',
            '-r', framerate.toString(), // Force framerate
            '-t', duration.toFixed(6),  // Trim to target duration
            '-pix_fmt', 'yuv420p'
          ])
          .videoFilters([scaleFilter])
          .output(outputPath);
      } else {
        // Video is longer or same length - just trim and scale
        sceneFfmpegCommand
          .videoCodec('libx264')
          .outputOptions([
            '-preset', 'ultrafast',
            '-crf', '23',
            '-vsync', 'cfr',
            '-r', framerate.toString(), // Force framerate
            '-t', duration.toFixed(6),  // Trim to target duration
            '-pix_fmt', 'yuv420p'
          ])
          .videoFilters([scaleFilter])
          .output(outputPath);
      }
      
      // Add event handlers after conditional setup
      sceneFfmpegCommand
        .on('start', (cmd) => {
          console.log(`[${jobId}] Scene ${sceneIndex} FFmpeg (video): ${cmd}`);
        })
        .on('stderr', (stderrLine) => {
          if (stderrLine.includes('error') || stderrLine.includes('Error') || stderrLine.includes('failed') || stderrLine.includes('Failed')) {
            console.error(`[${jobId}] Scene ${sceneIndex} FFmpeg stderr: ${stderrLine}`);
          }
        })
        .on('end', () => {
          console.log(`[${jobId}] Scene ${sceneIndex} (animated video) completed`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`[${jobId}] Scene ${sceneIndex} error:`, err.message);
          if (stderr) {
            console.error(`[${jobId}] Scene ${sceneIndex} FFmpeg stderr output:`, stderr);
          }
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
  });
}

// Render a single scene with effect (Ken Burns, Pan, or Subpixel Zoom)
async function renderSceneWithEffect(imagePath, outputPath, duration, width, height, framerate, sceneIndex, jobId, effectType = 'zoom', renderMethod = 'standard') {
  return new Promise((resolve, reject) => {
    console.log(`[${jobId}] Rendering scene ${sceneIndex} with effectType: "${effectType}" (type: ${typeof effectType})`);
    const normalizedEffectType = String(effectType || '').toLowerCase().trim();
    const isPan = normalizedEffectType === 'pan';
    const isSubpixelZoom = normalizedEffectType === 'zoom_subpixel';
    const isNoEffect = normalizedEffectType === 'none';
    console.log(`[${jobId}] Normalized effectType: "${normalizedEffectType}"`);
    console.log(`[${jobId}] Is pan effect? ${isPan}, Is subpixel zoom? ${isSubpixelZoom}, Is no effect? ${isNoEffect}`);
    
    // Check if FFmpeg subpixel fork is available (only for subpixel zoom)
    if (isSubpixelZoom && !fs.existsSync(FFMPEG_SUBPIXEL_PATH)) {
      return reject(new Error(`FFmpeg Subpixel fork not installed. Run install-ffmpeg-subpixel.sh on the VPS. Expected path: ${FFMPEG_SUBPIXEL_PATH}`));
    }
    
    // Verify image exists and get its dimensions
    if (!fs.existsSync(imagePath)) {
      return reject(new Error(`Image file not found: ${imagePath}`));
    }
    
    // Get actual image dimensions using ffprobe
    ffmpeg.ffprobe(imagePath, (err, metadata) => {
      if (err) {
        console.error(`[${jobId}] Error probing image ${sceneIndex}:`, err);
        return reject(new Error(`Failed to probe image: ${err.message}`));
      }
      
      const imageStream = metadata?.streams?.find(s => s.codec_type === 'video');
      const actualWidth = imageStream?.width || 0;
      const actualHeight = imageStream?.height || 0;
      const imageSize = fs.statSync(imagePath).size;
      
      console.log(`[${jobId}] Scene ${sceneIndex} image info:`);
      console.log(`[${jobId}]   File: ${imagePath}`);
      console.log(`[${jobId}]   Dimensions: ${actualWidth}x${actualHeight}`);
      console.log(`[${jobId}]   File size: ${(imageSize / 1024).toFixed(2)} KB`);
      console.log(`[${jobId}]   Target dimensions: ${width}x${height}`);
      
      if (actualWidth === 0 || actualHeight === 0) {
        return reject(new Error(`Invalid image dimensions: ${actualWidth}x${actualHeight}`));
      }
      
      // Validate image is readable
      try {
        fs.accessSync(imagePath, fs.constants.R_OK);
      } catch (accessErr) {
        return reject(new Error(`Image file is not readable: ${imagePath} - ${accessErr.message}`));
      }
      
      // Validate duration and dimensions
      if (duration <= 0 || duration > 300) {
        return reject(new Error(`Invalid duration: ${duration}s (must be > 0 and <= 300)`));
      }
      if (width <= 0 || height <= 0 || width > 7680 || height > 4320) {
        return reject(new Error(`Invalid target dimensions: ${width}x${height}`));
      }
      if (framerate <= 0 || framerate > 120) {
        return reject(new Error(`Invalid framerate: ${framerate} (must be > 0 and <= 120)`));
      }
      
      // Select the appropriate effect based on effectType
      let filter, effect, finalFilter;
      
      console.log(`[${jobId}] Scene ${sceneIndex}: Selecting effect - normalizedEffectType="${normalizedEffectType}", isNoEffect=${isNoEffect}, isPan=${isPan}, isSubpixelZoom=${isSubpixelZoom}`);
      
      if (isNoEffect) {
        // No effect: use zoompan with zoom=1 (no zoom) to generate frames for the duration
        effect = 'none';
        const totalFrames = Math.max(1, Math.ceil(duration * framerate));
        const preprocessFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,crop=${width}:${height}`;
        // zoompan with z=1 (no zoom), x/y at center, generates static frames
        const staticFilter = `zoompan=z=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${framerate}`;
        finalFilter = `${preprocessFilter},${staticFilter}`;
        console.log(`[${jobId}] Scene ${sceneIndex}: No effect (static image), ${duration.toFixed(2)}s`);
        console.log(`[${jobId}] Scene ${sceneIndex}: Final filter for no effect: ${finalFilter}`);
      } else {
        if (isPan) {
          ({ filter, effect } = getPanEffect(sceneIndex, duration, width, height, framerate));
        } else if (isSubpixelZoom) {
          ({ filter, effect } = getSubpixelZoomEffect(sceneIndex, duration, width, height, framerate));
        } else {
          // Default: Ken Burns zoom
          console.log(`[${jobId}] Scene ${sceneIndex}: Falling back to Ken Burns (effectType="${effectType}", normalized="${normalizedEffectType}")`);
          ({ filter, effect } = getKenBurnsEffect(sceneIndex, duration, width, height, framerate, renderMethod));
        }
        
        // Validate filter string is not empty
        if (!filter || filter.trim().length === 0) {
          return reject(new Error(`Empty filter generated for scene ${sceneIndex}`));
        }
        
        console.log(`[${jobId}] Scene ${sceneIndex}: ${effect} effect (effectType: "${effectType}", isPan: ${isPan}), ${duration.toFixed(2)}s`);
        console.log(`[${jobId}] Filter: ${filter}`);
        
        // Preprocessing: Resize image to fit target dimensions, then crop minimally to avoid black bars
        // Strategy: First downscale/upscale to fit within target dimensions (maintains aspect ratio)
        // Then crop only the minimum necessary to reach exact dimensions and avoid black bars
        // This minimizes content loss while ensuring the frame is filled
        const preprocessFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,crop=${width}:${height}`;
        
        // Combine preprocessing with the effect filter
        finalFilter = `${preprocessFilter},${filter}`;
      }
      
      // Validate filter string doesn't contain invalid characters
      if (finalFilter.includes('undefined') || finalFilter.includes('NaN') || finalFilter.includes('Infinity')) {
        return reject(new Error(`Invalid filter contains undefined/NaN/Infinity: ${finalFilter}`));
      }
      
      console.log(`[${jobId}] Final filter chain: ${finalFilter}`);
      
      console.log(`[${jobId}] Final filter chain: ${finalFilter}`);
      
      // Validate output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        try {
          fs.mkdirSync(outputDir, { recursive: true });
          console.log(`[${jobId}] Created output directory: ${outputDir}`);
        } catch (mkdirErr) {
          return reject(new Error(`Failed to create output directory: ${mkdirErr.message}`));
        }
      }
      
      // Use zoompan filter directly on the image - it generates frames from a single image
      // The filter chain handles format conversion (yuv444p -> zoompan -> yuv420p)
      const sceneFfmpegCommand = ffmpeg();
      
      // For subpixel zoom, use the forked FFmpeg binary with subpixel support
      if (isSubpixelZoom) {
        sceneFfmpegCommand.setFfmpegPath(FFMPEG_SUBPIXEL_PATH);
        console.log(`[${jobId}] Scene ${sceneIndex}: Using FFmpeg subpixel fork at ${FFMPEG_SUBPIXEL_PATH}`);
      }
      
      sceneFfmpegCommand
        .input(imagePath)
        .inputOptions(['-loop', '1']) // Loop the single image
        .videoCodec('libx264')
        .outputOptions([
          '-preset', 'ultrafast',
          '-crf', '23',
          '-vsync', 'cfr',  // Constant frame rate
          '-t', duration.toFixed(6),  // Precise duration
          // Optimizations for subpixel zoom (bilinear interpolation is more CPU-intensive)
          ...(isSubpixelZoom ? [
            '-threads', '0',  // Use all available CPU threads
            '-tune', 'fastdecode',  // Optimize for speed
            '-x264-params', 'threads=0:lookahead-threads=0'  // Parallel encoding
          ] : [])
        ])
        .videoFilters([finalFilter])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log(`[${jobId}] Scene ${sceneIndex} FFmpeg: ${cmd}`);
        })
        .on('stderr', (stderrLine) => {
          // Log FFmpeg stderr for debugging - filter out verbose messages
          if (stderrLine.includes('error') || stderrLine.includes('Error') || stderrLine.includes('failed') || stderrLine.includes('Failed')) {
            console.error(`[${jobId}] Scene ${sceneIndex} FFmpeg stderr: ${stderrLine}`);
          }
        })
        .on('end', () => {
          console.log(`[${jobId}] Scene ${sceneIndex} completed`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`[${jobId}] Scene ${sceneIndex} error:`, err.message);
          console.error(`[${jobId}] Scene ${sceneIndex} error details:`, err);
          if (stderr) {
            console.error(`[${jobId}] Scene ${sceneIndex} FFmpeg stderr output:`, stderr);
          }
          if (stdout) {
            console.error(`[${jobId}] Scene ${sceneIndex} FFmpeg stdout output:`, stdout);
          }
          // Extract more details from error if available
          const errorDetails = {
            message: err.message,
            code: err.code,
            signal: err.signal,
            killed: err.killed,
            cmd: err.cmd,
            imagePath,
            outputPath,
            finalFilter,
            duration,
            width,
            height,
            framerate,
            effectType
          };
          console.error(`[${jobId}] Scene ${sceneIndex} full error context:`, JSON.stringify(errorDetails, null, 2));
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
    // Log job start with active jobs info
    const activeJobsBefore = Array.from(jobs.values()).filter(j => j.status === 'processing' || j.status === 'pending').length;
    console.log(`[${jobId}] Starting render job. Active jobs before: ${activeJobsBefore}, Total jobs: ${jobs.size}`);
    
    // Update job status with steps array
    jobs.set(jobId, { status: 'processing', progress: 0, startTime, steps: [], currentStep: null });
    
    // Create working directory - each job has its own isolated directory
    await mkdir(workDir, { recursive: true });
    console.log(`[${jobId}] Created isolated work directory: ${workDir}`);
    
    const {
      scenes,
      audioUrl,
      subtitleSettings,
      videoSettings = {},
      projectId,
      projectName,
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

    // Debug: Calculate total video duration from scenes
    const totalVideoDuration = scenes.reduce((total, scene) => {
      const sceneDuration = scene.endTime - scene.startTime;
      return total + sceneDuration;
    }, 0);
    const lastScene = scenes[scenes.length - 1];
    console.log(`[${jobId}] DURATION DEBUG:`);
    console.log(`[${jobId}]   Total scenes: ${scenes.length}`);
    console.log(`[${jobId}]   First scene: ${scenes[0].startTime}s - ${scenes[0].endTime}s`);
    console.log(`[${jobId}]   Last scene: ${lastScene.startTime}s - ${lastScene.endTime}s`);
    console.log(`[${jobId}]   Sum of scene durations: ${totalVideoDuration.toFixed(3)}s`);
    console.log(`[${jobId}]   Last scene endTime (expected video end): ${lastScene.endTime}s`);

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
    
    // Get audio duration using ffprobe
    const audioDuration = await new Promise((resolve) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          console.error(`[${jobId}] Error getting audio duration:`, err);
          resolve(null);
        } else {
          const duration = metadata?.format?.duration;
          console.log(`[${jobId}]   Audio duration (ffprobe): ${duration}s`);
          resolve(duration);
        }
      });
    });
    
    // Compare audio duration with video duration
    if (audioDuration) {
      const diff = audioDuration - lastScene.endTime;
      console.log(`[${jobId}]   Duration difference (audio - video): ${diff.toFixed(3)}s`);
      if (Math.abs(diff) > 0.5) {
        console.warn(`[${jobId}]   WARNING: Audio and video durations differ by more than 0.5s!`);
      }
    }
    
    addStep('Audio téléchargé', 15);

    // Step 2: Download all images and videos
    addStep(`Téléchargement de ${scenes.length} médias...`, 20, true);
    const imagesDir = path.join(workDir, 'images');
    const videosDir = path.join(workDir, 'videos');
    await mkdir(imagesDir, { recursive: true });
    await mkdir(videosDir, { recursive: true });
    
    let downloadedCount = 0;
    const mediaPromises = scenes.map(async (scene, index) => {
      if (scene.videoUrl) {
        // Download animated video
        const videoPath = path.join(videosDir, `scene_${index}.mp4`);
        await downloadFile(scene.videoUrl, videoPath);
        downloadedCount++;
        const job = jobs.get(jobId);
        if (job) {
          job.currentStep = `Téléchargement des médias... ${downloadedCount}/${scenes.length}`;
          jobs.set(jobId, job);
        }
        return { type: 'video', path: videoPath, index };
      } else if (scene.imageUrl) {
        // Download image
        const imagePath = path.join(imagesDir, `scene_${index}.jpg`);
        await downloadFile(scene.imageUrl, imagePath);
        downloadedCount++;
        const job = jobs.get(jobId);
        if (job) {
          job.currentStep = `Téléchargement des médias... ${downloadedCount}/${scenes.length}`;
          jobs.set(jobId, job);
        }
        return { type: 'image', path: imagePath, index };
      } else {
        throw new Error(`Scene ${index} has no image or video URL`);
      }
    });
    
    const mediaFiles = await Promise.all(mediaPromises);
    addStep(`Tous les médias téléchargés (${scenes.length}/${scenes.length})`, 30);

    // Step 3: Create segments directory for Ken Burns rendered scenes
    const segmentsDir = path.join(workDir, 'segments');
    await mkdir(segmentsDir, { recursive: true });

    // Step 4: Render each scene with effect
    let effectLabel;
    if (effectType === 'pan') {
      effectLabel = 'pan';
    } else if (effectType === 'zoom_subpixel') {
      effectLabel = 'zoom subpixel';
    } else if (effectType === 'none') {
      effectLabel = 'aucun effet';
    } else {
      effectLabel = 'Ken Burns';
    }
    addStep(`Application de l'effet ${effectLabel} sur les scènes...`, 35);
    
    let totalRenderedDuration = 0;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const mediaFile = mediaFiles.find(m => m.index === i);
      const segmentPath = path.join(segmentsDir, `segment_${i}.mp4`);
      const duration = scene.endTime - scene.startTime;
      totalRenderedDuration += duration;
      
      // Log each scene's timing
      if (i === 0 || i === scenes.length - 1 || i % 20 === 0) {
        console.log(`[${jobId}] Scene ${i}: ${scene.startTime.toFixed(3)}s - ${scene.endTime.toFixed(3)}s (duration: ${duration.toFixed(3)}s)`);
        if (scene.videoUrl) {
          console.log(`[${jobId}] Scene ${i}: Using animated video (videoUrl present)`);
        } else {
          console.log(`[${jobId}] Scene ${i}: Using static image with effect`);
        }
      }
      
      // Show current scene being processed (updates the same line)
      const job = jobs.get(jobId);
      if (job) {
        job.currentStep = `Rendu de la scène ${i + 1}/${scenes.length}...`;
        jobs.set(jobId, job);
      }
      
      if (mediaFile?.type === 'video') {
        // Render animated video scene (no effects, just transcode)
        await renderVideoScene(
          mediaFile.path,
          segmentPath,
          duration,
          width,
          height,
          framerate,
          i,
          jobId
        );
      } else if (mediaFile?.type === 'image') {
        // Render static image with effect
        await renderSceneWithEffect(
          mediaFile.path, 
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
      } else {
        throw new Error(`Scene ${i} has no media file`);
      }
      
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
    console.log(`[${jobId}] Total rendered video duration (expected): ${totalRenderedDuration.toFixed(3)}s`);
    
    // Verify actual segment durations
    let actualTotalDuration = 0;
    for (let i = 0; i < scenes.length; i++) {
      const segmentPath = path.join(segmentsDir, `segment_${i}.mp4`);
      const segmentDuration = await new Promise((resolve) => {
        ffmpeg.ffprobe(segmentPath, (err, metadata) => {
          if (err) {
            console.error(`[${jobId}] Error probing segment ${i}:`, err.message);
            resolve(0);
          } else {
            resolve(parseFloat(metadata?.format?.duration) || 0);
          }
        });
      });
      actualTotalDuration += segmentDuration;
      
      // Log first, last, and any segment with duration mismatch
      const expectedDuration = scenes[i].endTime - scenes[i].startTime;
      const diff = segmentDuration - expectedDuration;
      if (i === 0 || i === scenes.length - 1 || Math.abs(diff) > 0.1) {
        console.log(`[${jobId}] Segment ${i}: expected ${expectedDuration.toFixed(3)}s, actual ${segmentDuration.toFixed(3)}s (diff: ${diff.toFixed(3)}s)`);
      }
    }
    console.log(`[${jobId}] Actual total from segments: ${actualTotalDuration.toFixed(3)}s`);
    
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
    
    // Sanitize project name for filename (remove invalid characters)
    const sanitizedProjectName = (projectName || 'video')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Remove invalid filename characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length
    
    const outputPath = path.join(workDir, `${sanitizedProjectName}.${format}`);
    
    // Log concat file content for debugging
    const concatFileContent = fs.readFileSync(concatPath, 'utf8');
    console.log(`[${jobId}] Concat file (first 500 chars): ${concatFileContent.substring(0, 500)}`);
    console.log(`[${jobId}] Concat file has ${concatFileContent.split('\n').filter(l => l.startsWith('file')).length} files`);
    
    // Check available disk space before concatenation
    try {
      const { execSync } = require('child_process');
      const dfOutput = execSync(`df -BM ${TEMP_DIR} | tail -1 | awk '{print $4}'`).toString().trim();
      let availableMB = parseInt(dfOutput.replace('M', ''));
      console.log(`[${jobId}] Available disk space: ${availableMB} MB`);
      
      // Estimate required space (segments size * 1.5 for safety)
      let totalSegmentSize = 0;
      for (let i = 0; i < scenes.length; i++) {
        const segmentPath = path.join(segmentsDir, `segment_${i}.mp4`);
        if (fs.existsSync(segmentPath)) {
          totalSegmentSize += fs.statSync(segmentPath).size;
        }
      }
      const requiredMB = Math.ceil((totalSegmentSize * 1.5) / 1024 / 1024);
      console.log(`[${jobId}] Estimated space needed: ${requiredMB} MB (segments: ${Math.ceil(totalSegmentSize / 1024 / 1024)} MB)`);
      
      // If insufficient space, try to clean up old jobs
      if (availableMB < requiredMB + 500) {
        console.log(`[${jobId}] Insufficient disk space. Attempting to clean up old jobs...`);
        const cleanupResult = await cleanupOldJobs(1); // Clean jobs older than 1 hour
        console.log(`[${jobId}] Cleanup result: ${cleanupResult.deletedCount} jobs deleted, ${cleanupResult.freedMB.toFixed(2)} MB freed`);
        
        // Re-check available space after cleanup
        const dfOutputAfter = execSync(`df -BM ${TEMP_DIR} | tail -1 | awk '{print $4}'`).toString().trim();
        availableMB = parseInt(dfOutputAfter.replace('M', ''));
        console.log(`[${jobId}] Available disk space after cleanup: ${availableMB} MB`);
      }
      
      if (availableMB < requiredMB + 500) { // Keep 500MB buffer
        throw new Error(`Insufficient disk space. Available: ${availableMB}MB, Required: ${requiredMB}MB + 500MB buffer. Please free up space manually or wait for cleanup script.`);
      }
    } catch (diskErr) {
      if (diskErr.message.includes('Insufficient disk space')) {
        throw diskErr;
      }
      console.warn(`[${jobId}] Could not check disk space: ${diskErr.message}`);
    }
    
    // Verify all segment files exist and are valid before concatenation
    console.log(`[${jobId}] Verifying segment files...`);
    for (let i = 0; i < scenes.length; i++) {
      const segmentPath = path.join(segmentsDir, `segment_${i}.mp4`);
      if (!fs.existsSync(segmentPath)) {
        throw new Error(`Segment file missing: ${segmentPath}`);
      }
      const stats = fs.statSync(segmentPath);
      if (stats.size < 1000) {
        throw new Error(`Segment file too small (${stats.size} bytes): ${segmentPath}`);
      }
      // Log segment sizes for first, last, and every 10th
      if (i === 0 || i === scenes.length - 1 || i % 10 === 0) {
        console.log(`[${jobId}] Segment ${i}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      }
    }
    console.log(`[${jobId}] All ${scenes.length} segment files verified`);
    
    return new Promise((resolve, reject) => {
      console.log(`[${jobId}] Starting final concatenation with ${scenes.length} segments + audio`);
      
      // Use audio duration as the definitive output duration
      const outputDuration = audioDuration ? parseFloat(audioDuration) : lastScene.endTime;
      console.log(`[${jobId}] Output duration will be limited to: ${outputDuration.toFixed(3)}s (audio duration)`);
      console.log(`[${jobId}] Video segments total: ${actualTotalDuration.toFixed(3)}s, Audio: ${audioDuration}s`);
      
      let ffmpegCommand = ffmpeg()
        .input(concatPath)
        .inputOptions([
          '-f', 'concat', 
          '-safe', '0',
          '-fflags', '+genpts+igndts',  // Regenerate timestamps, ignore DTS
          '-avoid_negative_ts', 'make_zero'  // Fix any negative timestamps
        ])
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-map', '0:v',  // Map video from first input (concat)
          '-map', '1:a',  // Map audio from second input (audio file)
          '-t', outputDuration.toFixed(3),  // IMPORTANT: Limit output to audio duration exactly
          '-preset', 'ultrafast',
          '-crf', '28',
          '-pix_fmt', 'yuv420p',
          '-movflags', 'faststart',  // Remove + prefix for cleaner syntax
          '-threads', '0',
          '-vsync', 'cfr',  // Constant frame rate
          '-max_muxing_queue_size', '9999',  // Large buffer to prevent queue overflow
          '-stats_period', '0.5'
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
      let ffmpegStderr = [];  // Collect stderr for debugging

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
          
          // Log progress data (reduce spam by only logging every 5%)
          let percent = 0;
          
          // Calculate percent from timemark (more reliable than FFmpeg's percent for concat)
          if (progress.timemark) {
            // Parse timemark (format: HH:MM:SS.ms)
            const parts = progress.timemark.split(':');
            if (parts.length >= 3) {
              const hours = parseFloat(parts[0]) || 0;
              const minutes = parseFloat(parts[1]) || 0;
              const seconds = parseFloat(parts[2]) || 0;
              const currentTime = hours * 3600 + minutes * 60 + seconds;
              
              // Calculate percent based on expected duration (from audio or scenes)
              const refDuration = audioDuration ? parseFloat(audioDuration) : lastScene.endTime;
              if (refDuration > 0) {
                percent = Math.min(100, (currentTime / refDuration) * 100);
              }
            }
          }
          
          // Fallback to FFmpeg's percent if timemark calculation failed
          if (percent === 0 && progress.percent !== undefined && progress.percent !== null) {
            percent = typeof progress.percent === 'string' 
              ? parseFloat(progress.percent) 
              : Number(progress.percent);
            // FFmpeg's percent for concat can be very wrong, so cap it at 100
            percent = Math.min(100, Math.max(0, percent));
          }
          
          // Only log and update if percent changed significantly (every ~5%)
          if (Math.abs(percent - lastPercent) >= 5 || percent >= 99) {
            console.log(`[${jobId}] FFmpeg progress: ${percent.toFixed(1)}% (timemark: ${progress.timemark}, frames: ${progress.frames})`);
            lastPercent = percent;
          }
          
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
        })
        .on('stderr', (stderrLine) => {
          // Capture FFmpeg stderr output for debugging
          // Collect error lines for later analysis
          if (stderrLine.includes('error') || stderrLine.includes('Error') || 
              stderrLine.includes('failed') || stderrLine.includes('Failed') ||
              stderrLine.includes('Invalid') || stderrLine.includes('Discarding')) {
            ffmpegStderr.push(stderrLine.trim());
            console.error(`[${jobId}] FFmpeg stderr ERROR: ${stderrLine.trim()}`);
          }
          // Progress indicators
          if (stderrLine.includes('time=') || stderrLine.includes('frame=')) {
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
            // Verify final video duration
            const finalDuration = await new Promise((resolve) => {
              ffmpeg.ffprobe(outputPath, (err, metadata) => {
                if (err) {
                  console.error(`[${jobId}] Error getting final video duration:`, err);
                  resolve(null);
                } else {
                  const videoDuration = metadata?.format?.duration;
                  const videoStream = metadata?.streams?.find(s => s.codec_type === 'video');
                  const audioStream = metadata?.streams?.find(s => s.codec_type === 'audio');
                  console.log(`[${jobId}] FINAL OUTPUT DURATION:`);
                  console.log(`[${jobId}]   Container duration: ${videoDuration}s`);
                  console.log(`[${jobId}]   Video stream: ${videoStream?.duration || 'N/A'}s, ${videoStream?.nb_frames || 'N/A'} frames`);
                  console.log(`[${jobId}]   Audio stream: ${audioStream?.duration || 'N/A'}s`);
                  console.log(`[${jobId}]   Expected (from scenes): ${lastScene.endTime}s`);
                  if (videoDuration && lastScene.endTime) {
                    const diff = videoDuration - lastScene.endTime;
                    console.log(`[${jobId}]   Difference: ${diff.toFixed(3)}s`);
                    if (diff < -1) {
                      console.error(`[${jobId}]   ERROR: Final video is ${Math.abs(diff).toFixed(1)}s shorter than expected!`);
                    }
                  }
                  resolve(videoDuration);
                }
              });
            });
            
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
        .on('error', async (err, stdout, stderr) => {
          // Clean up fallback interval
          if (fallbackInterval) {
            clearInterval(fallbackInterval);
          }
          
          console.error(`[${jobId}] FFmpeg final concatenation error:`, err.message);
          
          // Log collected stderr errors
          if (ffmpegStderr.length > 0) {
            console.error(`[${jobId}] FFmpeg stderr errors collected (${ffmpegStderr.length} lines):`);
            ffmpegStderr.forEach((line, i) => console.error(`[${jobId}]   ${i + 1}: ${line}`));
          }
          
          // Log full stderr if available
          if (stderr) {
            const lastLines = stderr.split('\n').slice(-20).join('\n');
            console.error(`[${jobId}] FFmpeg stderr (last 20 lines):\n${lastLines}`);
          }
          
          // Log diagnostic info
          console.error(`[${jobId}] Diagnostic info:`);
          console.error(`[${jobId}]   Audio duration: ${audioDuration}s`);
          console.error(`[${jobId}]   Video duration (from segments): ${actualTotalDuration.toFixed(3)}s`);
          console.error(`[${jobId}]   Last scene end time: ${lastScene.endTime}s`);
          console.error(`[${jobId}]   Output path: ${outputPath}`);
          
          // Check disk space
          try {
            const { execSync } = require('child_process');
            const diskSpace = execSync('df -h ' + TEMP_DIR).toString();
            console.error(`[${jobId}] Disk space:\n${diskSpace}`);
          } catch (e) {
            console.error(`[${jobId}] Could not check disk space`);
          }
          
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
  
  // Log current active jobs count
  const activeJobsCount = Array.from(jobs.values()).filter(j => j.status === 'processing' || j.status === 'pending').length;
  console.log(`[${jobId}] Current active jobs: ${activeJobsCount}`);
  console.log(`[${jobId}] Total jobs in memory: ${jobs.size}`);

  // Initialize job status
  jobs.set(jobId, { status: 'pending', progress: 0, steps: [], createdAt: new Date().toISOString() });

  // Start processing in background (don't await)
  // Each job runs independently - no cancellation of other jobs
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

// Cleanup old completed/failed jobs from temp directory to free up space
async function cleanupOldJobs(maxAgeHours = 1) {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      return { deletedCount: 0, freedMB: 0 };
    }
    
    const entries = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    let deletedCount = 0;
    let freedBytes = 0;
    
    for (const entry of entries) {
      const jobDir = path.join(TEMP_DIR, entry);
      try {
        const stats = fs.statSync(jobDir);
        if (stats.isDirectory()) {
          // Check if job is old enough to delete
          const ageMs = now - stats.mtimeMs;
          if (ageMs > maxAgeMs) {
            // Check job status in memory
            const jobId = entry;
            const job = jobs.get(jobId);
            
            // Only delete if job is completed, failed, or cancelled (or not in memory = old)
            if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
              // Calculate size before deletion
              let dirSize = 0;
              try {
                const { execSync } = require('child_process');
                const duOutput = execSync(`du -sb ${jobDir} 2>/dev/null || echo 0`).toString().trim();
                dirSize = parseInt(duOutput.split('\t')[0]) || 0;
              } catch (e) {
                // Fallback: estimate from files
                const files = fs.readdirSync(jobDir, { recursive: true });
                for (const file of files) {
                  try {
                    const filePath = path.join(jobDir, file);
                    const fileStats = fs.statSync(filePath);
                    if (fileStats.isFile()) {
                      dirSize += fileStats.size;
                    }
                  } catch (e) {
                    // Ignore
                  }
                }
              }
              
              // Delete the directory
              await cleanup(jobDir);
              deletedCount++;
              freedBytes += dirSize;
              console.log(`Cleaned up old job: ${jobId} (${(dirSize / 1024 / 1024).toFixed(2)} MB, ${(ageMs / 3600000).toFixed(1)}h old)`);
            }
          }
        }
      } catch (err) {
        // Ignore errors for individual entries
        console.warn(`Error checking ${entry}:`, err.message);
      }
    }
    
    return { deletedCount, freedMB: freedBytes / 1024 / 1024 };
  } catch (error) {
    console.error('Error in cleanupOldJobs:', error);
    return { deletedCount: 0, freedMB: 0 };
  }
}

// Generate script endpoint - calls Anthropic API without timeout
app.post('/generate-script', async (req, res) => {
  const {
    anthropicApiKey,
    customPrompt,
    model = 'claude-opus-4-5-20251101',
    thinkingBudgetTokens,
    maxTokens,
  } = req.body;
  
  if (!anthropicApiKey) {
    return res.status(400).json({ error: 'Anthropic API key required' });
  }
  
  if (!customPrompt) {
    return res.status(400).json({ error: 'Custom prompt required' });
  }
  
  console.log(`[generate-script] Starting script generation with model: ${model}`);
  console.log(`[generate-script] Prompt length: ${customPrompt.length} characters`);
  
  const systemPrompt = `Tu es un assistant d'écriture professionnel. Tu génères exactement ce que l'utilisateur demande, sans commentaires ni explications supplémentaires. Réponds uniquement avec le contenu demandé.

RÈGLE CRITIQUE SUR LA LONGUEUR:
- Si l'utilisateur demande un certain nombre de mots, tu DOIS atteindre ce nombre MINIMUM
- Ne t'arrête JAMAIS avant d'avoir atteint le nombre de mots demandé
- Développe chaque section en profondeur pour atteindre la longueur requise
- Ajoute des détails, des exemples, des transitions, des descriptions riches`;

  try {
    const startTime = Date.now();

    // Extended thinking (if requested)
    const parsedThinkingBudget = Number(thinkingBudgetTokens);
    const enableThinking = Number.isFinite(parsedThinkingBudget) && parsedThinkingBudget > 0;

    // We treat maxTokens as the desired output budget (excluding thinking) and add thinking budget on top,
    // since Anthropic subtracts thinking tokens from max_tokens.
    const desiredOutputMaxTokens = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Number(maxTokens) : 16000;
    const totalMaxTokens = enableThinking ? desiredOutputMaxTokens + parsedThinkingBudget : desiredOutputMaxTokens;

    if (enableThinking) {
      console.log(`[generate-script] Extended thinking enabled (budget_tokens=${parsedThinkingBudget}, max_tokens=${totalMaxTokens})`);
    } else {
      console.log(`[generate-script] Extended thinking disabled (max_tokens=${totalMaxTokens})`);
    }

    const requestBody = {
      model: model,
      max_tokens: totalMaxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: customPrompt
        }
      ]
    };

    if (enableThinking) {
      requestBody.thinking = {
        type: 'enabled',
        budget_tokens: parsedThinkingBudget
      };
    }
    
    const anthropicResponse = await axios.post('https://api.anthropic.com/v1/messages', requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        ...(enableThinking ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {})
      },
      timeout: 600000 // 10 minutes timeout
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[generate-script] API call completed in ${duration}s`);
    
    // Extract the script from the response
    let script = '';
    if (anthropicResponse.data.content && anthropicResponse.data.content.length > 0) {
      script = anthropicResponse.data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
    }
    
    if (!script) {
      throw new Error('No script content returned from Anthropic API');
    }
    
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`[generate-script] Script generated: ${wordCount} words`);
    
    res.json({
      script,
      wordCount,
      estimatedDuration: Math.round(wordCount / 2.5),
      model,
      generationTime: parseFloat(duration)
    });
    
  } catch (error) {
    console.error('[generate-script] Error:', error.response?.data || error.message);
    
    const errorMessage = error.response?.data?.error?.message || error.message;
    res.status(500).json({ 
      error: `Anthropic API error: ${errorMessage}` 
    });
  }
});

// Cleanup endpoint - manually trigger cleanup of old files
app.post('/cleanup', async (req, res) => {
  const { maxAgeDays = 4 } = req.body;
  const maxAgeHours = maxAgeDays * 24;
  
  console.log(`[cleanup] Starting cleanup of files older than ${maxAgeDays} days (${maxAgeHours} hours)`);
  
  try {
    const result = await cleanupOldJobs(maxAgeHours);
    
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      freedMB: result.freedMB.toFixed(2),
      maxAgeDays,
      message: `Cleaned up ${result.deletedCount} jobs, freed ${result.freedMB.toFixed(2)} MB`
    });
  } catch (error) {
    console.error('[cleanup] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Concatenate multiple audio files into one
app.post('/concat-audio', async (req, res) => {
  const { audioUrls, userId, projectId } = req.body;
  
  if (!audioUrls || !Array.isArray(audioUrls) || audioUrls.length === 0) {
    return res.status(400).json({ error: 'audioUrls array is required' });
  }

  const jobId = `concat_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const workDir = path.join(TEMP_DIR, jobId);
  
  console.log(`[${jobId}] Starting audio concatenation for ${audioUrls.length} files`);

  try {
    // Create work directory
    await mkdir(workDir, { recursive: true });

    // Download all audio files
    const audioFiles = [];
    const audioDurations = [];
    for (let i = 0; i < audioUrls.length; i++) {
      const audioPath = path.join(workDir, `audio_${i}.mp3`);
      console.log(`[${jobId}] Downloading audio ${i + 1}/${audioUrls.length}: ${audioUrls[i].substring(0, 100)}...`);
      await downloadFile(audioUrls[i], audioPath);
      audioFiles.push(audioPath);

      // Get duration for each chunk (seconds)
      const duration = await new Promise((resolve) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
          if (err) {
            console.error(`[${jobId}] ffprobe error for audio_${i}.mp3:`, err.message || err);
            resolve(null);
            return;
          }
          const d = metadata?.format?.duration;
          resolve(typeof d === 'number' ? d : (d ? parseFloat(d) : null));
        });
      });
      audioDurations.push(duration);
      console.log(`[${jobId}] Audio ${i + 1}/${audioUrls.length} duration: ${duration ?? 'unknown'}s`);
    }

    // Create concat file for FFmpeg
    const concatFilePath = path.join(workDir, 'concat.txt');
    const concatContent = audioFiles.map(f => `file '${f}'`).join('\n');
    await writeFile(concatFilePath, concatContent);

    // Output file
    const outputFilename = `${userId || 'unknown'}_${projectId || 'temp'}_${Date.now()}_concat.mp3`;
    const outputPath = path.join(TEMP_DIR, outputFilename);

    // Run FFmpeg concatenation
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(outputPath)
        .on('start', (cmd) => {
          console.log(`[${jobId}] FFmpeg command: ${cmd}`);
        })
        .on('error', (err) => {
          console.error(`[${jobId}] FFmpeg error:`, err);
          reject(err);
        })
        .on('end', () => {
          console.log(`[${jobId}] FFmpeg concatenation complete`);
          resolve();
        })
        .run();
    });

    // Clean up work directory
    try {
      const files = fs.readdirSync(workDir);
      for (const file of files) {
        await unlink(path.join(workDir, file));
      }
      fs.rmdirSync(workDir);
    } catch (cleanupError) {
      console.warn(`[${jobId}] Cleanup warning:`, cleanupError.message);
    }

    // Generate public URL (use VPS_PUBLIC_URL from env)
    const publicUrl = `${process.env.VPS_PUBLIC_URL || `http://localhost:${PORT}`}/videos/${outputFilename}`;
    
    console.log(`[${jobId}] Audio concatenation complete: ${publicUrl}`);

    res.json({
      success: true,
      audioUrl: publicUrl,
      filename: outputFilename,
      durations: audioDurations,
      totalDuration: audioDurations.reduce((sum, d) => sum + (typeof d === 'number' ? d : 0), 0),
    });

    // Best-effort: produce a reliable transcript_json via ElevenLabs STT on the VPS,
    // but only if the job metadata doesn't explicitly opt out.
    if (projectId && userId && supabase) {
      setTimeout(async () => {
        const shouldTranscribe = await shouldTranscribeWithElevenLabs({ projectId });
        if (!shouldTranscribe) return;
        tryUpdateProjectTranscriptFromElevenLabs({
          projectId,
          userId,
          audioPath: outputPath,
          audioUrl: publicUrl,
        });
      }, 1500);
    }

  } catch (error) {
    console.error(`[${jobId}] Concatenation error:`, error);
    
    // Clean up on error
    try {
      if (fs.existsSync(workDir)) {
        const files = fs.readdirSync(workDir);
        for (const file of files) {
          await unlink(path.join(workDir, file)).catch(() => {});
        }
        fs.rmdirSync(workDir);
      }
    } catch (cleanupError) {
      console.warn(`[${jobId}] Cleanup error:`, cleanupError.message);
    }

    res.status(500).json({
      error: error.message || 'Audio concatenation failed'
    });
  }
});

// Probe audio duration (used when timestamps are missing)
app.post('/probe-audio-duration', async (req, res) => {
  const { audioUrl } = req.body || {};
  if (!audioUrl || typeof audioUrl !== 'string') {
    return res.status(400).json({ error: 'audioUrl is required' });
  }

  const jobId = `probe_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const workDir = path.join(TEMP_DIR, jobId);
  const audioPath = path.join(workDir, 'audio.mp3');

  try {
    await mkdir(workDir, { recursive: true });
    console.log(`[${jobId}] Probing audio duration: ${audioUrl.substring(0, 120)}...`);

    await downloadFile(audioUrl, audioPath);

    const duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        const d = metadata?.format?.duration;
        resolve(typeof d === 'number' ? d : (d ? parseFloat(d) : null));
      });
    });

    // Cleanup best-effort
    try {
      await unlink(audioPath);
      fs.rmdirSync(workDir);
    } catch (_) {}

    res.json({ success: true, duration });
  } catch (error) {
    console.error(`[${jobId}] Probe error:`, error.message || error);
    try {
      if (fs.existsSync(workDir)) {
        const files = fs.readdirSync(workDir);
        for (const file of files) {
          await unlink(path.join(workDir, file)).catch(() => {});
        }
        fs.rmdirSync(workDir);
      }
    } catch (_) {}
    res.status(500).json({ error: error.message || 'Probe failed' });
  }
});

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
