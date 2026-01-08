# Extension Chrome VideoFlow Calendar

Extension Chrome pour ajouter rapidement des vidéos YouTube à votre calendrier VideoFlow.

## 📋 Fonctionnalités

- **Clic droit sur n'importe quelle URL YouTube** pour l'ajouter au calendrier
- **Formulaire simple** : sélection de chaîne et date
- **Authentification persistante** : restez connecté
- **Notifications** de succès

## 🚀 Installation

### 1. Configuration

Éditez `config.js` et remplacez les valeurs par défaut :

```javascript
const CONFIG = {
  SUPABASE_URL: 'https://VOTRE_PROJET.supabase.co',
  SUPABASE_ANON_KEY: 'votre_clé_anon_publique',
  CALENDAR_URL: 'https://votre-url.com/calendar'
};
```

Vous pouvez trouver ces valeurs dans votre projet Supabase :
- Dashboard → Settings → API → Project URL et anon/public key

### 2. Créer l'icône PNG

L'extension nécessite une icône PNG de 48x48 pixels.

**Option A : Convertir le SVG**

Si vous avez Python installé :

```bash
pip install cairosvg
python3 -c "import cairosvg; cairosvg.svg2png(url='icons/icon.svg', write_to='icons/icon48.png', output_width=48, output_height=48)"
```

**Option B : Utiliser un outil en ligne**

1. Ouvrir `icons/icon.svg` dans un éditeur
2. Aller sur https://convertio.co/svg-png/
3. Convertir en PNG 48x48
4. Sauvegarder comme `icons/icon48.png`

**Option C : Créer manuellement**

Créez une image PNG 48x48 de votre choix et placez-la dans `icons/icon48.png`

### 3. Charger l'extension dans Chrome

1. Ouvrir Chrome et aller sur `chrome://extensions/`
2. Activer le **Mode développeur** (coin supérieur droit)
3. Cliquer sur **Charger l'extension non empaquetée**
4. Sélectionner le dossier `chrome-extension/`
5. ✅ L'extension est installée !

### 4. Première connexion

1. Cliquer sur l'icône de l'extension dans la barre d'outils
2. Se connecter avec vos identifiants VideoFlow
3. La session reste active jusqu'à déconnexion

## 💡 Utilisation

### Ajouter une vidéo au calendrier

1. Sur YouTube ou n'importe quelle page contenant un lien YouTube
2. **Clic droit** sur le lien ou sur la page
3. Sélectionner **"Ajouter au calendrier VideoFlow"**
4. Choisir la chaîne et la date
5. Cliquer sur **"Ajouter"**

### Formats d'URL supportés

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`

## 🔧 Structure des fichiers

```
chrome-extension/
├── manifest.json        # Configuration de l'extension
├── background.js        # Service worker (menu contextuel)
├── popup.html           # Interface du popup
├── popup.js             # Logique du popup
├── popup.css            # Styles
├── config.js            # Configuration Supabase
└── icons/
    ├── icon.svg         # Icône source (SVG)
    └── icon48.png       # Icône 48x48 (à générer)
```

## 🐛 Debugging

Pour voir les logs de l'extension :

1. **Service Worker (background.js)** :
   - `chrome://extensions/` → Cliquer sur "Service worker" sous votre extension
   
2. **Popup (popup.js)** :
   - Clic droit sur l'icône de l'extension → "Inspecter le popup"

Tous les logs sont préfixés par `[VideoFlow]`

## 🔒 Sécurité

- Les identifiants sont stockés de manière sécurisée via `chrome.storage.local`
- La connexion utilise l'authentification Supabase standard
- Seules les permissions nécessaires sont demandées

## 📝 Notes

- L'extension nécessite Chrome 88+ (Manifest V3)
- Les sessions persistent automatiquement
- Le dark mode est supporté
