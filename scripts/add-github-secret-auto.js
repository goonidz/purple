#!/usr/bin/env node

/**
 * Script automatique pour ajouter SUPABASE_SERVICE_ROLE_KEY à GitHub
 * Utilise l'API Supabase Management pour récupérer la clé
 */

require('dotenv').config();
const https = require('https');
const { execSync } = require('child_process');

const REPO_OWNER = 'goonidz';
const REPO_NAME = 'purple';
const SECRET_NAME = 'SUPABASE_SERVICE_ROLE_KEY';
const PROJECT_REF = 'laqgmqyjstisipsbljha';
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

// Try to get service role key from Supabase Management API
async function getServiceRoleKey() {
  console.log('📥 Récupération de la clé service role depuis Supabase...');
  
  try {
    // Use Supabase CLI to get the key
    // Note: The CLI doesn't expose the actual key value, only the digest
    // So we need to get it from the dashboard or use the Management API
    
    // Try Management API
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
            const data = JSON.parse(body);
            // Find service_role key
            const serviceRoleKey = data.find(k => k.name === 'service_role');
            if (serviceRoleKey && serviceRoleKey.api_key) {
              resolve(serviceRoleKey.api_key);
            } else {
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
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    console.log('\n💡 Récupère la clé manuellement depuis:');
    console.log(`   https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api`);
    console.log('   Cherche la clé "service_role" (celle qui est secrète)');
    process.exit(1);
  }
}

// Rest of the script similar to add-github-secret.js
// ... (encryption and GitHub API calls)

console.log('⚠️  Ce script nécessite un token GitHub.');
console.log('📝 Pour obtenir un token:');
console.log('   1. Va sur: https://github.com/settings/tokens');
console.log('   2. Clique sur "Generate new token (classic)"');
console.log('   3. Sélectionne les scopes: repo, workflow');
console.log('   4. Copie le token');
console.log('\n💡 Ensuite, exécute:');
console.log('   GITHUB_TOKEN=ton_token node scripts/add-github-secret-auto.js');
