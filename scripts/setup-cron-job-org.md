# Configuration automatique du nettoyage avec cron-job.org (GRATUIT)

## Étape 1 : Créer un compte sur cron-job.org

1. Va sur https://cron-job.org
2. Crée un compte gratuit (pas besoin de carte bancaire)
3. Connecte-toi

## Étape 2 : Créer un nouveau cron job

1. Clique sur "Create cronjob"
2. Configure comme suit :
   - **Title**: `Cleanup Old Images VideoFlow`
   - **Address**: `https://laqgmqyjstisipsbljha.supabase.co/functions/v1/cleanup-old-images`
   - **Request Method**: `POST`
   - **Request Headers**: 
     ```
     Content-Type: application/json
     Authorization: Bearer [TA_CLÉ_SERVICE_ROLE]
     ```
   - **Schedule**: `Daily` à `02:00` (2h du matin UTC)
   - **Activate**: ✅ Coché

3. Remplace `[TA_CLÉ_SERVICE_ROLE]` par ta clé service role de Supabase :
   - Va sur: https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api
   - Copie la clé "service_role" (celle qui est secrète)

4. Clique sur "Create"

## Résultat

Le nettoyage s'exécutera automatiquement tous les jours à 2h du matin UTC, sans aucune configuration supplémentaire !
