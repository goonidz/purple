#!/bin/bash

# Script to cleanup old video render files (older than 4 days)
# Usage: ./cleanup-old-files.sh [days]

DAYS=${1:-4}
PORT=${PORT:-3000}
HOST=${HOST:-localhost}

echo "Cleaning up files older than $DAYS days..."
echo "Sending request to http://$HOST:$PORT/cleanup"

curl -X POST http://$HOST:$PORT/cleanup \
  -H "Content-Type: application/json" \
  -d "{\"maxAgeDays\": $DAYS}"

echo ""
echo "Done!"
