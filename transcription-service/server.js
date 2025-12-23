const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { spawn, execSync } = require('child_process');
const multer = require('multer');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Version identifier
const SERVICE_VERSION = 'v1.1.0-youtube';

// Create temp directory
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));

// Multer for file uploads
const upload = multer({ 
  dest: TEMP_DIR,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

// Job status storage
const jobs = new Map();

// Cleanup old jobs every hour
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [jobId, job] of jobs.entries()) {
    if (job.createdAt && (now - new Date(job.createdAt).getTime()) > maxAge) {
      jobs.delete(jobId);
      console.log(`[Cleanup] Removed old job: ${jobId}`);
    }
  }
}, 60 * 60 * 1000);

// Helper function to download file
async function downloadFile(url, filepath) {
  console.log(`Downloading: ${url}`);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 300000, // 5 minutes timeout
  });
  
  const writer = fs.createWriteStream(filepath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Helper function to extract audio from video using ffmpeg
async function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-vn',                    // No video
      '-acodec', 'pcm_s16le',   // WAV format (required by Whisper)
      '-ar', '16000',           // 16kHz sample rate (optimal for Whisper)
      '-ac', '1',               // Mono
      '-y',                     // Overwrite output
      outputPath
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Extract YouTube video ID from URL
function extractYouTubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Download YouTube audio using yt-dlp
async function downloadYouTubeAudio(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading YouTube audio: ${url}`);
    
    const ytdlp = spawn('yt-dlp', [
      '-x',                          // Extract audio
      '--audio-format', 'mp3',       // Convert to MP3
      '--audio-quality', '0',        // Best quality
      '-o', outputPath,              // Output path
      '--no-playlist',               // Single video only
      '--no-warnings',
      url
    ]);

    let stderr = '';
    let stdout = '';
    
    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`yt-dlp: ${data.toString().trim()}`);
    });
    
    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0) {
        // yt-dlp adds extension automatically, find the file
        const dir = path.dirname(outputPath);
        const base = path.basename(outputPath, path.extname(outputPath));
        const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
        if (files.length > 0) {
          resolve(path.join(dir, files[0]));
        } else {
          resolve(outputPath);
        }
      } else {
        reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
      }
    });

    ytdlp.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp not installed. Run: sudo apt install yt-dlp OR pip install yt-dlp'));
      } else {
        reject(err);
      }
    });
  });
}

// Try to get YouTube transcript via API first (faster, no Whisper needed)
async function getYouTubeTranscript(videoId) {
  try {
    // Try to get transcript from YouTube's timedtext API
    const response = await axios.get(
      `https://www.youtube.com/watch?v=${videoId}`,
      { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    const html = response.data;
    
    // Extract captions data from page
    const captionMatch = html.match(/"captions":\s*({[^}]+playerCaptionsTracklistRenderer[^}]+})/);
    if (!captionMatch) {
      console.log('No captions found in page, will use Whisper');
      return null;
    }
    
    // Try to find caption track URL
    const trackMatch = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/);
    if (!trackMatch) {
      console.log('No caption track URL found, will use Whisper');
      return null;
    }
    
    const trackUrl = trackMatch[1].replace(/\\u0026/g, '&');
    console.log('Found caption track:', trackUrl);
    
    // Fetch the transcript
    const transcriptResponse = await axios.get(trackUrl);
    const transcriptXml = transcriptResponse.data;
    
    // Parse XML transcript
    const segments = [];
    const textMatches = transcriptXml.matchAll(/<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([^<]*)<\/text>/g);
    
    let fullText = '';
    for (const match of textMatches) {
      const start = parseFloat(match[1]);
      const duration = parseFloat(match[2]);
      const text = match[3]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, ' ')
        .trim();
      
      if (text) {
        segments.push({
          id: segments.length,
          start: start,
          end: start + duration,
          text: text
        });
        fullText += text + ' ';
      }
    }
    
    if (segments.length === 0) {
      console.log('No segments parsed from captions, will use Whisper');
      return null;
    }
    
    console.log(`Got ${segments.length} segments from YouTube captions`);
    
    return {
      text: fullText.trim(),
      segments: segments,
      language: 'auto',
      source: 'youtube_captions'
    };
    
  } catch (error) {
    console.log('Failed to get YouTube transcript:', error.message);
    return null;
  }
}

