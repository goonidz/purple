#!/bin/bash
set -e

PROJECT_ID=$(gcloud config get-value project)
REGION="europe-west1"
SERVICE_NAME="remotion-renderer"
REPO_NAME="remotion"
GCS_BUCKET="${PROJECT_ID}-renders"

echo "=== Cloud Renderer Deploy ==="
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "Service: $SERVICE_NAME"
echo "Bucket:  $GCS_BUCKET"
echo ""

# 1. Create Artifact Registry repo (if not exists)
echo "[1/5] Creating Artifact Registry repo..."
gcloud artifacts repositories create $REPO_NAME \
  --repository-format=docker \
  --location=$REGION \
  --quiet 2>/dev/null || echo "  (already exists)"

# 2. Create GCS bucket (if not exists)
echo "[2/5] Creating GCS bucket..."
gcloud storage buckets create gs://$GCS_BUCKET \
  --location=$REGION \
  --uniform-bucket-level-access \
  --quiet 2>/dev/null || echo "  (already exists)"

# Make objects publicly readable
gcloud storage buckets add-iam-policy-binding gs://$GCS_BUCKET \
  --member=allUsers \
  --role=roles/storage.objectViewer \
  --quiet 2>/dev/null || true

# 3. Build and push Docker image
echo "[3/5] Building Docker image..."
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
gcloud builds submit --tag $IMAGE --quiet

# 4. Deploy to Cloud Run
echo "[4/5] Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image=$IMAGE \
  --region=$REGION \
  --platform=managed \
  --memory=8Gi \
  --cpu=4 \
  --timeout=3600 \
  --max-instances=10 \
  --min-instances=0 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars="GCS_BUCKET_NAME=$GCS_BUCKET" \
  --set-env-vars="SUPABASE_URL=${SUPABASE_URL}" \
  --set-env-vars="SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}" \
  --quiet

# 5. Get the service URL
echo ""
echo "[5/5] Getting service URL..."
URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo ""
echo "=== DONE ==="
echo "Cloud Run URL: $URL"
echo ""
echo "Add this to your VPS remotion-service/.env:"
echo "  CLOUD_RUN_RENDER_URL=$URL"
echo ""
echo "Then restart: pm2 delete remotion-service && cd remotion-service && pm2 start server.js --name remotion-service"
