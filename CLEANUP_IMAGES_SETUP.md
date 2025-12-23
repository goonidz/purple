# 🧹 Configuration du nettoyage automatique des images

La fonction Edge `cleanup-old-images` est déjà déployée et prête à être utilisée. Elle supprime automatiquement toutes les images générées de plus de 7 jours (sauf les miniatures).

## Méthodes disponibles

### ✅ Méthode 1 : Service externe gratuit (RECOMMANDÉ)

**cron-job.org** (gratuit, pas besoin de carte bancaire)

1. Va sur https://cron-job.org et crée un compte
2. Clique sur "Create cronjob"
3. Configure :
   - **Title**: `Cleanup Old Images VideoFlow`
   - **Address**: `https://laqgmqyjstisipsbljha.supabase.co/functions/v1/cleanup-old-images`
   - **Method**: `POST`
   - **Headers**: 
     ```
     Content-Type: application/json
     Authorization: Bearer [TA_CLÉ_SERVICE_ROLE]
     ```
   - **Schedule**: `Daily` à `02:00` UTC
4. Remplace `[TA_CLÉ_SERVICE_ROLE]` par ta clé depuis:
   - https://supabase.com/dashboard/project/laqgmqyjstisipsbljha/settings/api
   - Clé "service_role" (celle qui est secrète)

**Avantages**: Gratuit, simple, fiable, pas de configuration serveur

---

### Méthode 2 : Script local avec cron

Si tu as un serveur qui tourne 24/7:

```bash
# Ajoute à ton crontab
0 2 * * * cd /path/to/project && node scripts/cleanup-old-images.js
```

N'oublie pas d'ajouter `SUPABASE_SERVICE_ROLE_KEY` dans ton `.env`.

---

### Méthode 3 : Appel manuel

Pour tester ou nettoyer manuellement:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [TA_CLÉ_SERVICE_ROLE]" \
  https://laqgmqyjstisipsbljha.supabase.co/functions/v1/cleanup-old-images
```

---

### Méthode 4 : Via l'interface Supabase (si disponible)

Certains plans Supabase permettent de configurer des webhooks ou des tâches planifiées directement depuis le dashboard.

---

## Test de la fonction

Pour vérifier que tout fonctionne:

```bash
# Récupère ta clé service role
SERVICE_KEY="ta_clé_ici"

# Appelle la fonction
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  https://laqgmqyjstisipsbljha.supabase.co/functions/v1/cleanup-old-images
```

Tu devrais recevoir une réponse JSON avec le nombre d'images supprimées.

---

## Notes importantes

- ⚠️ Les **miniatures** (fichiers contenant `thumb_v`) ne sont **jamais supprimées**
- ⚠️ Seules les images de **plus de 7 jours** sont supprimées
- ✅ Le nettoyage est **sécurisé** (nécessite la clé service role)
- ✅ Fonctionne de manière **récursive** dans tous les dossiers
