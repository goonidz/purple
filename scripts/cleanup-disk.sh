#!/bin/bash
# Disk cleanup for the Remotion / video-render workloads.
# - Deletes preview-bundles older than 24h.
# - Wipes the Remotion webpack cache when it exceeds 5 GB.
# - Trims temp/ folders older than 24h.
# - Removes rendered-videos older than 48h (final MP4s served by
#   video-storage-api). 670 MB average per render, ~5/day → fills
#   the disk in a month if not pruned.
#
# Designed to be run by cron every hour. Output is appended to
# /var/log/videoflow-cleanup.log so you can audit what got purged.

set -u

LOG="/var/log/videoflow-cleanup.log"
PURPLE="/home/ubuntu/purple"
PREVIEW_DIR="$PURPLE/remotion-service/preview-bundles"
WEBPACK_CACHE="$PURPLE/remotion-service/node_modules/.cache/webpack"
REMOTION_TEMP="$PURPLE/remotion-service/temp"
VIDEO_RENDER_TEMP="$PURPLE/video-render-service/temp"
RENDERED_VIDEOS_DIR="/var/www/rendered-videos"
WEBPACK_LIMIT_GB=5
RENDERED_VIDEOS_MAX_AGE_MIN=2880   # 48h

# Total threshold beyond which the webpack cache is wiped (in 1K blocks → 5 GB).
WEBPACK_LIMIT_KB=$((WEBPACK_LIMIT_GB * 1024 * 1024))

ts() { date '+%Y-%m-%d %H:%M:%S'; }

{
  echo "[$(ts)] === cleanup-disk start ==="
  df -h / | tail -1

  if [ -d "$PREVIEW_DIR" ]; then
    BEFORE=$(find "$PREVIEW_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
    find "$PREVIEW_DIR" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null
    AFTER=$(find "$PREVIEW_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
    echo "[$(ts)] preview-bundles: $BEFORE → $AFTER (deleted $((BEFORE - AFTER)) older than 24h)"
  fi

  if [ -d "$WEBPACK_CACHE" ]; then
    SIZE_KB=$(du -sk "$WEBPACK_CACHE" 2>/dev/null | awk '{print $1}')
    SIZE_KB=${SIZE_KB:-0}
    if [ "$SIZE_KB" -gt "$WEBPACK_LIMIT_KB" ]; then
      SIZE_GB=$(awk -v k="$SIZE_KB" 'BEGIN { printf "%.1f", k/1024/1024 }')
      rm -rf "$WEBPACK_CACHE"
      echo "[$(ts)] webpack cache: was ${SIZE_GB} GB (> ${WEBPACK_LIMIT_GB} GB) → wiped"
    else
      SIZE_GB=$(awk -v k="$SIZE_KB" 'BEGIN { printf "%.2f", k/1024/1024 }')
      echo "[$(ts)] webpack cache: ${SIZE_GB} GB (under ${WEBPACK_LIMIT_GB} GB threshold, kept)"
    fi
  fi

  if [ -d "$REMOTION_TEMP" ]; then
    find "$REMOTION_TEMP" -mindepth 1 -mmin +1440 -exec rm -rf {} + 2>/dev/null
    echo "[$(ts)] remotion temp/ trimmed (>24h)"
  fi

  if [ -d "$VIDEO_RENDER_TEMP" ]; then
    find "$VIDEO_RENDER_TEMP" -mindepth 1 -mmin +1440 -exec rm -rf {} + 2>/dev/null
    echo "[$(ts)] video-render temp/ trimmed (>24h)"
  fi

  if [ -d "$RENDERED_VIDEOS_DIR" ]; then
    BEFORE=$(find "$RENDERED_VIDEOS_DIR" -maxdepth 1 -type f -name '*.mp4' 2>/dev/null | wc -l)
    BEFORE_GB=$(du -sb "$RENDERED_VIDEOS_DIR" 2>/dev/null | awk '{printf "%.1f", $1/1024/1024/1024}')
    find "$RENDERED_VIDEOS_DIR" -maxdepth 1 -type f -name '*.mp4' -mmin +"$RENDERED_VIDEOS_MAX_AGE_MIN" -delete 2>/dev/null
    AFTER=$(find "$RENDERED_VIDEOS_DIR" -maxdepth 1 -type f -name '*.mp4' 2>/dev/null | wc -l)
    AFTER_GB=$(du -sb "$RENDERED_VIDEOS_DIR" 2>/dev/null | awk '{printf "%.1f", $1/1024/1024/1024}')
    echo "[$(ts)] rendered-videos: $BEFORE files (${BEFORE_GB} GB) → $AFTER files (${AFTER_GB} GB), deleted $((BEFORE - AFTER)) older than 48h"
  fi

  df -h / | tail -1
  echo "[$(ts)] === cleanup-disk done ==="
} >> "$LOG" 2>&1
