require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'laqgmqyjstisipsbljha';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

console.log('🔍 Checking environment variables...');
console.log('   ACCESS_TOKEN:', ACCESS_TOKEN ? '✅ Found' : '❌ Missing');

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env');
  process.exit(1);
}

// Read the migration SQL
const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260109000005_add_qa_regen_job_type.sql');
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

console.log('Applying migration: add_qa_regen_job_type');
console.log('SQL:', migrationSQL);

const data = JSON.stringify({
  query: migrationSQL
});

const options = {
  hostname: 'api.supabase.com',
  port: 443,
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response:', responseData);
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✅ Migration applied successfully!');
    } else {
      console.error('\n❌ Migration failed');
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
  process.exit(1);
});

req.write(data);
req.end();
