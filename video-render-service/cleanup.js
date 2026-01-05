#!/usr/bin/env node

/**
 * Cleanup script to remove video render job directories older than 4 days
 * Each job directory contains: images/, segments/, audio.mp3, output.mp4, concat.txt
 * Run this script via cron job: 0 2 * * * (every day at 2 AM)
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execSync } = require('child_process');

const TEMP_DIR = path.join(__dirname, 'temp');
const DAYS_TO_KEEP = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Recursive directory removal
async function removeDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }
    
    // Use rm -rf for reliable deletion
    execSync(`rm -rf "${dirPath}"`, { stdio: 'ignore' });
    return 1;
  } catch (error) {
    console.error(`Failed to remove directory ${dirPath}:`, error.message);
    return 0;
  }
}

// Calculate directory size
function getDirectorySize(dirPath) {
  try {
    const output = execSync(`du -sb "${dirPath}" 2>/dev/null || echo 0`).toString().trim();
    return parseInt(output.split('\t')[0]) || 0;
  } catch (error) {
    // Fallback: estimate from files
    let size = 0;
    try {
      const files = fs.readdirSync(dirPath, { recursive: true });
      for (const file of files) {
        try {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            size += stats.size;
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e) {
      // Ignore
    }
    return size;
  }
}

async function cleanupOldJobs() {
  let deletedCount = 0;
  let deletedSize = 0;
  
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      console.log(`Directory ${TEMP_DIR} does not exist, nothing to clean.`);
      return { deletedCount: 0, deletedSize: 0 };
    }
    
    const entries = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    
    for (const entry of entries) {
      const jobDir = path.join(TEMP_DIR, entry);
      
      try {
        const stats = fs.statSync(jobDir);
        
        if (stats.isDirectory()) {
          // Check if job directory is older than DAYS_TO_KEEP
          const ageInDays = (now - stats.mtimeMs) / MS_PER_DAY;
          
          if (ageInDays > DAYS_TO_KEEP) {
            // Calculate size before deletion
            const dirSize = getDirectorySize(jobDir);
            
            // Remove the entire job directory (images, segments, audio, output, etc.)
            const removed = await removeDirectory(jobDir);
            
            if (removed) {
              deletedCount++;
              deletedSize += dirSize;
              console.log(`Deleted job: ${entry} (${(dirSize / 1024 / 1024).toFixed(2)} MB, ${ageInDays.toFixed(1)} days old)`);
            }
          }
        }
      } catch (err) {
        console.warn(`Error processing ${entry}:`, err.message);
      }
    }
  } catch (error) {
    console.error(`Error cleaning ${TEMP_DIR}:`, error.message);
  }
  
  return { deletedCount, deletedSize };
}

async function main() {
  console.log(`Starting cleanup of render job directories older than ${DAYS_TO_KEEP} days...`);
  console.log(`Target directory: ${TEMP_DIR}`);
  console.log(`Each job directory contains: images/, segments/, audio.mp3, output.mp4, concat.txt\n`);
  
  const result = await cleanupOldJobs();
  
  console.log(`\nCleanup complete:`);
  console.log(`  - Job directories deleted: ${result.deletedCount}`);
  console.log(`  - Space freed: ${(result.deletedSize / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);









