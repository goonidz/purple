#!/usr/bin/env node

/**
 * Cleanup script to remove video files older than 3 days
 * Run this script via cron job: 0 2 * * * (every day at 2 AM)
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

const TEMP_DIR = path.join(__dirname, 'temp');
const DAYS_TO_KEEP = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function cleanupOldFiles(dir) {
  let deletedCount = 0;
  let deletedSize = 0;
  
  try {
    if (!fs.existsSync(dir)) {
      return { deletedCount: 0, deletedSize: 0 };
    }
    
    const entries = await readdir(dir);
    const now = Date.now();
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stats = await stat(fullPath);
      
      if (stats.isDirectory()) {
        // Recursively clean subdirectories
        const result = await cleanupOldFiles(fullPath);
        deletedCount += result.deletedCount;
        deletedSize += result.deletedSize;
        
        // Try to remove empty directory
        try {
          const remaining = await readdir(fullPath);
          if (remaining.length === 0) {
            await rmdir(fullPath);
            console.log(`Removed empty directory: ${fullPath}`);
          }
        } catch (e) {
          // Directory not empty or already removed, ignore
        }
      } else {
        // Check if file is older than DAYS_TO_KEEP
        const ageInDays = (now - stats.mtimeMs) / MS_PER_DAY;
        
        if (ageInDays > DAYS_TO_KEEP) {
          try {
            await unlink(fullPath);
            deletedCount++;
            deletedSize += stats.size;
            console.log(`Deleted: ${fullPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${ageInDays.toFixed(1)} days old)`);
          } catch (error) {
            console.error(`Failed to delete ${fullPath}:`, error.message);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error cleaning ${dir}:`, error.message);
  }
  
  return { deletedCount, deletedSize };
}

async function main() {
  console.log(`Starting cleanup of files older than ${DAYS_TO_KEEP} days...`);
  console.log(`Target directory: ${TEMP_DIR}`);
  
  const result = await cleanupOldFiles(TEMP_DIR);
  
  console.log(`\nCleanup complete:`);
  console.log(`  - Files deleted: ${result.deletedCount}`);
  console.log(`  - Space freed: ${(result.deletedSize / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);