// Transcribe using local Whisper
async function transcribeWithWhisper(audioPath, language = 'auto', model = 'medium') {
  return new Promise((resolve, reject) => {
    const args = [
      audioPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', TEMP_DIR,
      '--word_timestamps', 'True',
      '--verbose', 'False'
    ];

    // Add language if specified
    if (language && language !== 'auto') {
      args.push('--language', language);
    }

    console.log(`Running Whisper with args:`, args.join(' '));

    const whisper = spawn('whisper', args);

    let stdout = '';
    let stderr = '';

    whisper.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`Whisper stdout: ${data.toString().trim()}`);
    });

    whisper.stderr.on('data', (data) => {
      stderr += data.toString();
      // Whisper prints progress to stderr
      const line = data.toString().trim();
      if (line && !line.includes('UserWarning')) {
        console.log(`Whisper: ${line}`);
      }
    });

    whisper.on('close', async (code) => {
      if (code === 0) {
        // Read the JSON output file
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const jsonPath = path.join(TEMP_DIR, `${baseName}.json`);
        
        try {
          if (fs.existsSync(jsonPath)) {
            const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            // Clean up JSON file
            fs.unlinkSync(jsonPath);
            resolve(result);
          } else {
            reject(new Error('Whisper output file not found'));
          }
        } catch (err) {
          reject(new Error(`Failed to parse Whisper output: ${err.message}`));
        }
      } else {
        reject(new Error(`Whisper failed with code ${code}: ${stderr}`));
      }
    });

    whisper.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Whisper not installed. Run: pip install openai-whisper'));
      } else {
        reject(err);
      }
    });
  });
}

