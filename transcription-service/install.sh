#!/bin/bash

echo "🎤 Installation du service de transcription Whisper"
echo "=================================================="

# Check if running as root
if [ "$EUID" -eq 0 ]; then
  echo "❌ Ne pas exécuter en tant que root"
  exit 1
fi

# Update system
echo ""
echo "📦 Mise à jour du système..."
sudo apt update && sudo apt upgrade -y

# Install Python and pip
echo ""
echo "🐍 Installation de Python..."
sudo apt install -y python3 python3-pip python3-venv

# Install FFmpeg
echo ""
echo "🎬 Installation de FFmpeg..."
sudo apt install -y ffmpeg

# Install Node.js if not present
if ! command -v node &> /dev/null; then
  echo ""
  echo "📦 Installation de Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

# Install PM2 globally
echo ""
echo "📦 Installation de PM2..."
sudo npm install -g pm2

# Create Python virtual environment
echo ""
echo "🐍 Création de l'environnement virtuel Python..."
python3 -m venv venv
source venv/bin/activate

# Install Whisper
echo ""
echo "🎤 Installation d'OpenAI Whisper..."
pip install --upgrade pip
pip install openai-whisper

# Install faster-whisper (optional, faster alternative)
echo ""
echo "⚡ Installation de faster-whisper..."
pip install faster-whisper

# Install Node dependencies
echo ""
echo "📦 Installation des dépendances Node.js..."
npm install

# Create .env file if not exists
if [ ! -f .env ]; then
  echo ""
  echo "📝 Création du fichier .env..."
  cat > .env << EOF
PORT=3001
# Whisper model: tiny, base, small, medium, large, large-v2, large-v3
WHISPER_MODEL=medium
EOF
fi

# Configure firewall
echo ""
echo "🔥 Configuration du firewall..."
sudo ufw allow 3001/tcp

echo ""
echo "✅ Installation terminée !"
echo ""
echo "📝 Pour démarrer le service:"
echo "   source venv/bin/activate"
echo "   npm run pm2:start"
echo ""
echo "📝 Pour voir les logs:"
echo "   npm run pm2:logs"
echo ""
echo "📝 Pour tester:"
echo "   curl http://localhost:3001/health"
