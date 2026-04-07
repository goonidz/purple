#!/usr/bin/env node

/**
 * Simple webhook server for GitHub auto-deployment
 * Listens for GitHub push events and automatically deploys
 */

import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';

const PORT = process.env.WEBHOOK_PORT || 9000;
const DEFAULT_SECRET = 'your-secret-key-change-this';
const SECRET = process.env.WEBHOOK_SECRET || DEFAULT_SECRET;
const REPO_PATH = process.env.REPO_PATH || '/home/ubuntu/purple';

if (process.env.NODE_ENV === 'production' && (!process.env.WEBHOOK_SECRET || SECRET === DEFAULT_SECRET)) {
  console.error('[webhook-server] In production WEBHOOK_SECRET must be set and different from the default. Refusing to start.');
  process.exit(1);
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  const timestamp = new Date().toISOString();
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

function verifySignature(payload, signature) {
  if (!signature) return false;
  
  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

function deploy() {
  return new Promise((resolve, reject) => {
    log('Starting deployment...', 'blue');
    
    const commands = [
      `cd ${REPO_PATH}`,
      'git pull origin main',
      // Copy video-render-service files to the PM2 location if it exists
      '[ -d ~/video-render-service ] && cp -r video-render-service/* ~/video-render-service/ || true',
      // Restart video-render-service if it's running
      'pm2 describe video-render-service >/dev/null 2>&1 && pm2 delete video-render-service && pm2 start ~/purple/video-render-service/server.js --name video-render-service || true',
      // Configurer DuckDNS automatiquement si pas déjà fait (en arrière-plan pour ne pas bloquer)
      '[ ! -f ~/.duckdns ] && [ -f setup-duckdns.sh ] && (nohup ./setup-duckdns.sh > ~/duckdns-setup.log 2>&1 &) || true',
      './deploy.sh'
    ];
    
    const fullCommand = commands.join(' && ');
    
    exec(fullCommand, { cwd: REPO_PATH }, (error, stdout, stderr) => {
      if (error) {
        log(`Deployment failed: ${error.message}`, 'red');
        log(stderr, 'red');
        reject(error);
        return;
      }
      
      log('Deployment successful!', 'green');
      log(stdout, 'green');
      resolve(stdout);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      const signature = req.headers['x-hub-signature-256'];

      if (SECRET === DEFAULT_SECRET) {
        log('Rejected: webhook secret is still the default (set WEBHOOK_SECRET)', 'red');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook secret not configured' }));
        return;
      }
      if (!verifySignature(body, signature)) {
        log('Invalid signature', 'red');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      try {
        const payload = JSON.parse(body);
        
        // Only deploy on push to main branch
        if (payload.ref === 'refs/heads/main' && payload.commits) {
          log(`Received push event: ${payload.commits.length} commit(s)`, 'yellow');
          log(`Latest commit: ${payload.head_commit.message}`, 'yellow');
          
          // Check if any commits modified VPS or frontend files
          const affectsVPS = payload.commits.some(commit => {
            const allFiles = [
              ...(commit.added || []),
              ...(commit.modified || []),
              ...(commit.removed || [])
            ];
            return allFiles.some(file => 
              file.startsWith('video-render-service/') || 
              file.startsWith('src/') ||                    // Frontend React/TS
              file.startsWith('supabase/functions/') ||     // Edge Functions
              file === 'deploy.sh' ||
              file === 'package.json' ||
              file === 'webhook-server.js' ||
              file === 'index.html' ||
              file === 'vite.config.ts' ||
              file === 'tsconfig.json' ||
              file === 'Dockerfile'
            );
          });
          
          if (!affectsVPS) {
            log('Ignoring push - no VPS/frontend changes', 'yellow');
            log('(Only runpod-handler, docs, or other files changed)', 'yellow');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'Push ignored - no VPS/frontend changes',
              skipped: true
            }));
            return;
          }
          
          log('Changes detected in VPS/frontend files - deploying...', 'blue');
          
          deploy()
            .then(() => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'Deployment started' }));
            })
            .catch((error) => {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: error.message }));
            });
        } else {
          log('Ignoring event (not a push to main branch)', 'yellow');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Event ignored' }));
        }
      } catch (error) {
        log(`Error parsing payload: ${error.message}`, 'red');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'webhook-server' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  log(`Webhook server listening on port ${PORT}`, 'green');
  log(`Repository path: ${REPO_PATH}`, 'blue');
  log(`Secret configured: ${SECRET !== DEFAULT_SECRET ? 'Yes' : 'No (using default - webhooks will be rejected)'}`, 'yellow');
});