// Transcribe using faster-whisper (faster alternative)
async function transcribeWithFasterWhisper(audioPath, language = 'auto', model = 'medium') {
  return new Promise((resolve, reject) => {
    // Use Python script for faster-whisper
    const pythonScript = `
import sys
import json
from faster_whisper import WhisperModel

model = WhisperModel("${model}", device="auto", compute_type="auto")

language = ${language === 'auto' ? 'None' : `"${language}"`}
segments, info = model.transcribe("${audioPath}", language=language, word_timestamps=True)

result = {
    "text": "",
    "segments": [],
    "language": info.language
}

for segment in segments:
    seg_data = {
        "start": segment.start,
        "end": segment.end,
        "text": segment.text.strip()
    }
    if segment.words:
        seg_data["words"] = [{"word": w.word, "start": w.start, "end": w.end} for w in segment.words]
    result["segments"].append(seg_data)
    result["text"] += segment.text

print(json.dumps(result))
`;

    const python = spawn('python3', ['-c', pythonScript]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
      const line = data.toString().trim();
      if (line && !line.includes('UserWarning') && !line.includes('FutureWarning')) {
        console.log(`faster-whisper: ${line}`);
      }
    });

    python.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse output: ${err.message}`));
        }
      } else {
        reject(new Error(`faster-whisper failed: ${stderr}`));
      }
    });

    python.on('error', reject);
  });
}

// Format transcription result to VideoFlow format
function formatTranscription(whisperResult) {
  const segments = whisperResult.segments || [];
  
  return {
    text: whisperResult.text || segments.map(s => s.text).join(' '),
    language: whisperResult.language || 'unknown',
    segments: segments.map((seg, index) => ({
      id: index,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      words: seg.words || []
    })),
    // ElevenLabs-compatible format for VideoFlow
    full_text: whisperResult.text || segments.map(s => s.text).join(' '),
    language_code: whisperResult.language || 'en'
  };
}

// Process transcription job
async function processTranscriptionJob(jobId, options) {
  const { audioUrl, audioPath: uploadedPath, youtubeUrl, language, model, engine, forceWhisper } = options;
  const workDir = path.join(TEMP_DIR, jobId);
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    jobs.set(jobId, { 
      status: 'processing', 
      progress: 0, 
      message: 'Starting transcription...',
      createdAt: new Date().toISOString()
    });

    let audioPath;
    let transcriptResult = null;
    
    // Check if it's a YouTube URL
    const videoId = youtubeUrl ? extractYouTubeVideoId(youtubeUrl) : null;
    
    if (videoId) {
      console.log(`[${jobId}] YouTube video detected: ${videoId}`);
      
      // Step 1: Try to get YouTube's own captions first (much faster)
      if (!forceWhisper) {
        jobs.set(jobId, { ...jobs.get(jobId), progress: 10, message: 'Checking YouTube captions...' });
        transcriptResult = await getYouTubeTranscript(videoId);
        
        if (transcriptResult) {
          console.log(`[${jobId}] Got transcript from YouTube captions`);
          jobs.set(jobId, { ...jobs.get(jobId), progress: 90, message: 'Got YouTube captions' });
        }
      }
      
      // Step 2: If no captions, download audio and use Whisper
      if (!transcriptResult) {
        jobs.set(jobId, { ...jobs.get(jobId), progress: 20, message: 'Downloading YouTube audio...' });
        const audioOutputPath = path.join(workDir, 'youtube_audio');
        const downloadedPath = await downloadYouTubeAudio(youtubeUrl, audioOutputPath);
        
        jobs.set(jobId, { ...jobs.get(jobId), progress: 40, message: 'Converting audio...' });
        audioPath = path.join(workDir, 'audio.wav');
        await extractAudio(downloadedPath, audioPath);
      }
      
    } else if (audioUrl) {
      // Regular audio URL
      jobs.set(jobId, { ...jobs.get(jobId), progress: 10, message: 'Downloading audio...' });
      
      const ext = path.extname(new URL(audioUrl).pathname) || '.mp3';
      const downloadPath = path.join(workDir, `input${ext}`);
      await downloadFile(audioUrl, downloadPath);
      
      // Check if it's a video file that needs audio extraction
      const videoExts = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
      if (videoExts.includes(ext.toLowerCase())) {
        jobs.set(jobId, { ...jobs.get(jobId), progress: 30, message: 'Extracting audio from video...' });
        audioPath = path.join(workDir, 'audio.wav');
        await extractAudio(downloadPath, audioPath);
      } else {
        // Convert to WAV for Whisper
        jobs.set(jobId, { ...jobs.get(jobId), progress: 30, message: 'Converting audio format...' });
        audioPath = path.join(workDir, 'audio.wav');
        await extractAudio(downloadPath, audioPath);
      }
    } else if (uploadedPath) {
      // File was uploaded directly
      jobs.set(jobId, { ...jobs.get(jobId), progress: 20, message: 'Processing uploaded file...' });
      audioPath = path.join(workDir, 'audio.wav');
      await extractAudio(uploadedPath, audioPath);
      // Clean up uploaded file
      fs.unlinkSync(uploadedPath);
    } else {
      throw new Error('No audio source provided');
    }

    // Step 3: Transcribe with Whisper if we don't have a result yet
    if (!transcriptResult && audioPath) {
      jobs.set(jobId, { ...jobs.get(jobId), progress: 50, message: 'Transcribing with Whisper...' });
      
      const whisperModel = model || 'medium';
      const whisperEngine = engine || 'whisper'; // 'whisper' or 'faster-whisper'
      
      console.log(`[${jobId}] Using ${whisperEngine} with model ${whisperModel}`);
      
      if (whisperEngine === 'faster-whisper') {
        transcriptResult = await transcribeWithFasterWhisper(audioPath, language, whisperModel);
      } else {
        transcriptResult = await transcribeWithWhisper(audioPath, language, whisperModel);
      }
      transcriptResult.source = 'whisper';
    }

    // Step 4: Format result
    jobs.set(jobId, { ...jobs.get(jobId), progress: 90, message: 'Formatting results...' });
    const formattedResult = formatTranscription(transcriptResult);

    // Step 5: Cleanup and complete
    fs.rmSync(workDir, { recursive: true, force: true });
    
    jobs.set(jobId, {
      status: 'completed',
      progress: 100,
      message: 'Transcription complete',
      result: formattedResult,
      completedAt: new Date().toISOString()
    });

    console.log(`[${jobId}] Transcription completed successfully (source: ${transcriptResult.source})`);

  } catch (error) {
    console.error(`[${jobId}] Error:`, error);
    
    // Cleanup on error
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error(`[${jobId}] Cleanup error:`, cleanupErr);
    }
    
    jobs.set(jobId, {
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });
  }
}

// ============ API ENDPOINTS ============

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    engines: ['whisper', 'faster-whisper'],
    models: ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3']
  });
});

// Start transcription from URL (async)
app.post('/transcribe', async (req, res) => {
  const jobId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const { audioUrl, youtubeUrl, language, model, engine, forceWhisper } = req.body;
  
  if (!audioUrl && !youtubeUrl) {
    return res.status(400).json({
      success: false,
      error: 'audioUrl or youtubeUrl is required'
    });
  }

  const sourceUrl = youtubeUrl || audioUrl;
  console.log(`[${jobId}] Starting transcription job for: ${sourceUrl}`);
  
  // Initialize job
  jobs.set(jobId, { 
    status: 'pending', 
    progress: 0,
    createdAt: new Date().toISOString()
  });

  // Process in background
  processTranscriptionJob(jobId, { audioUrl, youtubeUrl, language, model, engine, forceWhisper }).catch(err => {
    console.error(`[${jobId}] Background job error:`, err);
  });

  res.json({
    success: true,
    jobId,
    status: 'pending',
    message: 'Transcription job started'
  });
});

// Transcribe YouTube video (convenience endpoint)
app.post('/transcribe/youtube', async (req, res) => {
  const jobId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const { url, language, model, engine, forceWhisper } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'url is required'
    });
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return res.status(400).json({
      success: false,
      error: 'Invalid YouTube URL'
    });
  }

  console.log(`[${jobId}] Starting YouTube transcription for: ${url} (videoId: ${videoId})`);
  
  // Initialize job
  jobs.set(jobId, { 
    status: 'pending', 
    progress: 0,
    videoId,
    createdAt: new Date().toISOString()
  });

  // Process in background
  processTranscriptionJob(jobId, { youtubeUrl: url, language, model, engine, forceWhisper }).catch(err => {
    console.error(`[${jobId}] Background job error:`, err);
  });

  res.json({
    success: true,
    jobId,
    videoId,
    status: 'pending',
    message: 'YouTube transcription job started'
  });
});

// Synchronous YouTube transcription (waits for result)
app.post('/transcribe/youtube/sync', async (req, res) => {
  const jobId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const { url, language, model, engine, forceWhisper } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'url is required'
    });
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return res.status(400).json({
      success: false,
      error: 'Invalid YouTube URL'
    });
  }

  console.log(`[${jobId}] Starting synchronous YouTube transcription for: ${url}`);
  
  try {
    jobs.set(jobId, { 
      status: 'processing', 
      progress: 0,
      videoId,
      createdAt: new Date().toISOString()
    });

    await processTranscriptionJob(jobId, { youtubeUrl: url, language, model, engine, forceWhisper });
    
    const job = jobs.get(jobId);
    
    if (job.status === 'completed') {
      res.json({
        success: true,
        jobId,
        videoId,
        ...job.result
      });
    } else {
      res.status(500).json({
        success: false,
        error: job.error || 'Transcription failed'
      });
    }
    
  } catch (error) {
    console.error(`[${jobId}] Error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Upload file and transcribe (async)
app.post('/transcribe/upload', upload.single('audio'), async (req, res) => {
  const jobId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No audio file uploaded'
    });
  }

  const { language, model, engine } = req.body;
  
  console.log(`[${jobId}] Starting transcription job for uploaded file: ${req.file.originalname}`);
  
  // Initialize job
  jobs.set(jobId, { 
    status: 'pending', 
    progress: 0,
    createdAt: new Date().toISOString()
  });

  // Process in background
  processTranscriptionJob(jobId, { 
    audioPath: req.file.path, 
    language, 
    model, 
    engine 
  }).catch(err => {
    console.error(`[${jobId}] Background job error:`, err);
  });

  res.json({
    success: true,
    jobId,
    status: 'pending',
    message: 'Transcription job started'
  });
});

