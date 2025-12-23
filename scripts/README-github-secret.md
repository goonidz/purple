# Ajouter le secret SUPABASE_SERVICE_ROLE_KEY à GitHub

## Méthode 1 : Via l'interface web GitHub (Recommandé)

1. Va sur: https://github.com/goonidz/purple/settings/secrets/actions
2. Clique sur "New repository secret"
3. Nom: `SUPABASE_SERVICE_ROLE_KEY`
4. Valeur: Récupère la clé depuis https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api
   - Cherche la section "Project API keys"
   - Copie la clé "service_role" (celle qui est secrète, pas "anon" ou "public")
5. Clique sur "Add secret"

## Méthode 2 : Via le script automatique

1. Crée un token GitHub:
   - Va sur: https://github.com/settings/tokens
   - Clique sur "Generate new token (classic)"
   - Sélectionne les scopes: `repo`, `workflow`
   - Copie le token

2. Exécute le script:
```bash
GITHUB_TOKEN=ton_token_github SUPABASE_SERVICE_ROLE_KEY=ta_cle_supabase node scripts/add-github-secret.js
```

Ou ajoute les variables dans `.env`:
```env
GITHUB_TOKEN=ton_token_github
SUPABASE_SERVICE_ROLE_KEY=ta_cle_supabase
```

Puis exécute:
```bash
node scripts/add-github-secret.js
```
