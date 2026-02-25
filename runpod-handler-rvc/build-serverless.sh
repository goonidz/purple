#!/usr/bin/env bash
# Build and push RunPod Serverless RVC Docker image to GHCR
set -euo pipefail

IMAGE="ghcr.io/goonidz/videoflow-rvc-serverless"
TAG="${1:-latest}"

echo "==> Building $IMAGE:$TAG"
docker build \
  -f Dockerfile.serverless \
  -t "$IMAGE:$TAG" \
  .

echo "==> Pushing $IMAGE:$TAG"
docker push "$IMAGE:$TAG"

echo ""
echo "Done: $IMAGE:$TAG"
echo ""
echo "Next steps:"
echo "  1. Go to https://www.runpod.io/console/serverless"
echo "  2. Create a new endpoint"
echo "  3. Container image: $IMAGE:$TAG"
echo "  4. GPU: RTX 3090 / RTX 4090 (24 GB VRAM recommended)"
echo "  5. Min workers: 0, Max workers: 5"
echo "  6. Env vars:"
echo "       SUPABASE_URL=<your Supabase URL>"
echo "       SUPABASE_SERVICE_KEY=<your service role key>"
echo "  7. Copy the endpoint ID and set on VPS:"
echo "       export RUNPOD_RVC_ENDPOINT_ID=<endpoint_id>"
echo "       export RUNPOD_API_KEY=<your RunPod API key>"
