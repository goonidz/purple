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

# Remotion webpack bundles on SSD (new location since April 2026)
# The service auto-cleans stale bundles, but this is a safety net.
# Keep any bundle under 24h since last modification.
find /home/ubuntu/remotion-tmp -maxdepth 1 -name 'remotion-webpack-bundle-*' -mmin +1440 -exec rm -rf {} + 2>/dev/null
echo "Old SSD remotion bundles removed (>24h)."

# Legacy /tmp bundles (fallback if TMPDIR redirect fails)
find /tmp -maxdepth 1 -name 'remotion-webpack-bundle-*' -mmin +360 -exec rm -rf {} + 2>/dev/null
echo "Old /tmp bundles removed (>6h)."

echo "[$(date)] Cleanup done. Disk usage:"
df -h / /tmp
