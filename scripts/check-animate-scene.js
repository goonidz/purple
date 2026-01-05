#!/usr/bin/env node

/**
 * Script to check the animate-scene Edge Function code on Supabase
 */

import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const PROJECT_REF = 'laggmqyjstisipsbljha';
const FUNCTION_NAME = 'animate-scene';

async function checkFunction() {
  const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!SUPABASE_ACCESS_TOKEN) {
    throw new Error('SUPABASE_ACCESS_TOKEN not found in .env');
  }

  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${FUNCTION_NAME}`;
  const urlObj = new URL(url);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    console.log(`🔍 Checking function ${FUNCTION_NAME} on Supabase...`);

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const data = JSON.parse(body);
            console.log(`✅ Function found!`);
            console.log(`📦 Function details:`, JSON.stringify(data, null, 2));
            
            // Try to get the function code if available
            if (data.source_code || data.code) {
              const code = data.source_code || data.code;
              console.log(`\n📄 Function code (first 500 chars):`);
              console.log(code.substring(0, 500));
              
              // Check for CORS fix
              if (code.includes('return new Response(null, { headers: corsHeaders })')) {
                console.log(`\n✅ CORS fix found! Line contains: return new Response(null, { headers: corsHeaders })`);
              } else if (code.includes("return new Response('ok'")) {
                console.log(`\n❌ CORS fix NOT found! Still using: return new Response('ok'`);
              } else {
                console.log(`\n⚠️  Could not determine CORS fix status`);
              }
            }
            
            resolve(data);
          } else {
            console.error(`❌ Failed with status ${res.statusCode}`);
            console.error(`Response:`, body);
            reject(new Error(`Supabase API error: ${res.statusCode} - ${body}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request error:`, error);
      reject(error);
    });

    req.end();
  });
}

// Run check
checkFunction()
  .then(() => {
    console.log(`\n✨ Check complete!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n💥 Check failed:`, error.message);
    process.exit(1);
  });
