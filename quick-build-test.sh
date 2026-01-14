#!/bin/bash
set -e

cd "/Users/Tom/Documents/Cursor/VideoFlow 2"

echo "🧹 Cleaning dist..."
rm -rf dist/

echo "🔨 Building (with 60s timeout)..."
# Use caffeinate to prevent sleep, run build in background with timeout
( npm run build & PID=$! ; sleep 60 && kill $PID 2>/dev/null ) &
wait $! 2>/dev/null

if [ -d "dist" ]; then
  echo "✅ Build succeeded!"
  ls -lh dist/ | head -10
  exit 0
else
  echo "❌ Build failed or timed out"
  exit 1
fi
