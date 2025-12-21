const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Configuration
const OLD_SUPABASE_URL = 'https://hroghyzosrcjueqjftex.supabase.co';
const NEW_SUPABASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co';
const NEW_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const OLD_USER_ID = 'e622c54f-8a88-403a-bfea-1f29b71c40f9';
const NEW_USER_ID = 'b5ea24ac-499a-4cff-bd6f-a946b0f017fd';

// Buckets to migrate
const BUCKETS = ['style-references', 'generated-images', 'audio-files'];

// Download file from URL
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        downloadFile(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Get content type from filename
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

async function createBuckets(supabase) {
  console.log('\n📦 Creating buckets...');
  
  for (const bucket of BUCKETS) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
    });
    
    if (error) {
      if (error.message.includes('already exists')) {
        console.log(`   ✅ ${bucket} (already exists)`);
      } else {
        console.log(`   ❌ ${bucket}: ${error.message}`);
      }
    } else {
      console.log(`   ✅ ${bucket} created`);
    }
  }
}

async function listFilesFromOldStorage(bucket) {
  // Since old storage is public, we can try to access files
  // But we need to know the file paths - they're typically in the database
  // We'll extract URLs from the database exports
  
  const files = [];
  const csvDir = __dirname;
  
  // Search for URLs in all CSV files
  const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv'));
  
  for (const csvFile of csvFiles) {
    const content = fs.readFileSync(path.join(csvDir, csvFile), 'utf-8');
    
    // Find all URLs from old storage
    const urlPattern = new RegExp(
      `${OLD_SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/storage/v1/object/public/${bucket}/[^"\\s;,]+`,
      'g'
    );
    
    const matches = content.match(urlPattern) || [];
    for (const url of matches) {
      if (!files.includes(url)) {
        files.push(url);
      }
    }
  }
  
  // Also check the JSON file
  const jsonFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.json') || f.endsWith('.txt'));
  for (const jsonFile of jsonFiles) {
    try {
      const content = fs.readFileSync(path.join(csvDir, jsonFile), 'utf-8');
      const urlPattern = new RegExp(
        `${OLD_SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/storage/v1/object/public/${bucket}/[^"\\s;,]+`,
        'g'
      );
      const matches = content.match(urlPattern) || [];
      for (const url of matches) {
        if (!files.includes(url)) {
          files.push(url);
        }
      }
    } catch (e) {}
  }
  
  return files;
}

async function migrateFiles(supabase, bucket) {
  console.log(`\n📁 Migrating ${bucket}...`);
  
  const files = await listFilesFromOldStorage(bucket);
  console.log(`   Found ${files.length} files to migrate`);
  
  if (files.length === 0) {
    console.log(`   ⏭️  No files found`);
    return;
  }
  
  let success = 0;
  let failed = 0;
  
  for (const oldUrl of files) {
    try {
      // Extract path from URL
      const pathMatch = oldUrl.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
      if (!pathMatch) {
        console.log(`   ⚠️  Invalid URL format: ${oldUrl.substring(0, 80)}...`);
        failed++;
        continue;
      }
      
      let filePath = decodeURIComponent(pathMatch[1]);
      
      // Replace old user ID with new one in the path
      filePath = filePath.replace(OLD_USER_ID, NEW_USER_ID);
      
      // Download file
      console.log(`   ⬇️  Downloading: ${filePath.substring(0, 50)}...`);
      const fileData = await downloadFile(oldUrl);
      
      // Upload to new storage
      const contentType = getContentType(filePath);
      const { error } = await supabase.storage
        .from(bucket)
        .upload(filePath, fileData, {
          contentType,
          upsert: true,
        });
      
      if (error) {
        console.log(`   ❌ Upload failed: ${error.message}`);
        failed++;
      } else {
        console.log(`   ✅ Uploaded: ${filePath.substring(0, 50)}...`);
        success++;
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`   📊 Result: ${success} uploaded, ${failed} failed`);
}

async function main() {
  if (!NEW_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY is required!');
    process.exit(1);
  }
  
  const supabase = createClient(NEW_SUPABASE_URL, NEW_SERVICE_KEY, {
    auth: { persistSession: false }
  });
  
  console.log('🚀 Starting Storage Migration');
  console.log(`   From: ${OLD_SUPABASE_URL}`);
  console.log(`   To: ${NEW_SUPABASE_URL}`);
  
  // Create buckets
  await createBuckets(supabase);
  
  // Migrate files
  for (const bucket of BUCKETS) {
    await migrateFiles(supabase, bucket);
  }
  
  console.log('\n✅ Storage migration complete!');
}

main().catch(console.error);




