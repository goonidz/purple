#!/usr/bin/env node

/**
 * Script de diagnostic pour voir les images dans le storage Supabase
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  if (!fs.existsSync(fullPath)) return {};
  const content = fs.readFileSync(fullPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  });
  return env;
}

const env = loadEnvFile('.env.production');
Object.assign(process.env, env);

const SUPABASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function listStorageFiles(folderPath = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/storage/v1/object/list/generated-images`);
    
    const postData = JSON.stringify({
      prefix: folderPath,
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' }
    });

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('📊 Diagnostic du storage Supabase...\n');

  try {
    // Liste les dossiers/fichiers à la racine
    const rootItems = await listStorageFiles('');
    
    console.log(`📁 Éléments à la racine du bucket 'generated-images': ${rootItems.length}`);
    
    if (rootItems.length === 0) {
      console.log('   ⚠️  Le bucket est vide !');
      return;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    let totalFiles = 0;
    let thumbnails = 0;
    let oldFiles = 0;
    let recentFiles = 0;

    for (const item of rootItems) { // Parcourir tous les dossiers
      console.log(`\n📂 Dossier: ${item.name || item.id}`);
      
      if (item.id) {
        // C'est un dossier, lister son contenu
        const files = await listStorageFiles(item.name || item.id);
        
        for (const file of files) { // Parcourir tous les fichiers
          totalFiles++;
          const isThumb = file.name?.includes('thumb_v');
          const createdAt = file.created_at ? new Date(file.created_at) : null;
          const isOld = createdAt && createdAt < sevenDaysAgo;
          
          if (isThumb) thumbnails++;
          else if (isOld) oldFiles++;
          else recentFiles++;

          const age = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)) : '?';
          const status = isThumb ? '🖼️ thumb' : (isOld ? '🗑️ old' : '✅ recent');
          
          console.log(`   ${status} ${file.name} (${age} jours)`);
        }
      }
    }

    console.log('\n📈 Résumé:');
    console.log(`   - Total fichiers analysés: ${totalFiles}`);
    console.log(`   - Miniatures (protégées): ${thumbnails}`);
    console.log(`   - Fichiers > 7 jours (à supprimer): ${oldFiles}`);
    console.log(`   - Fichiers récents (< 7 jours): ${recentFiles}`);
    console.log(`\n📅 Seuil de suppression: ${sevenDaysAgo.toISOString()}`);

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
}

main();
