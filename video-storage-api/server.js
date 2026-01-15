const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
const PORT = process.env.VIDEO_STORAGE_PORT || 3001;

// Storage directory for uploaded videos
const VIDEOS_DIR = process.env.VIDEOS_DIR || '/var/www/rendered-videos';
const PUBLIC_URL_BASE = process.env.PUBLIC_URL_BASE || 'http://51.91.158.233/rendered-videos';

// API authentication token
const API_TOKEN = process.env.VIDEO_UPLOAD_TOKEN || crypto.randomBytes(32).toString('hex');

// Create videos directory if it doesn't exist
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  console.log(`[Storage API] Created videos directory: ${VIDEOS_DIR}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, VIDEOS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random.mp4
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${timestamp}-${random}${ext}`);
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

// Middleware to check API token
const authenticate = (req, res, next) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

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
  const filePath = path.join(VIDEOS_DIR, filename);

  // Security: prevent path traversal
  if (!filePath.startsWith(VIDEOS_DIR)) {
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
  const filePath = path.join(VIDEOS_DIR, filename);

  // Security: prevent path traversal
  if (!filePath.startsWith(VIDEOS_DIR)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlinkSync(filePath);
  console.log(`[Storage API] Deleted: ${filename}`);

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
  console.log(`[Storage API] Public URL base: ${PUBLIC_URL_BASE}`);
  console.log(`[Storage API] API Token: ${API_TOKEN}`);
  console.log(`[Storage API] Use this token in RunPod handler for authentication`);
});
