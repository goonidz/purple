require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'laqgmqyjstisipsbljha';

async function applyMigration() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  console.log('🔍 Checking environment variables...');
  console.log('   SUPABASE_URL:', supabaseUrl ? '✅ Found' : '❌ Missing');
  console.log('   ACCESS_TOKEN:', accessToken ? '✅ Found' : '❌ Missing');

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env');
    process.exit(1);
  }

  if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL not found in .env');
    process.exit(1);
  }

  console.log('🚀 Applying migration: Add job_id and status_url to gpu_render_jobs...');
  console.log(`   Project: ${PROJECT_REF}`);
  
  const sqlQuery = `
    -- Add job_id and status_url columns to gpu_render_jobs for RunPod Serverless integration
    ALTER TABLE public.gpu_render_jobs
    ADD COLUMN IF NOT EXISTS job_id TEXT,
    ADD COLUMN IF NOT EXISTS status_url TEXT;

    -- Add index for job_id lookups
    CREATE INDEX IF NOT EXISTS idx_gpu_render_jobs_job_id ON public.gpu_render_jobs(job_id);

    -- Add comments
    COMMENT ON COLUMN public.gpu_render_jobs.job_id IS 'RunPod job ID for tracking serverless renders';
    COMMENT ON COLUMN public.gpu_render_jobs.status_url IS 'RunPod status URL for polling job progress';
  `;
  
  const postData = JSON.stringify({
    query: sqlQuery
  });

  const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/database/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log('✅ Migration applied successfully!');
          console.log('   Response:', data);
          resolve();
        } else {
          console.error(`❌ Management API error: ${res.statusCode}`);
          console.error('   Response:', data);
          
          // Check if error is because column already exists
          if (data.includes('already exists') || data.includes('duplicate')) {
            console.log('✅ Columns already exist (this is OK)');
            resolve();
          } else {
            reject(new Error(`API returned ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

applyMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
