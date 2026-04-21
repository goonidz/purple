#!/usr/bin/env bash
# Idempotent installer / restarter for the CRM webmail FastAPI service on
# the OVH VPS.
#
# - creates .venv and installs deps
# - verifies .env exists (fails loudly otherwise — secrets are NOT in git)
# - (re)registers the "crm-webmail" PM2 app on port 8002 bound to 127.0.0.1
#
# Usage (from the VPS):
#   cd ~/purple/crm && ./setup-vps.sh
#
# After first install:
#   pm2 save
#   pm2 startup   # follow instructions to persist across reboots

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🐍  Python venv${NC}"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
deactivate

if [ ! -f ".env" ]; then
  echo -e "${RED}❌  crm/.env is missing — copy .env.example and fill SUPABASE_* secrets manually.${NC}"
  echo "    .env is intentionally gitignored; provision it via scp/ssh, never commit it."
  exit 1
fi

# Make sure the cache and uploads dirs exist and are writeable by the
# current user (= the user running PM2).
mkdir -p uploads
touch cache.sqlite || true

APP_NAME="crm-webmail"
PORT="${PORT:-8002}"
HOST="${HOST:-127.0.0.1}"
ROOT_PATH="${ROOT_PATH:-/crm}"

echo -e "${YELLOW}🧭  PM2 service: ${APP_NAME} (port ${PORT})${NC}"

# PM2 does NOT reload env files on plain restart (see project rules).
# Always delete + re-start so the .env file is read fresh.
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 delete "$APP_NAME" >/dev/null
fi

# Launch uvicorn through the venv's python interpreter so PM2 picks up
# the right binary without relying on $PATH.
pm2 start "$SCRIPT_DIR/.venv/bin/uvicorn" \
  --name "$APP_NAME" \
  --cwd "$SCRIPT_DIR" \
  --interpreter none \
  -- \
  app.main:app \
  --host "$HOST" \
  --port "$PORT" \
  --root-path "$ROOT_PATH" \
  --workers 2

echo -e "${GREEN}✅  ${APP_NAME} started on ${HOST}:${PORT} (root_path=${ROOT_PATH})${NC}"
echo ""
echo "Next: test it from the VPS:"
echo "  curl -I http://127.0.0.1:${PORT}/   # expects 302/401 (redirect to /auth)"
echo ""
echo "Don't forget: 'pm2 save' to persist this across reboots."
