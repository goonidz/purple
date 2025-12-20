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

# Faire la requête de mise à jour
RESPONSE=$(curl -s "${UPDATE_URL}")

# Vérifier la réponse
if [ "$RESPONSE" = "OK" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DuckDNS IP updated successfully for ${DUCKDNS_DOMAIN}.duckdns.org"
    exit 0
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Error updating DuckDNS: $RESPONSE"
    exit 1
fi
