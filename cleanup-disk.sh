#!/bin/bash
echo "[$(date)] Starting disk cleanup..."

docker system prune -af --volumes 2>/dev/null
echo "Docker pruned."

find ~/purple/remotion-service/preview-bundles/ -maxdepth 1 -type d -mtime +2 -exec rm -rf {} + 2>/dev/null
echo "Old preview bundles removed (>2 days)."

find ~/purple/video-render-service/temp/ -type f -mtime +1 -delete 2>/dev/null
echo "Old temp files removed (>1 day)."

find ~/purple/remotion-service/renders/ -type f -mtime +7 -delete 2>/dev/null
echo "Old renders removed (>7 days)."

# Audio files in remotion-service/public/ — critical to prune aggressively.
# Each `bundle()` call copies ALL of public/ into the new webpack bundle dir.
# Left unbounded, public/ grows to several GB, making bundle() take 20–30 s and
# widening the race window where cleanupStaleBundles can wipe in-flight bundles.
# Keep audio files only 6h (plenty for any render/preview to finish).
find ~/purple/remotion-service/public/ -maxdepth 1 -name '*-audio.mp3' -mmin +360 -delete 2>/dev/null
echo "Old audio files in public/ removed (>6h)."

# Remotion webpack bundles on SSD (new location since April 2026)
# The service auto-cleans stale bundles, but this is a safety net.
# Keep any bundle under 24h since last modification.
find /home/ubuntu/remotion-tmp -maxdepth 1 -name 'remotion-webpack-bundle-*' -mmin +1440 -exec rm -rf {} + 2>/dev/null
echo "Old SSD remotion bundles removed (>24h)."

# Remotion Lambda asset directories (different from webpack bundles) — these
# accumulate with every Lambda render and are never cleaned by the service.
find /home/ubuntu/remotion-tmp -maxdepth 1 -name 'remotion-v4-*-assets*' -mmin +360 -exec rm -rf {} + 2>/dev/null
echo "Old Remotion Lambda assets removed (>6h)."

# Legacy /tmp bundles (fallback if TMPDIR redirect fails)
find /tmp -maxdepth 1 -name 'remotion-webpack-bundle-*' -mmin +360 -exec rm -rf {} + 2>/dev/null
echo "Old /tmp bundles removed (>6h)."

echo "[$(date)] Cleanup done. Disk usage:"
df -h / /tmp
