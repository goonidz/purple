#!/bin/bash

# Deployment script for VideoFlow on VPS
# Usage: ./deploy.sh

set -e

echo "🚀 Starting VideoFlow deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}⚠️  Warning: .env.production not found${NC}"
    echo "Creating .env.production from template..."
    cat > .env.production << EOF
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key_here
EOF
    echo -e "${RED}❌ Please edit .env.production with your Supabase credentials before deploying${NC}"
    exit 1
fi

# Load environment variables
export $(cat .env.production | grep -v '^#' | xargs)

# Check if required variables are set
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$VITE_SUPABASE_PUBLISHABLE_KEY" ]; then
    echo -e "${RED}❌ Error: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in .env.production${NC}"
    exit 1
fi

echo "📦 Building Docker image..."
# Use --no-cache if FORCE_REBUILD is set
if [ "$FORCE_REBUILD" = "true" ]; then
    echo "🔨 Force rebuilding without cache..."
    sudo docker build --no-cache \
        --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
        --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
        --build-arg VITE_REMOTION_SERVICE_URL="${VITE_REMOTION_SERVICE_URL:-https://purpleai.duckdns.org/remotion-api}" \
        -t videoflow:latest .
else
    sudo docker build \
        --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
        --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
        --build-arg VITE_REMOTION_SERVICE_URL="${VITE_REMOTION_SERVICE_URL:-https://purpleai.duckdns.org/remotion-api}" \
        -t videoflow:latest .
fi

echo "🛑 Stopping existing container (if any)..."
sudo docker stop videoflow 2>/dev/null || true
sudo docker rm videoflow 2>/dev/null || true

echo "▶️  Starting new container..."
sudo docker run -d \
    --name videoflow \
    -p 127.0.0.1:8080:80 \
    --restart unless-stopped \
    videoflow:latest

echo "🧹 Cleaning up old images..."
sudo docker image prune -f

# Configuration automatique nginx + Docker
if [ -f fix-nginx-docker.sh ]; then
    echo ""
    echo -e "${YELLOW}🔧 Configuration automatique nginx + Docker...${NC}"
    chmod +x fix-nginx-docker.sh
    ./fix-nginx-docker.sh || echo -e "${YELLOW}⚠️  Configuration automatique échouée, vérifiez manuellement${NC}"
fi

# Configuration SSL automatique (si pas déjà configuré)
if [ -f setup-ssl-auto.sh ] && [ ! -f /etc/letsencrypt/live/purpleai.duckdns.org/fullchain.pem ]; then
    echo ""
    echo -e "${YELLOW}🔒 Configuration SSL automatique...${NC}"
    chmod +x setup-ssl-auto.sh
    ./setup-ssl-auto.sh || echo -e "${YELLOW}⚠️  Configuration SSL échouée, exécutez manuellement: ./setup-ssl-auto.sh${NC}"
fi

# Restart services with env reload (pm2 restart does NOT reload .env files)
# Uses --cwd so dotenv finds the .env in each service's own directory
restart_service() {
    local name=$1
    local script=$2
    local dir
    dir="$(dirname "$script")"
    if pm2 describe "$name" > /dev/null 2>&1; then
        pm2 delete "$name" 2>/dev/null
        pm2 start "$script" --name "$name" --cwd "$dir"
        echo -e "${GREEN}✅ $name restarted (env reloaded, cwd=$dir)${NC}"
    else
        echo -e "${YELLOW}⚠️  $name not found in PM2 (skipped)${NC}"
    fi
}

echo "🔄 Restarting services..."
restart_service "image-worker" "$HOME/purple/image-worker/index.js"
restart_service "pipeline-orchestrator" "$HOME/purple/pipeline-orchestrator/index.js"
restart_service "remotion-service" "$HOME/purple/remotion-service/server.js"

# CRM webmail (Python FastAPI) — delegated to its own idempotent installer
# so Python deps stay in sync with requirements.txt and .env is always
# re-read (pm2 restart would NOT re-read it).
if [ -d "$HOME/purple/crm" ] && [ -f "$HOME/purple/crm/setup-vps.sh" ]; then
    echo ""
    echo -e "${YELLOW}📬  (Re)starting CRM webmail (crm-webmail, port 8002)...${NC}"
    chmod +x "$HOME/purple/crm/setup-vps.sh"
    if (cd "$HOME/purple/crm" && ./setup-vps.sh); then
        echo -e "${GREEN}✅ crm-webmail up${NC}"
    else
        echo -e "${YELLOW}⚠️  crm-webmail setup failed — check crm/.env + run ~/purple/crm/setup-vps.sh manually${NC}"
    fi
fi

# Safety net: ensure nginx is up at the end of every deploy, even if a
# previous step failed silently. Otherwise the site is unreachable until
# someone notices.
if ! sudo systemctl is-active --quiet nginx; then
    echo -e "${YELLOW}⚠️  nginx is not active — starting it now${NC}"
    if sudo systemctl start nginx; then
        echo -e "${GREEN}✅ nginx started${NC}"
    else
        echo -e "${RED}❌ Failed to start nginx — site will be unreachable. Check 'sudo nginx -t' and 'sudo journalctl -u nginx -n 50'${NC}"
    fi
fi

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Your application should be available at: http://$(hostname -I | awk '{print $1}')"
if [ -f ~/.duckdns ]; then
    source ~/.duckdns 2>/dev/null || true
    if [ ! -z "$DUCKDNS_DOMAIN" ]; then
        echo "Or via DuckDNS: http://${DUCKDNS_DOMAIN}.duckdns.org"
    fi
fi
echo ""
echo "To view logs: sudo docker logs -f videoflow"
echo "To stop: sudo docker stop videoflow"
echo "To restart: sudo docker restart videoflow"
