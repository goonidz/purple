#!/bin/bash
set -e

DOCKER_USER="${DOCKER_USER:-lestermfp}"
IMAGE_NAME="runpod-animator-remotion"
TAG="${1:-latest}"

echo "=== Building RunPod Animator Remotion Handler ==="
echo "Image: ${DOCKER_USER}/${IMAGE_NAME}:${TAG}"

mkdir -p fonts

docker build -t "${DOCKER_USER}/${IMAGE_NAME}:${TAG}" -f Dockerfile .

echo "=== Pushing to Docker Hub ==="
docker push "${DOCKER_USER}/${IMAGE_NAME}:${TAG}"

echo ""
echo "=== Done ==="
echo "Image: ${DOCKER_USER}/${IMAGE_NAME}:${TAG}"
echo ""
echo "Next steps:"
echo "  1. Create a RunPod CPU Serverless endpoint with this image"
echo "  2. Set env vars on RunPod: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VPS_UPLOAD_URL, VPS_UPLOAD_TOKEN"
echo "  3. Add RUNPOD_ANIMATOR_ENDPOINT_ID and RUNPOD_API_KEY to remotion-service/.env on VPS"
