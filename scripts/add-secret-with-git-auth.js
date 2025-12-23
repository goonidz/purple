#!/usr/bin/env node

/**
 * Script to add SUPABASE_SERVICE_ROLE_KEY to GitHub using Git credentials
 * Tries to use the same token that Git uses for pushing
 */

import dotenv from 'dotenv';
import https from 'https';
import { execSync } from 'child_process';
import sodium from 'libsodium-wrappers';

dotenv.config();

const REPO_OWNER = 'goonidz';
const REPO_NAME = 'purple';
const SECRET_NAME = 'SUPABASE_SERVICE_ROLE_KEY';
const PROJECT_REF = 'laqgmqyjstisipsbljha';

// Try to get GitHub token from various sources
function getGitHubToken() {
  // 1. Try from environment
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // 2. Try to get from Git credential helper (macOS keychain)
  try {
    // On macOS, credentials are stored in keychain
    // We can try to extract from git credential fill
    const url = `https://github.com`;
    const credentialInput = `url=${url}\n\n`;
    
    try {
      const credential = execSync('git credential fill', {
        input: credentialInput,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      // Parse credential output
      const passwordMatch = credential.match(/password=([^\n]+)/);
      if (passwordMatch && passwordMatch[1] && passwordMatch[1].startsWith('ghp_')) {
        return passwordMatch[1];
      }
    } catch (e) {
      // Credential helper might not work this way
    }
  } catch (e) {
    // Ignore errors
  }

  return null;
}

// Get service role key from Supabase Management API
async function getServiceRoleKey() {
  const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!SUPABASE_ACCESS_TOKEN) {
    throw new Error('SUPABASE_ACCESS_TOKEN not found in .env');
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/api-keys`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Supabase API error: ${res.statusCode} - ${body}`));
            return;
          }
          
          const data = JSON.parse(body);
          // The API returns an array of API keys
          // Find the service_role one
          const serviceRoleKey = Array.isArray(data) 
            ? data.find(k => k.name === 'service_role' || k.tags?.includes('service_role'))
            : null;
            
          if (serviceRoleKey && serviceRoleKey.api_key) {
            resolve(serviceRoleKey.api_key);
          } else {
            // Try alternative: the key might be in a different format
            console.log('⚠️  Service role key not found in API response format');
            console.log('📝 Récupère la clé manuellement depuis:');
            console.log(`   https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api`);
            console.log('   Cherche la clé "service_role" (celle qui est secrète)');
            reject(new Error('Service role key not found in API response'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// GitHub API request
function githubRequest(method, path, data = null, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}${path}`,
      method: method,
      headers: {
        'Authorization': `token ${token}`,
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

// Encrypt secret
async function encryptSecret(publicKey, secretValue) {
  await sodium.ready;
  const keyBytes = Buffer.from(publicKey, 'base64');
  const messageBytes = Buffer.from(secretValue, 'utf8');
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
  return Buffer.from(encrypted).toString('base64');
}

async function main() {
  try {
    console.log('🔍 Récupération des credentials...');
    
    // Get GitHub token
    let githubToken = getGitHubToken();
    if (!githubToken) {
      console.error('❌ Token GitHub non trouvé');
      console.error('📝 Pour obtenir un token:');
      console.error('   1. Va sur: https://github.com/settings/tokens');
      console.error('   2. Clique sur "Generate new token (classic)"');
      console.error('   3. Sélectionne les scopes: repo, workflow');
      console.error('   4. Copie le token et ajoute-le à .env: GITHUB_TOKEN=ton_token');
      process.exit(1);
    }
    console.log('✅ Token GitHub trouvé');

    // Get service role key
    console.log('📥 Récupération de la clé service role depuis Supabase...');
    const serviceRoleKey = await getServiceRoleKey();
    console.log('✅ Clé service role récupérée');

    // Get public key
    console.log('📥 Récupération de la clé publique du repository...');
    const publicKeyData = await githubRequest('GET', '/actions/secrets/public-key', null, githubToken);
    console.log('✅ Clé publique récupérée');

    // Encrypt secret
    console.log('🔐 Chiffrement du secret...');
    const encryptedValue = await encryptSecret(publicKeyData.key, serviceRoleKey);
    console.log('✅ Secret chiffré');

    // Add secret
    console.log(`📤 Ajout du secret ${SECRET_NAME} à GitHub...`);
    await githubRequest('PUT', `/actions/secrets/${SECRET_NAME}`, {
      encrypted_value: encryptedValue,
      key_id: publicKeyData.key_id,
    }, githubToken);

    console.log(`✅ Secret ${SECRET_NAME} ajouté avec succès à GitHub!`);
    console.log('🎉 Le workflow GitHub Actions pourra maintenant utiliser ce secret.');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    
    if (error.message.includes('401') || error.message.includes('403')) {
      console.error('\n💡 Le token GitHub n\'a pas les bonnes permissions.');
      console.error('   Assure-toi qu\'il a les scopes: repo, workflow');
    }
    
    console.error('\n💡 Alternative: Ajoute le secret manuellement via GitHub:');
    console.error(`   1. Va sur: https://github.com/${REPO_OWNER}/${REPO_NAME}/settings/secrets/actions`);
    console.error(`   2. Clique sur "New repository secret"`);
    console.error(`   3. Nom: ${SECRET_NAME}`);
    console.error(`   4. Valeur: [récupère depuis Supabase dashboard]`);
    process.exit(1);
  }
}

main();
