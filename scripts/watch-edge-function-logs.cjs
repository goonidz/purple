#!/usr/bin/env node
require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'laqgmqyjstisipsbljha';
const FUNCTION_NAME = 'scrape-youtube-transcript';

async function fetchLogs() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env');
    process.exit(1);
  }

  console.log(`\n🔍 Fetching logs for ${FUNCTION_NAME}...\n`);

  const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?iso_timestamp_start=${new Date(Date.now() - 600000).toISOString()}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
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
          try {
            const logs = JSON.parse(data);
            
            // Filter logs for our function
            const functionLogs = logs.result?.filter(log => 
              log.path?.includes(FUNCTION_NAME) || 
              log.msg?.includes(FUNCTION_NAME) ||
              log.event_message?.includes(FUNCTION_NAME)
            ) || [];

            if (functionLogs.length === 0) {
              console.log('⚠️  No logs found for this function yet.');
              console.log('   Try triggering a transcript scrape from the calendar.');
            } else {
              console.log(`✅ Found ${functionLogs.length} log entries:\n`);
              functionLogs.slice(-20).forEach(log => {
                const timestamp = new Date(log.timestamp).toLocaleString();
                const level = log.level || log.status_code || '';
                const message = log.event_message || log.msg || JSON.stringify(log);
                console.log(`[${timestamp}] [${level}] ${message}`);
              });
            }
            
            resolve(logs);
          } catch (e) {
            console.error('Failed to parse logs:', e.message);
            console.log('Raw response:', data);
            reject(e);
          }
        } else {
          console.error(`❌ API error: ${res.statusCode}`);
          console.error('   Response:', data);
          reject(new Error(`API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });

    req.end();
  });
}

// Run once
fetchLogs().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
