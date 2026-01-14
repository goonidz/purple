#!/usr/bin/env node
/**
 * Force apply GPU migration by copying SQL to clipboard + instructions
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const SUPABASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcWdtcXlqc3Rpc2lwc2JsamhhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTg4MjA2MSwiZXhwIjoyMDgxNDU4MDYxfQ.8WIZ3w_ouqXivqQms7sqjnxnTdA06hcwym966LYeh4w';
const PROJECT_REF = 'laqgmqyjstisipsbljha';

console.log('🚀 GPU Migration Helper\n');

const migrationPath = join(repoRoot, 'supabase/migrations/20260114211500_gpu_render_jobs.sql');
const sql = readFileSync(migrationPath, 'utf8');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Copy SQL to clipboard
async function copyToClipboard() {
  try {
    await execAsync(`echo "${sql.replace(/"/g, '\\"')}" | pbcopy`);
    console.log('✅ Migration SQL copied to clipboard!\n');
    return true;
  } catch (error) {
    console.log('⚠️  Could not copy to clipboard (pbcopy not available)\n');
    return false;
  }
}

// Verify the migration
async function verifyMigration() {
  console.log('🔍 Verifying migration...\n');
  
  // Check if table exists
  const { data: tables, error: tableError } = await supabase
    .from('gpu_render_jobs')
    .select('id')
    .limit(1);
  
  if (tableError) {
    console.log('❌ Table gpu_render_jobs does not exist:', tableError.message);
    return false;
  }
  
  console.log('✅ Table gpu_render_jobs exists');
  
  // Check if function exists by trying to call it
  const { data, error } = await supabase.rpc('claim_gpu_render_job', { 
    p_worker_id: 'test-verification' 
  });
  
  if (error && error.message.includes('Could not find')) {
    console.log('❌ Function claim_gpu_render_job does not exist');
    return false;
  }
  
  console.log('✅ Function claim_gpu_render_job exists');
  console.log('\n✅ Migration verified successfully!\n');
  
  return true;
}

async function main() {
  // Step 1: Copy to clipboard
  const copied = await copyToClipboard();
  
  // Step 2: Open browser
  console.log('📋 MANUAL STEPS (takes 30 seconds):');
  console.log('');
  console.log('   1. Opening SQL Editor in browser...');
  console.log(`      URL: https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
  console.log('');
  
  if (copied) {
    console.log('   2. The migration SQL is in your clipboard - just paste (Cmd+V)');
  } else {
    console.log('   2. Copy this file content and paste in SQL Editor:');
    console.log(`      ${migrationPath}`);
  }
  
  console.log('');
  console.log('   3. Click "RUN" button (or Ctrl+Enter)');
  console.log('');
  console.log('   4. Come back here and press Enter to verify...');
  console.log('');
  
  // Open browser
  try {
    await execAsync(`open "https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new"`);
  } catch (error) {
    console.log('   (Could not auto-open browser - open URL manually)');
  }
  
  // Wait for user confirmation
  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });
  
  console.log('\n🔍 Verifying migration...\n');
  
  // Wait a bit for schema cache refresh
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const verified = await verifyMigration();
  
  if (!verified) {
    console.log('\n⚠️  Verification failed. Possible reasons:');
    console.log('   - Migration SQL had errors (check Supabase SQL Editor for error messages)');
    console.log('   - Schema cache not refreshed yet (wait 10s and check RunPod logs again)');
    console.log('');
    process.exit(1);
  }
  
  console.log('🎉 Migration verified! Your RunPod worker should now claim jobs.\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
