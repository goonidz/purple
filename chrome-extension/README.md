# Extension Chrome VideoFlow Calendar

Extension Chrome pour ajouter rapidement des videos YouTube a votre calendrier VideoFlow.

## Fonctionnalites

- Clic droit sur n'importe quelle URL YouTube pour l'ajouter au calendrier
- Formulaire simple : selection de chaine et date
- Authentification centralisee via VideoFlow
- Notifications de succes
- **Aucune configuration requise**

## Installation

### 1. Generer l'icone

```bash
cd chrome-extension
python3 create-icon-base64.py
```

### 2. Charger l'extension dans Chrome

1. Ouvrir `chrome://extensions/`
2. Activer **Mode developpeur**
3. Cliquer **Charger l'extension non empaquetee**
4. Selectionner le dossier `chrome-extension/`

### 3. Se connecter

1. Cliquer sur l'icone de l'extension
2. Cliquer "Se connecter"
3. Se connecter sur la page VideoFlow qui s'ouvre
4. Revenir a l'extension et cliquer "J'ai termine la connexion"

## Utilisation

1. Clic droit sur un lien YouTube
2. Selectionner "Ajouter au calendrier VideoFlow"
3. Choisir la chaine et la date
4. Cliquer "Ajouter"

## Architecture

```
Extension Chrome → Edge Functions Supabase → Database
```

L'extension utilise 2 Edge Functions :
- `add-calendar-entry` : Ajoute une video au calendrier
- `get-user-channels` : Recupere les chaines de l'utilisateur

## Avantages

- Aucune configuration utilisateur requise
- Multi-utilisateurs : Fonctionne pour tous
- Securise : Authentification via token
- Pret pour Chrome Web Store

## Debugging

- Service Worker : `chrome://extensions/` → "Service worker"
- Popup : Clic droit sur l'icone → "Inspecter le popup"

Logs prefixes par `[VideoFlow]`
