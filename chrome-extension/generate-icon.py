#!/usr/bin/env python3
"""
Script pour générer l'icône PNG de l'extension à partir du SVG.

Usage:
    python3 generate-icon.py

Requirements:
    pip install cairosvg
"""

import os
import sys

try:
    import cairosvg
except ImportError:
    print("❌ cairosvg n'est pas installé.")
    print("📦 Installation: pip install cairosvg")
    sys.exit(1)

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SVG_PATH = os.path.join(SCRIPT_DIR, 'icons', 'icon.svg')
PNG_PATH = os.path.join(SCRIPT_DIR, 'icons', 'icon48.png')

# Check if SVG exists
if not os.path.exists(SVG_PATH):
    print(f"❌ Fichier SVG non trouvé: {SVG_PATH}")
    sys.exit(1)

# Create icons directory if it doesn't exist
os.makedirs(os.path.dirname(PNG_PATH), exist_ok=True)

# Convert SVG to PNG
print(f"🎨 Conversion de {SVG_PATH} → {PNG_PATH}")
try:
    cairosvg.svg2png(
        url=SVG_PATH,
        write_to=PNG_PATH,
        output_width=48,
        output_height=48
    )
    print(f"✅ Icône créée avec succès: {PNG_PATH}")
    print(f"📏 Taille: 48x48 pixels")
except Exception as e:
    print(f"❌ Erreur lors de la conversion: {e}")
    sys.exit(1)
