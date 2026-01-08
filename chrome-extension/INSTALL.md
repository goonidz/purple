# 🚀 Installation Rapide - Extension VideoFlow

## Étape 1 : Configuration

```bash
cd chrome-extension
cp config.template.js config.js
```

Éditez `config.js` avec vos vraies valeurs Supabase.

## Étape 2 : Générer l'icône

**Option facile (Python) :**
```bash
pip install cairosvg
python3 generate-icon.py
```

**Option manuelle :**
- Créez une image PNG 48x48 et placez-la dans `icons/icon48.png`

## Étape 3 : Charger dans Chrome

1. Ouvrir Chrome → `chrome://extensions/`
2. Activer **Mode développeur** (coin supérieur droit)
3. Cliquer **Charger l'extension non empaquetée**
4. Sélectionner le dossier `chrome-extension/`

## Étape 4 : Connexion

1. Cliquer sur l'icône de l'extension
2. Se connecter avec vos identifiants
3. ✅ C'est prêt !

## 🎯 Utilisation

**Clic droit** sur n'importe quel lien YouTube → **"Ajouter au calendrier VideoFlow"**

---

📖 Plus de détails dans [README.md](README.md)
