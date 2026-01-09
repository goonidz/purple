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

  console.log('🚀 Applying QA job type migration via Supabase Management API...');
  console.log(`   Project: ${PROJECT_REF}`);
  
  // Add 'qa' to job_type enum
  const sqlQuery = "ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'qa';";
  
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
          console.log('   Added "qa" to job_type enum');
          console.log('   Response:', data);
          resolve();
        } else {
          console.error(`❌ Management API error: ${res.statusCode}`);
          console.error('   Response:', data);
          
          // Check if error is because value already exists
          if (data.includes('already exists') || data.includes('duplicate')) {
            console.log('✅ Value already exists (this is OK)');
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
