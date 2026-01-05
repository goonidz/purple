#!/usr/bin/env node

/**
 * Script to deploy start-generation-job Edge Function using Supabase Management API
 */

import dotenv from 'dotenv';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_REF = 'laqgmqyjstisipsbljha';
const FUNCTION_NAME = 'start-generation-job';
const FUNCTION_DIR = path.join(__dirname, '..', 'supabase', 'functions', FUNCTION_NAME);
const FUNCTION_FILE = path.join(FUNCTION_DIR, 'index.ts');

async function deployFunction() {
  const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!SUPABASE_ACCESS_TOKEN) {
    throw new Error('SUPABASE_ACCESS_TOKEN not found in .env');
  }

  if (!fs.existsSync(FUNCTION_FILE)) {
    throw new Error(`Function file not found: ${FUNCTION_FILE}`);
  }

  const functionCode = fs.readFileSync(FUNCTION_FILE, 'utf8');
  console.log(`📄 Function file size: ${functionCode.length} bytes`);

  const boundary = `----WebKitFormBoundary${Date.now()}`;
  const metadata = JSON.stringify({
    name: FUNCTION_NAME,
    entrypoint_path: 'index.ts',
    verify_jwt: true
  });

  let formData = Buffer.alloc(0);
  
  const append = (str) => {
    formData = Buffer.concat([formData, Buffer.from(str, 'utf8')]);
  };
  
  append(`--${boundary}\r\n`);
  append(`Content-Disposition: form-data; name="metadata"\r\n`);
  append(`Content-Type: application/json\r\n\r\n`);
  append(`${metadata}\r\n`);
  
  append(`--${boundary}\r\n`);
  append(`Content-Disposition: form-data; name="file"; filename="index.ts"\r\n`);
  append(`Content-Type: text/typescript\r\n\r\n`);
  formData = Buffer.concat([formData, Buffer.from(functionCode, 'utf8')]);
  append(`\r\n`);
  
  append(`--${boundary}--\r\n`);

  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${FUNCTION_NAME}`;
  const urlObj = new URL(url);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length,
      },
    };

    console.log(`🚀 Deploying function ${FUNCTION_NAME} to project ${PROJECT_REF}...`);

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ Function deployed successfully!`);
          if (body) {
            try {
              const data = JSON.parse(body);
              console.log(`📦 Response:`, JSON.stringify(data, null, 2));
            } catch (e) {
              console.log(`📦 Response:`, body);
            }
          }
          resolve(body);
        } else {
          console.error(`❌ Deployment failed with status ${res.statusCode}`);
          console.error(`Response:`, body);
          reject(new Error(`Supabase API error: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request error:`, error);
      reject(error);
    });

    req.write(formData);
    req.end();
  });
}

deployFunction()
  .then(() => {
    console.log(`\n✨ Deployment complete!`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n💥 Deployment failed:`, error.message);
    process.exit(1);
  });
