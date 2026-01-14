#!/usr/bin/env node
require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'laqgmqyjstisipsbljha';

async function testTranscriptScrape() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env');
    process.exit(1);
  }

  // Test avec une vidéo YouTube connue
  const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
  const testCalendarEntryId = 'test-' + Date.now();

  console.log('🧪 Testing transcript scraper...');
  console.log('   URL:', testUrl);
  console.log('   Mock Calendar Entry ID:', testCalendarEntryId);
  console.log('');

  const postData = JSON.stringify({
    url: testUrl,
    calendarEntryId: testCalendarEntryId
  });

  const functionUrl = new URL(`${supabaseUrl}/functions/v1/scrape-youtube-transcript`);
  
  const options = {
    hostname: functionUrl.hostname,
    path: functionUrl.pathname,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'apikey': anonKey,
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
        console.log(`\n📊 Response Status: ${res.statusCode}\n`);
        
        try {
          const parsed = JSON.parse(data);
          console.log('Response:', JSON.stringify(parsed, null, 2));
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('\n✅ SUCCESS!');
            if (parsed.transcript) {
              console.log(`   Transcript length: ${parsed.transcript.length} characters`);
              console.log(`   First 200 chars: ${parsed.transcript.substring(0, 200)}...`);
            }
          } else {
            console.log('\n❌ FAILED');
            if (parsed.debug) {
              console.log('\n🔍 Debug Info:');
              console.log(JSON.stringify(parsed.debug, null, 2));
            }
          }
          
          resolve(parsed);
        } catch (e) {
          console.log('Raw response:', data);
          reject(e);
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

console.log('⏳ This test will take ~30 seconds (waiting for Apify to scrape)...\n');

testTranscriptScrape().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
