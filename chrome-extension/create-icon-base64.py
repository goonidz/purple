#!/usr/bin/env python3
"""
Crée une icône PNG 48x48 simple à partir de données base64.
Utilise uniquement la bibliothèque standard Python (pas de dépendances).
"""

import base64
import os

# PNG 48x48 simple avec un calendrier bleu et un signe +
# Créé avec: un rectangle bleu, un calendrier blanc simplifié
PNG_BASE64 = """
iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAC
UklEQVR4nO2ZS2sUQRSFv+lJJolGo4iKigsRfIDgQkREUdGFL0T8AW5cuBBcuHDjH3Dtz3DhRnDh
QheCIIiCqKCiGBVfqIlG80imp6u7uqd6ZqYnk0xPT3fPnAsFxVR1nXvuqXvr3luQ0D8twDxwCXgM
fAY6QBv4BrwA7gAXgRlgMMm3P2gCl4GXQJeeoQ18Bh4BF4BakvN/YAK4DnyjGO3oAA+B80A1yf8H
JoFb+Es7OsBDYAmYSPIfAgaBZeAJ0MJ/2tEG7gNngXqS/wCMAcvAU/ylEx3gHnAGqCX5D8IwsBJ4
wGd6hk50gLvAaaCS5D8IE8BD+kM7OsBd4BRQTvIfhEHgcQAPaBm5p4ETQCnJfxBGgJUC+Ps10Qbu
AEvAcJL/IIwCjwLg/9tEC7gNHAeGkvwHoQE8CoT/XxMt4BZwFBhM8h+EOvA4IP5/TbSAG8BhYCDJ
fxDqwOOA+P810QJuAIeBepJ/ETSAJwHz72+iBVwHDgH1JP8iaARE3zagBdwAFoFakn8RNIAn0fDv
b6IF3AQOAtUk/yJoAE+j4d/fRAu4DiwA1ST/ImgAT6Ph399EC7gOzAPVJP8iaARE+2+jBVwH5oCB
JP9BqAFPo+XfbqIFXAPmgEqSfxE0gGeR8P/TRAu4CswC5ST/QagBz6Ph/6eJFnAVmAXKSf5FUAee
R8u/v4kWcBWYAUpJ/oNQB55Hw/9PE1eAaaCS5F8E9YD4fzbxBZgCykn+g1ADXkTL/08TX4ApoJTk
XwQ14EW0/P808QWYBEpJ/oNQBV5Gy/+fJr4Ak0CiRP8AKNMRHfGiUz4AAAAASUVORK5CYII=
"""

# Décode et sauvegarde
output_path = os.path.join(os.path.dirname(__file__), 'icons', 'icon48.png')
os.makedirs(os.path.dirname(output_path), exist_ok=True)

png_data = base64.b64decode(PNG_BASE64.strip())

with open(output_path, 'wb') as f:
    f.write(png_data)

print(f"✅ Icône créée: {output_path}")
print(f"📏 Taille: 48x48 pixels")
