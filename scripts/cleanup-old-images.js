#!/usr/bin/env node

/**
 * Script to call the cleanup-old-images Edge Function
 * Can be used with cron or scheduled task services
 * 
 * Usage:
 *   node scripts/cleanup-old-images.js
 * 
 * Or add to crontab:
 *   0 2 * * * cd /path/to/project && node scripts/cleanup-old-images.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://laqgmqyjstisipsbljha.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

async function cleanupOldImages() {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/cleanup-old-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('Cleanup completed:', result);
    return result;
  } catch (error) {
    console.error('Error calling cleanup function:', error);
    throw error;
  }
}

// Run cleanup
cleanupOldImages()
  .then(() => {
    console.log('Cleanup script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Cleanup script failed:', error);
    process.exit(1);
  });
