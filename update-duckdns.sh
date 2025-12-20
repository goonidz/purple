#!/bin/bash

# Script de mise à jour automatique de l'IP DuckDNS
# Usage: ./update-duckdns.sh

# Charger les variables d'environnement depuis ~/.duckdns
if [ -f ~/.duckdns ]; then
    source ~/.duckdns
else
    echo "Error: ~/.duckdns file not found"
    echo "Create it with: DUCKDNS_DOMAIN=yourdomain DUCKDNS_TOKEN=your-token"
    exit 1
fi

# Vérifier que les variables sont définies
if [ -z "$DUCKDNS_DOMAIN" ] || [ -z "$DUCKDNS_TOKEN" ]; then
    echo "Error: DUCKDNS_DOMAIN and DUCKDNS_TOKEN must be set in ~/.duckdns"
    exit 1
fi

# URL de mise à jour DuckDNS
UPDATE_URL="https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="

# Faire la requête de mise à jour avec timeout et retry
MAX_RETRIES=3
RETRY_COUNT=0
RESPONSE=""

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    RESPONSE=$(curl -s --max-time 10 --connect-timeout 10 "${UPDATE_URL}" 2>&1)
    CURL_EXIT=$?
    
    if [ $CURL_EXIT -eq 0 ] && [ ! -z "$RESPONSE" ]; then
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        sleep 2
    fi
done

# Vérifier si curl a réussi
if [ $CURL_EXIT -ne 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Error: Failed to connect to DuckDNS (curl exit code: $CURL_EXIT)"
    echo "Response: $RESPONSE"
    # Ne pas échouer, juste logger l'erreur
    exit 0
fi

if [ -z "$RESPONSE" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Warning: Empty response from DuckDNS (network issue or DNS propagation)"
    exit 0
fi

# Vérifier la réponse
if [ "$RESPONSE" = "OK" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DuckDNS IP updated successfully for ${DUCKDNS_DOMAIN}.duckdns.org"
    exit 0
elif [ -z "$RESPONSE" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Error: Empty response from DuckDNS. Possible issues:"
    echo "  - Token may be invalid"
    echo "  - Domain may not exist on DuckDNS"
    echo "  - Network connectivity issue"
    echo "  Try: curl -v 'https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip='"
    exit 1
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Error updating DuckDNS: $RESPONSE"
    exit 1
fi