// Synchronous transcription (waits for result)
app.post('/transcribe/sync', async (req, res) => {
  const jobId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const { audioUrl, language, model, engine } = req.body;
  
  if (!audioUrl) {
    return res.status(400).json({
      success: false,
      error: 'audioUrl is required'
    });
  }

  console.log(`[${jobId}] Starting synchronous transcription for: ${audioUrl}`);
  
  try {
    // Initialize job
    jobs.set(jobId, { 
      status: 'processing', 
      progress: 0,
      createdAt: new Date().toISOString()
    });

    // Process and wait
    await processTranscriptionJob(jobId, { audioUrl, language, model, engine });
    
    const job = jobs.get(jobId);
    
    if (job.status === 'completed') {
      res.json({
        success: true,
        jobId,
        ...job.result
      });
    } else {
      res.status(500).json({
        success: false,
        error: job.error || 'Transcription failed'
      });
    }
    
  } catch (error) {
    console.error(`[${jobId}] Error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get job status
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  res.json({
    success: true,
    jobId,
    ...job
  });
});

// Cancel job (if possible)
app.delete('/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  if (job.status === 'completed' || job.status === 'failed') {
    return res.json({
      success: true,
      message: 'Job already finished'
    });
  }
  
  // Mark as cancelled (actual process cancellation is complex)
  jobs.set(jobId, {
    ...job,
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  });
  
  res.json({
    success: true,
    message: 'Job cancelled'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Transcription Service running on port ${PORT}`);
  console.log(`Service Version: ${SERVICE_VERSION}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
