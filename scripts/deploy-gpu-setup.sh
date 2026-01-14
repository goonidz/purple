#!/usr/bin/env bash
set -e

# Deploy GPU Pod setup to Supabase
# Usage: DB_PASSWORD=xxx ACCESS_TOKEN=yyy ./scripts/deploy-gpu-setup.sh

PROJECT_REF="hroghyzosrcjueqjftex"
SUPABASE_URL="https://laqgmqyjstisipsbljha.supabase.co"

DB_PASSWORD="${DB_PASSWORD:-}"
ACCESS_TOKEN="${ACCESS_TOKEN:-}"

if [ -z "$DB_PASSWORD" ]; then
  echo "❌ DB_PASSWORD not set"
  echo "Get it from: https://supabase.com/dashboard/project/$PROJECT_REF/settings/database"
  echo "(Connection string → Database password → Show)"
  exit 1
fi

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ ACCESS_TOKEN not set"
  echo "Get it from: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

echo "🚀 Deploying GPU Pod setup..."
echo "Project: $PROJECT_REF"
echo ""

# 1) Apply migration via psql (Session mode pooler)
echo "📦 Step 1/2: Applying migration (gpu_render_jobs)..."
DB_URL="postgresql://postgres.${PROJECT_REF}:${DB_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

psql "$DB_URL" -f "supabase/migrations/20260114211500_gpu_render_jobs.sql"

if [ $? -eq 0 ]; then
  echo "✅ Migration applied"
else
  echo "❌ Migration failed"
  exit 1
fi

echo ""

# 2) Deploy Edge Function via Management API
echo "📦 Step 2/2: Deploying Edge Function (render-video-gpu-pod)..."

FUNC_CODE=$(cat "supabase/functions/render-video-gpu-pod/index.ts")

# Create multipart payload
BOUNDARY="----Boundary$(date +%s)"

cat > /tmp/edge-func-deploy.txt <<EOF
--${BOUNDARY}
Content-Disposition: form-data; name="metadata"

{"entrypoint_path":"index.ts","name":"render-video-gpu-pod","verify_jwt":false}
--${BOUNDARY}
Content-Disposition: form-data; name="file"; filename="index.ts"
Content-Type: application/typescript

${FUNC_CODE}
--${BOUNDARY}--
EOF

curl -X POST \\
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=render-video-gpu-pod" \\
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \\
  -H "Content-Type: multipart/form-data; boundary=${BOUNDARY}" \\
  --data-binary "@/tmp/edge-func-deploy.txt"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Edge Function deployed"
  echo "   URL: ${SUPABASE_URL}/functions/v1/render-video-gpu-pod"
else
  echo ""
  echo "❌ Edge Function deploy failed"
  exit 1
fi

rm /tmp/edge-func-deploy.txt 2>/dev/null || true

echo ""
echo "✅ GPU Pod setup deployed successfully!"
echo ""
echo "📋 Next: rebuild + push GHCR image, then configure RunPod Pod template"
