#!/bin/bash
set -e

echo "🔨 Building RunPod Serverless image..."

# Image name (GitHub Container Registry - lié au repo goonidz/purple)
IMAGE_NAME="ghcr.io/goonidz/videoflow-gpu-serverless"
VERSION=$(date +%Y%m%d-%H%M%S)
LATEST_TAG="$IMAGE_NAME:latest"
VERSION_TAG="$IMAGE_NAME:$VERSION"

# Build and push the image (use buildx with --push to bypass local load)
echo "📦 Building and pushing docker image..."
docker buildx build --platform linux/amd64 \
  -f Dockerfile.serverless \
  -t $LATEST_TAG \
  -t $VERSION_TAG \
  --push \
  .

echo "✅ Image built and pushed: $LATEST_TAG"
echo "✅ Version tag: $VERSION_TAG"

echo ""
echo "🎉 Build complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update RunPod Serverless Endpoint image to: $LATEST_TAG"
echo "2. Or use versioned: $VERSION_TAG"
echo ""
echo "🚀 Workers will now start INSTANTLY (no download/install at runtime)!"
