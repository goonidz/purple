#!/bin/bash
set -e

echo "🔨 Building RunPod Serverless image..."

# Image name
IMAGE_NAME="lestermfp/videoflow-gpu-serverless"
VERSION=$(date +%Y%m%d-%H%M%S)
LATEST_TAG="$IMAGE_NAME:latest"
VERSION_TAG="$IMAGE_NAME:$VERSION"

# Build the image
docker build -f Dockerfile.serverless -t $LATEST_TAG -t $VERSION_TAG .

echo "✅ Image built: $LATEST_TAG"
echo "✅ Version tag: $VERSION_TAG"

# Push to Docker Hub
echo "📤 Pushing to Docker Hub..."
docker push $LATEST_TAG
docker push $VERSION_TAG

echo ""
echo "🎉 Build complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update RunPod Serverless Endpoint image to: $LATEST_TAG"
echo "2. Or use versioned: $VERSION_TAG"
echo ""
echo "🚀 Workers will now start INSTANTLY (no download/install at runtime)!"
