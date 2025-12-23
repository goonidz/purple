#!/usr/bin/env node

/**
 * Script pour nettoyer automatiquement les images Supabase de plus de 7 jours
 * À exécuter sur le serveur VPS via cron
 * 
 * Usage:
 *   node scripts/cleanup-supabase-images.js
 * 
 * Ou via cron:
 *   0 2 * * * cd /home/ubuntu/purple && node scripts/cleanup-supabase-images.js >> /home/ubuntu/purple/cleanup-images.log 2>&1
 */

import https from 'https';
import fs from 'fs';

// Charger les variables d'environnement depuis .env.production
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        env[key] = value;
      }
    }
  });
  
  return env;
}

// Charger .env.production
const env = loadEnvFile('.env.production');
Object.assign(process.env, env);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://laqgmqyjstisipsbljha.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Erreur: SUPABASE_SERVICE_ROLE_KEY non trouvée dans .env.production');
  console.error('📝 Ajoute-la dans .env.production sur le serveur');
  console.error('   Récupère-la depuis: https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api');
  process.exit(1);
}

const CLEANUP_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/cleanup-old-images`;

function callCleanupFunction() {
  return new Promise((resolve, reject) => {
    const url = new URL(CLEANUP_FUNCTION_URL);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(data)}`));
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

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🧹 Démarrage du nettoyage des images Supabase...`);

  try {
    const result = await callCleanupFunction();
    
    console.log(`[${timestamp}] ✅ Nettoyage terminé:`);
    console.log(`   - Images supprimées: ${result.deleted || 0}`);
    console.log(`   - Erreurs: ${result.errors || 0}`);
    console.log(`   - Total traité: ${result.total || 0}`);
    
    if (result.message) {
      console.log(`   - Message: ${result.message}`);
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Erreur lors du nettoyage:`, error.message);
    process.exit(1);
  }
}

main();
