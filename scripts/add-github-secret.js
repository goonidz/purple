#!/usr/bin/env node

/**
 * Script to add SUPABASE_SERVICE_ROLE_KEY to GitHub repository secrets
 * 
 * Usage:
 *   GITHUB_TOKEN=your_token SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/add-github-secret.js
 * 
 * Or set environment variables in .env and run:
 *   node scripts/add-github-secret.js
 */

const https = require('https');
const crypto = require('crypto');

// Configuration
const REPO_OWNER = 'goonidz';
const REPO_NAME = 'purple';
const SECRET_NAME = 'SUPABASE_SERVICE_ROLE_KEY';

// Try to load .env file
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available, continue without it
}

// Get credentials from environment
let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
let SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Try to get from Supabase secrets if not in env
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.log('⚠️  SUPABASE_SERVICE_ROLE_KEY not found in environment');
  console.log('📝 Please provide it:');
  console.log('   1. Get it from: https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api');
  console.log('   2. Look for "service_role" key (secret)');
  console.log('   3. Set it as: export SUPABASE_SERVICE_ROLE_KEY="your_key"');
  console.log('   Or add it to .env file');
}

if (!GITHUB_TOKEN) {
  console.error('\n❌ GITHUB_TOKEN environment variable is required');
  console.error('📝 To get a token:');
  console.error('   1. Go to: https://github.com/settings/tokens');
  console.error('   2. Click "Generate new token (classic)"');
  console.error('   3. Select scopes: repo, workflow');
  console.error('   4. Copy the token and set: export GITHUB_TOKEN="your_token"');
  console.error('\n💡 Or run: GITHUB_TOKEN=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/add-github-secret.js');
}

if (!GITHUB_TOKEN || !SUPABASE_SERVICE_ROLE_KEY) {
  process.exit(1);
}

// Helper function to make GitHub API requests
function githubRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}${path}`,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Node.js',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Encrypt secret using libsodium (using Node.js crypto as fallback)
// Note: GitHub uses libsodium sealed boxes, but we'll use a simplified approach
// For production, use the libsodium-wrappers npm package
async function encryptSecret(publicKey, secretValue) {
  // GitHub uses libsodium sealed boxes
  // This is a simplified version - for production, use libsodium-wrappers
  try {
    // Try to use libsodium-wrappers if available
    const sodium = require('libsodium-wrappers');
    await sodium.ready;
    
    const keyBytes = Buffer.from(publicKey, 'base64');
    const messageBytes = Buffer.from(secretValue, 'utf8');
    
    const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
    return Buffer.from(encrypted).toString('base64');
  } catch (e) {
    console.error('Error: libsodium-wrappers is required for encryption');
    console.error('Install it with: npm install libsodium-wrappers');
    console.error('Or add the secret manually via GitHub web interface');
    throw e;
  }
}

async function main() {
  try {
    console.log('Fetching repository public key...');
    
    // Get public key
    const publicKeyData = await githubRequest('GET', '/actions/secrets/public-key');
    console.log('Public key retrieved');

    console.log('Encrypting secret...');
    const encryptedValue = await encryptSecret(publicKeyData.key, SUPABASE_SERVICE_ROLE_KEY);
    console.log('Secret encrypted');

    console.log(`Adding secret ${SECRET_NAME} to repository...`);
    await githubRequest('PUT', `/actions/secrets/${SECRET_NAME}`, {
      encrypted_value: encryptedValue,
      key_id: publicKeyData.key_id,
    });

    console.log(`✅ Successfully added secret ${SECRET_NAME} to GitHub repository!`);
    console.log('The GitHub Actions workflow will now be able to use this secret.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nAlternative: Add the secret manually via GitHub:');
    console.error(`1. Go to https://github.com/${REPO_OWNER}/${REPO_NAME}/settings/secrets/actions`);
    console.error(`2. Click "New repository secret"`);
    console.error(`3. Name: ${SECRET_NAME}`);
    console.error(`4. Value: ${SUPABASE_SERVICE_ROLE_KEY}`);
    process.exit(1);
  }
}

main();
