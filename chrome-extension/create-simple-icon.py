#!/usr/bin/env python3
"""
Crée une icône PNG simple pour l'extension sans dépendances externes.
"""

from PIL import Image, ImageDraw
import os

# Create a 48x48 image
size = 48
img = Image.new('RGB', (size, size), color='#3B82F6')  # Blue background

# Create a draw object
draw = ImageDraw.Draw(img)

# Draw a simple calendar shape (white rectangle with blue header)
# Calendar body
draw.rectangle([10, 12, 38, 40], fill='white', outline='white')

# Calendar header (darker blue)
draw.rectangle([10, 12, 38, 18], fill='#1D4ED8', outline='#1D4ED8')

# Calendar grid lines
draw.line([14, 22, 34, 22], fill='#3B82F6', width=1)
draw.line([14, 26, 34, 26], fill='#3B82F6', width=1)
draw.line([14, 30, 34, 30], fill='#3B82F6', width=1)
draw.line([18, 18, 18, 38], fill='#3B82F6', width=1)
draw.line([24, 18, 24, 38], fill='#3B82F6', width=1)
draw.line([30, 18, 30, 38], fill='#3B82F6', width=1)

# Plus sign (green circle with white +)
draw.ellipse([30, 30, 42, 42], fill='#10B981', outline='#10B981')
draw.line([36, 33, 36, 39], fill='white', width=2)
draw.line([33, 36, 39, 36], fill='white', width=2)

# Save
output_path = os.path.join(os.path.dirname(__file__), 'icons', 'icon48.png')
os.makedirs(os.path.dirname(output_path), exist_ok=True)
img.save(output_path, 'PNG')

print(f"✅ Icône créée: {output_path}")
