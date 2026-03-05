#!/usr/bin/env node

/**
 * Cleanup script — runs daily via cron at 2 AM
 *   0 2 * * * cd /home/ubuntu/purple/video-render-service && node cleanup.js >> cleanup.log 2>&1
 *
 * Cleans two locations:
 *   1. ./temp — local render job directories (images/, segments/, audio, output)
 *   2. /var/www/rendered-videos — final .mp4 files uploaded by GPU workers
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEMP_DIR = path.join(__dirname, 'temp');
const RENDERED_DIR = '/var/www/rendered-videos';
const DAYS_TO_KEEP = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function removeEntry(entryPath) {
  try {
    if (!fs.existsSync(entryPath)) return false;
    execSync(`rm -rf "${entryPath}"`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.error(`  Failed to remove ${entryPath}: ${error.message}`);
    return false;
  }
}

function getSize(entryPath) {
  try {
    const stats = fs.statSync(entryPath);
    if (stats.isFile()) return stats.size;
    const output = execSync(`du -sb "${entryPath}" 2>/dev/null || echo 0`).toString().trim();
    return parseInt(output.split('\t')[0]) || 0;
  } catch {
    return 0;
  }
}

function cleanupDirectory(dir, { matchDirs = false, matchFiles = false }) {
  let deletedCount = 0;
  let deletedSize = 0;

  if (!fs.existsSync(dir)) {
    console.log(`  Directory ${dir} does not exist, skipping.`);
    return { deletedCount, deletedSize };
  }

  const entries = fs.readdirSync(dir);
  const now = Date.now();

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      const stats = fs.statSync(fullPath);
      const isDir = stats.isDirectory();
      const isFile = stats.isFile();

      if ((matchDirs && isDir) || (matchFiles && isFile)) {
        const ageInDays = (now - stats.mtimeMs) / MS_PER_DAY;
        if (ageInDays > DAYS_TO_KEEP) {
          const size = getSize(fullPath);
          if (removeEntry(fullPath)) {
            deletedCount++;
            deletedSize += size;
            console.log(`  Deleted: ${entry} (${(size / 1024 / 1024).toFixed(1)} MB, ${ageInDays.toFixed(1)} days old)`);
          }
        }
      }
    } catch (err) {
      console.warn(`  Error processing ${entry}: ${err.message}`);
    }
  }

  return { deletedCount, deletedSize };
}

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Cleanup starting (keeping files < ${DAYS_TO_KEEP} days)...\n`);

  // 1. Clean temp render job directories
  console.log(`[1/2] Temp render directories: ${TEMP_DIR}`);
  const tempResult = cleanupDirectory(TEMP_DIR, { matchDirs: true });

  // 2. Clean rendered video files uploaded by GPU workers
  console.log(`[2/2] Rendered videos: ${RENDERED_DIR}`);
  const videoResult = cleanupDirectory(RENDERED_DIR, { matchFiles: true });

  const totalCount = tempResult.deletedCount + videoResult.deletedCount;
  const totalSize = tempResult.deletedSize + videoResult.deletedSize;

  console.log(`\nCleanup complete:`);
  console.log(`  Temp dirs deleted:   ${tempResult.deletedCount} (${(tempResult.deletedSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  Videos deleted:      ${videoResult.deletedCount} (${(videoResult.deletedSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  Total freed:         ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
}

main().catch(console.error);
