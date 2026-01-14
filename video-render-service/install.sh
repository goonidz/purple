#!/bin/bash

# Installation script for video-render-service on Ubuntu VPS

echo "🚀 Installing Video Render Service..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ FFmpeg is not installed. Please install ffmpeg first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install Python dependencies for OpenCV zoom
echo "🐍 Installing Python dependencies..."
if command -v pip3 &> /dev/null; then
    pip3 install opencv-python-headless numpy
else
    echo "⚠️  pip3 not found. Please install python3-pip and then: pip3 install opencv-python-headless numpy"
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server Configuration
PORT=3000

# Optional: API Key for securing the service
API_KEY=
EOF
    echo "⚠️  Please edit .env file with your Supabase credentials"
fi

# Setup PM2
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 is installed"
else
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

# Setup firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 3000/tcp

echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your Supabase credentials"
echo "2. Start the service: npm run pm2:start"
echo "3. Check logs: npm run pm2:logs"
echo "4. Make service auto-start on boot: pm2 startup && pm2 save"









