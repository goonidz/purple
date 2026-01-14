#!/usr/bin/env node
require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'laqgmqyjstisipsbljha';

async function getLatestLogs() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env');
    process.exit(1);
  }

  console.log('🔍 Fetching latest Edge Function logs...\n');

  // Get logs from the last 10 minutes
  const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  
  const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/functions/scrape-youtube-transcript/invocations`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`📊 Response Status: ${res.statusCode}\n`);
        
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.length === 0) {
              console.log('⚠️  No recent invocations found.');
              console.log('   Try calling the function from the calendar.');
            } else {
              console.log(`✅ Found ${parsed.length} recent invocations:\n`);
              
              parsed.slice(-10).forEach((inv, idx) => {
                console.log(`\n[${idx + 1}] Invocation:`);
                console.log(`   ID: ${inv.id}`);
                console.log(`   Timestamp: ${new Date(inv.created_at).toLocaleString()}`);
                console.log(`   Status: ${inv.status}`);
                console.log(`   Duration: ${inv.execution_time_ms}ms`);
                
                if (inv.response_status) {
                  console.log(`   Response Status: ${inv.response_status}`);
                }
                
                if (inv.logs) {
                  console.log('   Logs:');
                  inv.logs.split('\n').slice(0, 20).forEach(line => {
                    if (line.trim()) console.log(`     ${line}`);
                  });
                }
              });
            }
            
            resolve(parsed);
          } catch (e) {
            console.log('Raw response:', data.substring(0, 1000));
            reject(e);
          }
        } else {
          console.error('Raw response:', data.substring(0, 500));
          
          // If this endpoint doesn't exist, try alternative
          console.log('\n💡 Trying alternative log endpoint...\n');
          getLogsAlternative().then(resolve).catch(reject);
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

async function getLogsAlternative() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  
  const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?iso_timestamp_start=${startTime}`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`📊 Alternative endpoint status: ${res.statusCode}\n`);
        
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            
            // Filter for transcript scraper
            const filtered = (parsed.result || []).filter(log => 
              log.path?.includes('scrape-youtube-transcript') ||
              log.event_message?.includes('scrape') ||
              log.event_message?.includes('transcript') ||
              log.event_message?.includes('Apify')
            );
            
            if (filtered.length === 0) {
              console.log('⚠️  No logs found for scrape-youtube-transcript');
            } else {
              console.log(`✅ Found ${filtered.length} log entries:\n`);
              
              filtered.slice(-20).forEach((log, idx) => {
                const time = new Date(log.timestamp || log.created_at).toLocaleString();
                console.log(`\n[${idx + 1}] ${time}`);
                console.log(`   Level: ${log.level || log.status_code || 'unknown'}`);
                console.log(`   Message: ${log.event_message || log.msg || JSON.stringify(log).substring(0, 200)}`);
                
                if (log.metadata) {
                  console.log('   Metadata:', JSON.stringify(log.metadata, null, 2).substring(0, 500));
                }
              });
            }
            
            resolve(parsed);
          } catch (e) {
            console.log('Raw response:', data.substring(0, 1000));
            reject(e);
          }
        } else {
          console.error('Failed to fetch logs');
          console.log('Raw response:', data.substring(0, 500));
          reject(new Error(`Status ${res.statusCode}`));
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

getLatestLogs().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
