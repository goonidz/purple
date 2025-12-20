# Configuration DuckDNS - Guide étape par étape

## Étape 1 : Créer le compte DuckDNS

1. Allez sur https://www.duckdns.org
2. Cliquez sur "Sign in" et connectez-vous avec GitHub ou Google
3. Une fois connecté, vous verrez votre tableau de bord
4. Dans le champ "Domain", entrez le nom de votre sous-domaine (ex: `videoflow`)
5. Cliquez sur "add domain"
6. **Important** : Notez votre **Token** affiché en haut de la page (vous en aurez besoin)

Votre domaine sera : `videoflow.duckdns.org` (remplacez `videoflow` par le nom que vous avez choisi)

## Étape 2 : Configurer sur le VPS

Une fois le compte créé, suivez les instructions dans `DEPLOYMENT.md` pour configurer le script de mise à jour automatique.
