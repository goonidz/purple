#!/usr/bin/env node

/**
 * Simple webhook server for GitHub auto-deployment
 * Listens for GitHub push events and automatically deploys
 */

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');

const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'your-secret-key-change-this';
const REPO_PATH = process.env.REPO_PATH || '/home/ubuntu/purple';

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
      
      // Verify signature if secret is set
      if (SECRET !== 'your-secret-key-change-this') {
        if (!verifySignature(body, signature)) {
          log('Invalid signature', 'red');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }
      }
      
      try {
        const payload = JSON.parse(body);
        
        // Only deploy on push to main branch
        if (payload.ref === 'refs/heads/main' && payload.commits) {
          log(`Received push event: ${payload.commits.length} commit(s)`, 'yellow');
          log(`Latest commit: ${payload.head_commit.message}`, 'yellow');
          
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
  log(`Secret configured: ${SECRET !== 'your-secret-key-change-this' ? 'Yes' : 'No (using default)'}`, 'yellow');
});
