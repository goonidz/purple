# 🧹 Nettoyage automatique des images générées

## Vue d'ensemble

Le système de nettoyage automatique supprime les images générées de plus de **7 jours** du bucket Supabase `generated-images`. Les **miniatures** (fichiers contenant `thumb_v`) sont **toujours préservées**.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Serveur VPS (ubuntu@51.91.158.233)                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Cron Job (tous les jours à 2h UTC)                 │   │
│  │  → node scripts/cleanup-supabase-images.js          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Appel HTTPS avec clé service_role                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: cleanup-old-images                 │
│                                                             │
│  1. Vérifie l'authentification (service_role JWT)           │
│  2. Liste tous les fichiers du bucket generated-images      │
│  3. Filtre: > 7 jours ET pas une miniature (thumb_v)        │
│  4. Supprime par lots de 50 fichiers                        │
│  5. Retourne le nombre de fichiers supprimés                │
└─────────────────────────────────────────────────────────────┘
```

## Fichiers impliqués

| Fichier | Description |
|---------|-------------|
| `supabase/functions/cleanup-old-images/index.ts` | Edge Function qui effectue le nettoyage |
| `scripts/cleanup-supabase-images.js` | Script Node.js pour appeler l'Edge Function |
| `scripts/setup-cleanup-cron.sh` | Script pour configurer le cron job sur le serveur |
| `scripts/add-service-role-key.sh` | Script pour ajouter la clé service_role dans .env.production |
| `scripts/check-storage-images.js` | Script de diagnostic pour voir le contenu du bucket |

## Configuration sur le serveur VPS

### 1. Ajouter la clé service_role

```bash
cd ~/purple
./scripts/add-service-role-key.sh
```

Cela ajoute `SUPABASE_SERVICE_ROLE_KEY` dans `.env.production`.

### 2. Configurer le cron job

```bash
./scripts/setup-cleanup-cron.sh
```

Cela ajoute automatiquement le cron job pour exécuter le nettoyage tous les jours à 2h UTC.

### 3. Vérifier la configuration

```bash
# Voir le cron job
crontab -l

# Tester manuellement
node scripts/cleanup-supabase-images.js

# Voir les logs
tail -f ~/purple/cleanup-images.log
```

## Diagnostic

Pour voir ce qu'il y a dans le bucket et comprendre ce qui sera supprimé :

```bash
node scripts/check-storage-images.js
```

Ce script affiche :
- Le contenu des dossiers du bucket
- L'âge de chaque fichier
- Quels fichiers seraient supprimés (> 7 jours, pas une miniature)

## Règles de suppression

| Type de fichier | Supprimé après 7 jours ? |
|-----------------|--------------------------|
| `scene_*.jpg` | ✅ Oui |
| `upscaled/*.jpg` | ✅ Oui |
| `*_image.jpg` | ✅ Oui |
| `thumb_v*.jpg` | ❌ Non (miniature protégée) |

## Edge Function

L'Edge Function `cleanup-old-images` :

1. **Authentification** : Vérifie que le token JWT fourni a le rôle `service_role`
2. **Parcours récursif** : Liste tous les dossiers et sous-dossiers du bucket
3. **Filtrage** : 
   - Exclut les fichiers contenant `thumb_v` (miniatures)
   - Sélectionne les fichiers créés il y a plus de 7 jours
4. **Suppression par lots** : Supprime 50 fichiers à la fois pour éviter les timeouts
5. **Retour** : Nombre de fichiers supprimés, erreurs, total traité

### Appel manuel de l'Edge Function

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [SUPABASE_SERVICE_ROLE_KEY]" \
  https://laqgmqyjstisipsbljha.supabase.co/functions/v1/cleanup-old-images
```

## Logs

Les logs sont stockés dans `~/purple/cleanup-images.log` sur le serveur :

```
[2025-12-23T02:00:00.000Z] 🧹 Démarrage du nettoyage des images Supabase...
[2025-12-23T02:00:01.234Z] ✅ Nettoyage terminé:
   - Images supprimées: 42
   - Erreurs: 0
   - Total traité: 42
```

## Modification des paramètres

### Changer la durée de rétention (actuellement 7 jours)

Dans `supabase/functions/cleanup-old-images/index.ts`, modifier :

```typescript
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7); // Changer 7 par le nombre de jours souhaité
```

Puis redéployer :

```bash
supabase functions deploy cleanup-old-images --project-ref laqgmqyjstisipsbljha --no-verify-jwt
```

### Changer l'heure d'exécution

Modifier le cron job :

```bash
crontab -e
```

Format cron : `minute heure jour mois jour_semaine`
- `0 2 * * *` = tous les jours à 2h00 UTC
- `0 3 * * *` = tous les jours à 3h00 UTC
- `0 */6 * * *` = toutes les 6 heures

## Dépannage

### Erreur 401 Unauthorized

Vérifier que la clé service_role est correcte :
```bash
grep SUPABASE_SERVICE_ROLE_KEY .env.production
```

La clé doit commencer par `eyJhbGciOiJIUzI1NiIs...` et faire ~220 caractères.

### Rien n'est supprimé

1. Vérifier qu'il y a des images de plus de 7 jours :
   ```bash
   node scripts/check-storage-images.js
   ```

2. Vérifier que les fichiers ne sont pas des miniatures (pas de `thumb_v` dans le nom)

### Le cron ne s'exécute pas

1. Vérifier que le cron est configuré :
   ```bash
   crontab -l
   ```

2. Vérifier les logs système :
   ```bash
   grep CRON /var/log/syslog | tail -20
   ```

## Historique

- **2025-12-23** : Mise en place du système de nettoyage automatique
  - Création de l'Edge Function `cleanup-old-images`
  - Scripts de configuration pour le serveur VPS
  - Configuration du cron job quotidien
