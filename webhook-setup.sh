#!/bin/bash

# Setup script for GitHub webhook auto-deployment

set -e

echo "🚀 Setting up GitHub webhook auto-deployment..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Generate a random secret
SECRET=$(openssl rand -hex 32)

echo -e "${YELLOW}📝 Configuration:${NC}"
echo "   Repository path: $(pwd)"
echo "   Webhook secret: $SECRET"
echo ""

# Create .env file for webhook
cat > .env.webhook << EOF
WEBHOOK_PORT=9000
WEBHOOK_SECRET=$SECRET
REPO_PATH=$(pwd)
EOF

echo -e "${GREEN}✅ Created .env.webhook file${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo ""
echo "1. Install Node.js if not already installed:"
echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
echo "   sudo apt-get install -y nodejs"
echo ""
echo "2. Install PM2 (process manager):"
echo "   sudo npm install -g pm2"
echo ""
echo "3. Start the webhook server:"
echo "   pm2 start webhook-server.js --name webhook-deploy"
echo "   pm2 save"
echo ""
echo "4. Configure firewall (if needed):"
echo "   sudo ufw allow 9000/tcp"
echo ""
echo "5. Configure GitHub webhook:"
echo "   - Go to: https://github.com/goonidz/purple/settings/hooks"
echo "   - Click 'Add webhook'"
echo "   - Payload URL: http://51.91.158.233:9000/webhook"
echo "   - Content type: application/json"
echo "   - Secret: $SECRET"
echo "   - Events: Just the push event"
echo "   - Click 'Add webhook'"
echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
