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

  console.log('🚀 Applying duplicate prevention migration via Supabase Management API...');
  console.log(`   Project: ${PROJECT_REF}`);
  
  // Step 1: Clean up existing duplicates
  console.log('\n📋 Step 1: Cleaning up existing duplicates...');
  const cleanupQuery = `
    WITH duplicates AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY project_id, scene_index, prediction_type 
        ORDER BY created_at DESC
      ) as rn
      FROM pending_predictions
      WHERE status IN ('pending', 'processing', 'starting')
        AND scene_index IS NOT NULL
    )
    DELETE FROM pending_predictions 
    WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
  `;
  
  await executeQuery(cleanupQuery, accessToken, 'cleanup duplicates');
  
  // Step 2: Create unique index
  console.log('\n📋 Step 2: Creating unique index to prevent future duplicates...');
  const indexQuery = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_prediction_per_scene
    ON pending_predictions (project_id, scene_index, prediction_type)
    WHERE status IN ('pending', 'processing', 'starting') AND scene_index IS NOT NULL;
  `;
  
  await executeQuery(indexQuery, accessToken, 'create unique index');
  
  console.log('\n🎉 Migration completed successfully!');
  console.log('   Duplicate predictions are now blocked at the database level.');
}

function executeQuery(query, accessToken, description) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });

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

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`   ✅ ${description}: Success`);
          resolve(data);
        } else {
          console.error(`   ❌ ${description}: Error ${res.statusCode}`);
          console.error('   Response:', data);
          
          // Check if error is because index already exists
          if (data.includes('already exists')) {
            console.log(`   ℹ️  Index already exists (this is OK)`);
            resolve(data);
          } else {
            reject(new Error(`API returned ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error(`   ❌ Request error for ${description}:`, error.message);
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
