const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
const PORT = process.env.VIDEO_STORAGE_PORT || 3001;

// Storage directory for uploaded videos
const VIDEOS_DIR = process.env.VIDEOS_DIR || '/var/www/rendered-videos';
const PUBLIC_URL_BASE = process.env.PUBLIC_URL_BASE || 'http://51.91.158.233/rendered-videos';

// Gameplay storage
const GAMEPLAY_DIR = process.env.GAMEPLAY_DIR || '/var/www/gameplay';
const GAMEPLAY_URL_BASE = process.env.GAMEPLAY_URL_BASE || 'https://purpleai.duckdns.org/gameplay';

// API authentication token
const API_TOKEN = process.env.VIDEO_UPLOAD_TOKEN || crypto.randomBytes(32).toString('hex');

// Supabase client for JWT verification
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
let supabaseAuth = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('[Storage API] Supabase JWT auth enabled');
} else {
  console.warn('[Storage API] SUPABASE_URL or SUPABASE_ANON_KEY not set — JWT auth disabled');
}

// Create directories if they don't exist
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log(`[Storage API] Created videos directory: ${VIDEOS_DIR}`);
}
if (!fs.existsSync(GAMEPLAY_DIR)) {
  fs.mkdirSync(GAMEPLAY_DIR, { recursive: true });
  console.log(`[Storage API] Created gameplay directory: ${GAMEPLAY_DIR}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, VIDEOS_DIR);
  },
  filename: (req, file, cb) => {
    // Use the original filename sent by the handler (format: YYYYMMDD_project_name.mp4)
    // If not provided, fallback to timestamp-random.mp4
    if (file.originalname && file.originalname !== 'video.mp4') {
      cb(null, file.originalname);
    } else {
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.originalname) || '.mp4';
      cb(null, `${timestamp}-${random}${ext}`);
    }
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: Infinity, // Pas de limite de taille !
  },
  fileFilter: (req, file, cb) => {
    // Accept video files only
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Ensure resolved path stays inside a base directory (prevents path traversal)
function resolveSafePath(filename, baseDir = VIDEOS_DIR) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, filename);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return null;
  }
  return resolved;
}

// Sanitize filename: keep alphanumeric, dashes, underscores, dots
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
}

// Middleware to check API token (for RunPod / internal calls)
const authenticate = (req, res, next) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Middleware to authenticate via Supabase JWT (for frontend calls)
const authenticateJWT = async (req, res, next) => {
  if (!supabaseAuth) {
    return res.status(503).json({ error: 'JWT auth not configured on server' });
  }

  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No authorization token' });
  }

  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.userId = user.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth failed' });
  }
};

// Gameplay multer config — destination is dynamic per user (set via req.userId)
const gameplayStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(GAMEPLAY_DIR, req.userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const baseName = path.basename(file.originalname, ext);
    const safe = sanitizeFilename(baseName);
    const finalName = safe ? `${safe}${ext}` : `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, finalName);
  }
});

const gameplayUpload = multer({
  storage: gameplayStorage,
  limits: { fileSize: Infinity },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP4, WebM, and MOV are allowed.'));
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = fs.statfsSync(VIDEOS_DIR);
  const freeSpaceGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
  
  res.json({
    status: 'ok',
    videosDir: VIDEOS_DIR,
    freeSpaceGB: freeSpaceGB.toFixed(2),
    publicUrlBase: PUBLIC_URL_BASE
  });
});

// Upload video endpoint
app.post('/api/upload-video', authenticate, upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const filename = req.file.filename;
  const publicUrl = `${PUBLIC_URL_BASE}/${filename}`;
  const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

  console.log(`[Storage API] Uploaded: ${filename} (${fileSizeMB} MB)`);

  res.json({
    success: true,
    url: publicUrl,
    filename: filename,
    size: req.file.size,
    sizeMB: parseFloat(fileSizeMB)
  });
});

// Download video with custom filename (no auth required for downloads)
app.get('/api/download-video/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = resolveSafePath(filename);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Get custom filename from query param or use original
  const downloadName = req.query.name || filename;

  // Set headers to force download
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

  // Stream the file
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});

// Delete video endpoint (optional, for cleanup)
app.delete('/api/delete-video/:filename', authenticate, (req, res) => {
  const filename = req.params.filename;
  const filePath = resolveSafePath(filename);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  console.log(`[Storage API] Deleted: ${filename}`);

  res.json({ success: true });
});

// ============================================================================
// GAMEPLAY ENDPOINTS
// ============================================================================

// Upload gameplay video (JWT auth — sets req.userId)
app.post('/api/upload-gameplay', authenticateJWT, gameplayUpload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const filename = req.file.filename;
  const publicUrl = `${GAMEPLAY_URL_BASE}/${req.userId}/${filename}`;
  const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

  console.log(`[Gameplay] Uploaded: ${req.userId}/${filename} (${fileSizeMB} MB)`);

  res.json({
    success: true,
    url: publicUrl,
    filename,
    size: req.file.size,
    sizeMB: parseFloat(fileSizeMB),
  });
});

// List user's gameplay videos
app.get('/api/list-gameplay', authenticateJWT, (req, res) => {
  const userDir = path.join(GAMEPLAY_DIR, req.userId);

  if (!fs.existsSync(userDir)) {
    return res.json({ files: [] });
  }

  try {
    const entries = fs.readdirSync(userDir);
    const files = entries
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.mp4', '.webm', '.mov'].includes(ext);
      })
      .map(f => {
        const filePath = path.join(userDir, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          url: `${GAMEPLAY_URL_BASE}/${req.userId}/${f}`,
          size: stat.size,
          sizeMB: parseFloat((stat.size / (1024 * 1024)).toFixed(2)),
          uploadedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ files });
  } catch (err) {
    console.error('[Gameplay] List error:', err.message);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Delete a gameplay video
app.delete('/api/delete-gameplay/:filename', authenticateJWT, (req, res) => {
  const userDir = path.join(GAMEPLAY_DIR, req.userId);
  const filePath = resolveSafePath(req.params.filename, userDir);

  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  console.log(`[Gameplay] Deleted: ${req.userId}/${req.params.filename}`);
  res.json({ success: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Storage API] Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Storage API] Server running on port ${PORT}`);
  console.log(`[Storage API] Videos directory: ${VIDEOS_DIR}`);
  console.log(`[Storage API] Gameplay directory: ${GAMEPLAY_DIR}`);
  console.log(`[Storage API] Public URL base: ${PUBLIC_URL_BASE}`);
  console.log(`[Storage API] Gameplay URL base: ${GAMEPLAY_URL_BASE}`);
  console.log(`[Storage API] API Token: ${process.env.VIDEO_UPLOAD_TOKEN ? '[SET]' : '[GENERATED - set VIDEO_UPLOAD_TOKEN for production]'}`);
});
