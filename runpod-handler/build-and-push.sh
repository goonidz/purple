#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "🔨 Building RunPod GPU Worker image..."
echo ""

# Version tag
VERSION=$(date +%Y%m%d-%H%M)

echo "📦 Building multi-arch image..."
docker buildx build --platform linux/amd64 \
  -t ghcr.io/goonidz/purple-runpod-handler:latest \
  -t ghcr.io/goonidz/purple-runpod-handler:$VERSION \
  -f runpod-handler/Dockerfile \
  --push \
  .

echo ""
echo "✅ Image built and pushed successfully!"
echo ""
echo "📋 Images:"
echo "   - ghcr.io/goonidz/purple-runpod-handler:latest"
echo "   - ghcr.io/goonidz/purple-runpod-handler:$VERSION"
echo ""
echo "🎯 Next steps:"
echo "   1. Go to RunPod Dashboard → Templates"
echo "   2. Create template with image: ghcr.io/goonidz/purple-runpod-handler:latest"
echo "   3. Set env vars: RUNPOD_MODE=worker, SUPABASE_URL, SUPABASE_SERVICE_KEY"
echo ""
