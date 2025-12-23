#!/bin/bash

# Script to add SUPABASE_SERVICE_ROLE_KEY to GitHub secrets
# This script uses the Supabase CLI to get the service role key
# and the GitHub API to add it as a secret

set -e

REPO_OWNER="goonidz"
REPO_NAME="purple"
SECRET_NAME="SUPABASE_SERVICE_ROLE_KEY"
PROJECT_REF="laqgmqyjstisipsbljha"

echo "🔍 Récupération de la clé service role depuis Supabase..."

# Get service role key from Supabase API settings
# Note: We need to get it from the dashboard or use Supabase Management API
echo "📝 Pour obtenir la clé service role:"
echo "   1. Va sur: https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api"
echo "   2. Copie la clé 'service_role' (celle qui est secrète)"
echo ""
read -p "Colle la clé service role ici: " SERVICE_ROLE_KEY

if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "❌ Erreur: La clé service role est requise"
  exit 1
fi

echo ""
echo "🔑 Pour ajouter le secret à GitHub, tu as besoin d'un token GitHub:"
echo "   1. Va sur: https://github.com/settings/tokens"
echo "   2. Clique sur 'Generate new token (classic)'"
echo "   3. Sélectionne les scopes: repo, workflow"
echo "   4. Copie le token"
echo ""
read -p "Colle le token GitHub ici: " GITHUB_TOKEN

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Erreur: Le token GitHub est requis"
  exit 1
fi

echo ""
echo "📥 Récupération de la clé publique du repository..."

# Get public key
PUBLIC_KEY_RESPONSE=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets/public-key")

PUBLIC_KEY=$(echo "$PUBLIC_KEY_RESPONSE" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
KEY_ID=$(echo "$PUBLIC_KEY_RESPONSE" | grep -o '"key_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$PUBLIC_KEY" ] || [ -z "$KEY_ID" ]; then
  echo "❌ Erreur lors de la récupération de la clé publique"
  echo "$PUBLIC_KEY_RESPONSE"
  exit 1
fi

echo "✅ Clé publique récupérée"

echo ""
echo "🔐 Chiffrement du secret..."

# Check if we have Python with PyNaCl
if command -v python3 &> /dev/null; then
  # Try to encrypt with Python
  ENCRYPTED_VALUE=$(python3 << EOF
import base64
import sys
try:
    from nacl import encoding, public
    public_key_bytes = base64.b64decode("${PUBLIC_KEY}")
    public_key_obj = public.PublicKey(public_key_bytes)
    box = public.SealedBox(public_key_obj)
    encrypted = box.encrypt("${SERVICE_ROLE_KEY}".encode('utf-8'))
    print(base64.b64encode(encrypted).decode('utf-8'))
except ImportError:
    print("ERROR: PyNaCl not installed. Install with: pip install pynacl", file=sys.stderr)
    sys.exit(1)
EOF
)
  
  if [[ "$ENCRYPTED_VALUE" == ERROR* ]]; then
    echo "$ENCRYPTED_VALUE"
    echo "💡 Installe PyNaCl: pip install pynacl"
    exit 1
  fi
else
  echo "❌ Python3 n'est pas installé. Installe-le ou utilise le script Python directement."
  exit 1
fi

echo "✅ Secret chiffré"

echo ""
echo "📤 Ajout du secret à GitHub..."

# Add secret
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets/${SECRET_NAME}" \
  -d "{\"encrypted_value\":\"${ENCRYPTED_VALUE}\",\"key_id\":\"${KEY_ID}\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ]; then
  echo "✅ Secret ${SECRET_NAME} ajouté avec succès à GitHub!"
  echo "🎉 Le workflow GitHub Actions pourra maintenant utiliser ce secret."
else
  echo "❌ Erreur lors de l'ajout du secret (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi
