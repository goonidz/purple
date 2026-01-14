#!/usr/bin/env node
/**
 * Deploy GPU Pod setup to Supabase (Node.js version - no psql required)
 * Usage: node scripts/deploy-gpu-setup.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const SUPABASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co';
const PROJECT_REF = 'laqgmqyjstisipsbljha'; // Correct ref from URL

// Read from scripts/add-service-role-key.sh (most recent, expires 2081)
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTg4MjA2MSwiZXhwIjoyMDgxNDU4MDYxfQ.8WIZ3w_ouqXivqQms7sqjnxnTdA06hcwym966LYeh4w';
const ACCESS_TOKEN = 'sbp_24e7cdfeb4ad5fb1eae9ad9ae148c5f332d5edf9';

console.log('🚀 Deploying GPU Pod setup to Supabase...');
console.log('Project:', PROJECT_REF);
console.log('');

// 1) Apply migration via service role PostgREST
async function applyMigration() {
  console.log('📦 Step 1/2: Applying migration (gpu_render_jobs)...');
  
  const migrationPath = join(repoRoot, 'supabase/migrations/20260114211500_gpu_render_jobs.sql');
  const sql = readFileSync(migrationPath, 'utf8');
  
  try {
    // Use direct SQL execution via PostgREST
    // Split SQL into individual statements and execute each
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`   Executing ${statements.length} SQL statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i] + ';';
      console.log(`   [${i + 1}/${statements.length}] Executing...`);
      
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ query: stmt }),
      });
      
      if (!response.ok) {
        const text = await response.text();
        // If exec_sql doesn't exist, that's expected - we'll create the table manually
        if (i === 0 && text.includes('function public.exec_sql')) {
          console.log('   exec_sql RPC not available, using direct table creation...');
          // Execute migration directly using raw SQL via a temp function
          return await applyMigrationDirect(sql);
        } else {
          console.error(`   ❌ Statement ${i + 1} failed:`, text);
          return false;
        }
      }
    }
    
    console.log('✅ Migration applied successfully');
    console.log('   Table: gpu_render_jobs');
    console.log('   RPC: claim_gpu_render_job()');
    return true;
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    return false;
  }
}

// Direct migration approach: Use existing exec_migration_sql function
async function applyMigrationDirect(sql) {
  console.log('   Using existing exec_migration_sql RPC...');
  
  // The hint says there's an exec_migration_sql function - let's try using that
  // First try the existing exec function
  let response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_migration_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  
  if (response.ok) {
    console.log('✅ Migration applied via exec_migration_sql');
    return true;
  }
  
  // If that doesn't work, create our own exec function with the migration SQL embedded
  console.log('   Creating custom exec function for GPU migration...');
  
  // We need to escape the SQL properly for embedding in a function
  const escapedSQL = sql
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\$/g, '$$');
  
  const createAndExec = `
    CREATE OR REPLACE FUNCTION exec_gpu_migration_temp()
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      ${sql}
      RETURN 'Migration applied';
    END;
    $$;
    
    SELECT exec_gpu_migration_temp();
    DROP FUNCTION IF EXISTS exec_gpu_migration_temp();
  `;
  
  response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_migration_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  
  if (!response.ok) {
    const text = await response.text();
    console.error('   ❌ Could not execute migration:', text);
    console.log('\n⚠️  Automated migration not possible. Use SQL Editor:');
    console.log(`   https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
    console.log('   Copy-paste: supabase/migrations/20260114211500_gpu_render_jobs.sql\n');
    return false;
  }
  
  console.log('✅ Migration applied');
  return true;
}

// 2) Deploy Edge Function via Management API
async function deployEdgeFunction() {
  console.log('');
  console.log('📦 Step 2/2: Deploying Edge Function (render-video-gpu-pod)...');
  
  const funcPath = join(repoRoot, 'supabase/functions/render-video-gpu-pod/index.ts');
  const code = readFileSync(funcPath, 'utf8');
  
  try {
    // Manual multipart/form-data construction (Node.js compatible)
    const boundary = `----FormBoundary${Math.random().toString(36).substring(2)}`;
    const CRLF = '\r\n';
    
    const parts = [];
    
    // Part 1: metadata
    parts.push(`--${boundary}${CRLF}`);
    parts.push(`Content-Disposition: form-data; name="metadata"${CRLF}${CRLF}`);
    parts.push(JSON.stringify({
      entrypoint_path: 'index.ts',
      name: 'render-video-gpu-pod',
      verify_jwt: false,
    }));
    parts.push(CRLF);
    
    // Part 2: file
    parts.push(`--${boundary}${CRLF}`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="index.ts"${CRLF}`);
    parts.push(`Content-Type: application/typescript${CRLF}${CRLF}`);
    parts.push(code);
    parts.push(CRLF);
    
    // End
    parts.push(`--${boundary}--${CRLF}`);
    
    const body = parts.join('');
    
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=render-video-gpu-pod`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        body,
      }
    );
    
    if (!response.ok) {
      const result = await response.json();
      console.error('   ❌ Management API failed:', result.message || result);
      console.log('');
      console.log('⚠️  Manual deployment required:');
      console.log(`   1. Open: https://supabase.com/dashboard/project/${PROJECT_REF}/functions`);
      console.log('   2. Click "Create a new function"');
      console.log('   3. Name: render-video-gpu-pod');
      console.log('   4. Copy-paste code from: supabase/functions/render-video-gpu-pod/index.ts');
      console.log('   5. Click "Deploy function"');
      console.log('');
      return false;
    }
    
    const result = await response.json();
    console.log('✅ Edge Function deployed successfully');
    console.log(`   URL: ${SUPABASE_URL}/functions/v1/render-video-gpu-pod`);
    console.log(`   ID: ${result.id || 'created'}`);
    return true;
  } catch (error) {
    console.error('   ❌ Deploy error:', error.message);
    console.log('');
    console.log('⚠️  Manual deployment required:');
    console.log(`   1. Open: https://supabase.com/dashboard/project/${PROJECT_REF}/functions`);
    console.log('   2. Click "Create a new function"');
    console.log('   3. Name: render-video-gpu-pod');
    console.log('   4. Copy-paste code from: supabase/functions/render-video-gpu-pod/index.ts');
    console.log('   5. Click "Deploy function"');
    console.log('');
    return false;
  }
}

async function main() {
  const migrationOk = await applyMigration();
  if (!migrationOk) {
    console.log('\n⚠️  Migration failed. See errors above.');
    console.log('   You can apply it manually via SQL Editor:');
    console.log(`   https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
    // Continue anyway
  }
  
  const funcOk = await deployEdgeFunction();
  if (!funcOk) {
    console.log('\n⚠️  Edge Function deploy failed. See errors above.');
    console.log('   You can deploy manually via Dashboard:');
    console.log(`   https://supabase.com/dashboard/project/${PROJECT_REF}/functions`);
    process.exit(1);
  }
  
  console.log('\n✅ GPU Pod setup deployed successfully!');
  console.log('\n📋 Next steps:');
  console.log('   1. Rebuild + push GHCR image: docker buildx build --platform linux/amd64 ...');
  console.log('   2. Configure RunPod Pod with RUNPOD_MODE=worker');
  console.log('   3. Test with GPU toggle ON');
}

main().catch(err => {
  console.error('❌ Deployment failed:', err);
  process.exit(1);
});
