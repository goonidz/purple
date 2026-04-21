#!/usr/bin/env bash
# Local development launcher for the CRM webmail FastAPI app.
# Not used on the VPS — see setup-vps.sh for that.
set -e

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ">>> .env créé depuis .env.example — édite-le avec tes clés Supabase avant d'utiliser l'app."
  exit 1
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8002}"
ROOT_PATH="${ROOT_PATH:-/crm}"

exec uvicorn app.main:app --host "$HOST" --port "$PORT" --reload --root-path "$ROOT_PATH"
