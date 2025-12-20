# VideoFlow - Créateur de Vidéos IA
SSL auto-configuration with Let's Encrypt

Application web complète pour créer des vidéos professionnelles avec l'IA.

## Fonctionnalités

- **Génération automatique** : Scripts, audio, images générés avec l'IA
- **Rendu vidéo** : Service FFmpeg sur VPS pour le montage vidéo
- **Déploiement automatique** : Webhook GitHub pour mise à jour automatique
- **Nom de domaine gratuit** : Configuration DuckDNS pour accès via domaine

## Déploiement

Le projet est déployé sur un VPS Linux avec :
- **Frontend** : Docker container avec nginx (port 80)
- **Service de rendu vidéo** : Node.js + FFmpeg (port 3000)
- **Domaine** : `purpleai.duckdns.org` (gratuit via DuckDNS)
- **Déploiement automatique** : Webhook GitHub pour mise à jour auto

Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour les instructions complètes de déploiement.

## Project info

**URL**: https://lovable.dev/projects/8cded4cb-3d04-432b-bf85-907e8f5b4eeb

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/8cded4cb-3d04-432b-bf85-907e8f5b4eeb) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/8cded4cb-3d04-432b-bf85-907e8f5b4eeb) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
