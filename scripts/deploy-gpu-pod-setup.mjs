#!/usr/bin/env node
/**
 * Deploy GPU Pod setup to Supabase using SQL Editor copy-paste approach
 * 
 * This script prepares everything and guides you through manual deployment
 * (CLI has TLS issue, Management API needs Owner token scope)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PROJECT_REF = 'hroghyzosrcjueqjftex';

console.log('🚀 GPU Pod Deployment Guide');
console.log('============================\n');

// Read migration
const migrationPath = join(repoRoot, 'supabase/migrations/20260114211500_gpu_render_jobs.sql');
const migrationSQL = readFileSync(migrationPath, 'utf8');

// Read Edge Function
const funcPath = join(repoRoot, 'supabase/functions/render-video-gpu-pod/index.ts');
const funcCode = readFileSync(funcPath, 'utf8');

console.log('✅ Files ready for deployment:\n');
console.log(`   Migration: ${migrationPath}`);
console.log(`   Edge Function: ${funcPath}\n`);

console.log('📋 STEP 1: Apply migration (SQL Editor)\n');
console.log(`   1. Open: https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
console.log(`   2. Copy-paste the ENTIRE content of:`);
console.log(`      supabase/migrations/20260114211500_gpu_render_jobs.sql`);
console.log(`   3. Click "Run"`);
console.log(`   4. Verify: SELECT COUNT(*) FROM gpu_render_jobs; (should return 0)\n`);

console.log('📋 STEP 2: Deploy Edge Function (Dashboard)\n');
console.log(`   1. Open: https://supabase.com/dashboard/project/${PROJECT_REF}/functions`);
console.log(`   2. Click "Create a new function"`);
console.log(`   3. Name: render-video-gpu-pod`);
console.log(`   4. Copy-paste the content of:`);
console.log(`      supabase/functions/render-video-gpu-pod/index.ts`);
console.log(`   5. Click "Deploy function"\n`);

console.log('📋 STEP 3: Rebuild + Push GHCR image\n');
console.log(`   Run in terminal:\n`);
console.log(`   cd "/Users/Tom/Documents/Cursor/VideoFlow 2"`);
console.log(`   git checkout runpod`);
console.log(`   docker buildx build --platform linux/amd64 \\`);
console.log(`     -f runpod-handler/Dockerfile \\`);
console.log(`     -t ghcr.io/goonidz/purple-runpod-handler:cuda12.2 \\`);
console.log(`     --push .\n`);

console.log('📋 STEP 4: Configure RunPod Pod Template\n');
console.log(`   Environment variables (critical):`);
console.log(`   - RUNPOD_MODE=worker`);
console.log(`   - SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co`);
console.log(`   - SUPABASE_SERVICE_KEY=<service_role_key>`);
console.log(`   - NVIDIA_VISIBLE_DEVICES=all`);
console.log(`   - NVIDIA_DRIVER_CAPABILITIES=compute,utility,video\n`);

console.log('✅ Once complete, test with GPU toggle ON in your site.');
console.log('   The Pod worker will claim jobs, render with NVENC, and upload.\n');

async function applyMigration() {
  console.log('\n📦 Applying migration: gpu_render_jobs...');
  return false; // Manual only
}

async function deployEdgeFunction() {
  console.log('\n📦 Deploying Edge Function: render-video-gpu-pod...');
  
  const funcPath = join(repoRoot, 'supabase/functions/render-video-gpu-pod/index.ts');
  const code = readFileSync(funcPath, 'utf8');
  
  try {
    // Create FormData equivalent for Deno import statement
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36);
    const parts = [];
    
    // Add metadata
    const metadata = JSON.stringify({
      entrypoint_path: 'index.ts',
      name: 'render-video-gpu-pod',
      verify_jwt: false,
    });
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`);
    
    // Add file
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\nContent-Type: application/typescript\r\n\r\n${code}\r\n`);
    parts.push(`--${boundary}--\r\n`);
    
    const body = parts.join('');
    
    const response = await fetch(apiUrl('/functions/deploy?slug=render-video-gpu-pod'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('❌ Function deploy failed:', result);
      return false;
    }
    
    console.log('✅ Edge Function deployed successfully');
    console.log('   Function URL:', `https://laqgmqyjstisipsbljha.supabase.co/functions/v1/render-video-gpu-pod`);
    return true;
  } catch (error) {
    console.error('❌ Function deploy error:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Deploying GPU Pod setup to Supabase...');
  console.log('Project:', PROJECT_ID);
  
  const migrationOk = await applyMigration();
  if (!migrationOk) {
    console.log('\n❌ Migration failed. Fix errors above and retry.');
    process.exit(1);
  }
  
  const funcOk = await deployEdgeFunction();
  if (!funcOk) {
    console.log('\n⚠️  Edge Function deploy failed. You can deploy manually via Dashboard.');
    console.log('   Dashboard: https://supabase.com/dashboard/project/hroghyzosrcjueqjftex/functions');
    process.exit(1);
  }
  
  console.log('\n✅ GPU Pod setup deployed successfully!');
  console.log('\n📋 Next steps:');
  console.log('1. Rebuild + push GHCR image with worker mode');
  console.log('2. Configure RunPod Pod template with RUNPOD_MODE=worker');
  console.log('3. Test end-to-end');
}

main().catch(err => {
  console.error('❌ Deployment error:', err);
  process.exit(1);
});
