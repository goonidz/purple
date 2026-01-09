require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.production') });
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'laqgmqyjstisipsbljha';
const MIGRATION_FILE = path.join(__dirname, '../supabase/migrations/20260109000004_add_qa_prompt_to_presets.sql');

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

  console.log('🚀 Applying QA prompt preset migration via Supabase Management API...');
  console.log(`   Project: ${PROJECT_REF}`);
  console.log(`📄 Migration SQL loaded from: ${MIGRATION_FILE}`);

  const sqlQuery = fs.readFileSync(MIGRATION_FILE, 'utf8');

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
          console.log('   Added qa_prompt column to presets table');
          console.log('   Response:', data);
          resolve();
        } else {
          console.error(`❌ Management API error: ${res.statusCode}`);
          console.error('   Response:', data);
          
          if (data.includes('already exists') || data.includes('duplicate')) {
            console.log('✅ qa_prompt column already exists (this is OK)');
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
