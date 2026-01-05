#!/usr/bin/env node

/**
 * Script to test CORS on animate-scene Edge Function
 */

import https from 'https';

const PROJECT_REF = 'laggmqyjstisipsbljha';
const FUNCTION_NAME = 'animate-scene';

async function testCORS() {
  const url = `https://${PROJECT_REF}.supabase.co/functions/v1/${FUNCTION_NAME}`;
  const urlObj = new URL(url);

  return new Promise((resolve, reject) => {
    // Test OPTIONS request (preflight)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://purpleai.duckdns.org',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    };

    console.log(`🧪 Testing CORS preflight (OPTIONS) for ${FUNCTION_NAME}...`);
    console.log(`📍 URL: ${url}`);

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log(`\n📊 Response Status: ${res.statusCode}`);
        console.log(`📋 Response Headers:`);
        console.log(JSON.stringify(res.headers, null, 2));
        
        if (res.statusCode === 200 || res.statusCode === 204) {
          console.log(`\n✅ CORS preflight successful! Status ${res.statusCode}`);
          
          // Check for CORS headers
          const corsHeaders = {
            'access-control-allow-origin': res.headers['access-control-allow-origin'],
            'access-control-allow-methods': res.headers['access-control-allow-methods'],
            'access-control-allow-headers': res.headers['access-control-allow-headers'],
          };
          
          console.log(`\n🔍 CORS Headers found:`, corsHeaders);
          
          if (corsHeaders['access-control-allow-origin']) {
            console.log(`\n✅ CORS is properly configured!`);
          } else {
            console.log(`\n⚠️  CORS headers missing, but status is OK`);
          }
        } else {
          console.log(`\n❌ CORS preflight failed! Status ${res.statusCode}`);
          console.log(`Response body:`, body);
        }
        
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request error:`, error);
      reject(error);
    });

    req.end();
  });
}

// Run test
testCORS()
  .then(() => {
    console.log(`\n✨ Test complete!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n💥 Test failed:`, error.message);
    process.exit(1);
  });
