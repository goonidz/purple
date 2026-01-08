# Migration : Channel Presets Associations

## Fichier de Migration

`20260108_add_channel_preset_associations.sql`

## Description

Cette migration ajoute la possibilité d'associer des presets par défaut à chaque chaîne YouTube. Les colonnes suivantes sont ajoutées à la table `channels` :

- `script_preset_id` : Référence vers un preset de script
- `tts_preset_id` : Référence vers un preset TTS (voix)
- `project_preset_id` : Référence vers un preset de projet
- `thumbnail_preset_id` : Référence vers un preset de miniatures
- `thumbnail_preset_enabled` : Booléen pour activer/désactiver le preset miniatures

## Comment Appliquer la Migration

### Option 1 : Via Supabase CLI (Recommandé)

```bash
# Se connecter à votre projet Supabase
supabase link --project-ref your-project-ref

# Appliquer toutes les migrations en attente
supabase db push
```

### Option 2 : Via Supabase Dashboard

1. Connectez-vous à [Supabase Dashboard](https://app.supabase.com)
2. Sélectionnez votre projet
3. Allez dans **SQL Editor**
4. Créez une nouvelle requête
5. Copiez le contenu du fichier `20260108_add_channel_preset_associations.sql`
6. Exécutez la requête

### Option 3 : En Local avec Supabase Local Development

```bash
# Démarrer Supabase localement
supabase start

# Appliquer les migrations
supabase db reset

# Ou pour appliquer uniquement les nouvelles migrations
supabase migration up
```

## Vérification Post-Migration

### 1. Vérifier que les colonnes ont été ajoutées

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'channels'
AND column_name IN (
  'script_preset_id',
  'tts_preset_id',
  'project_preset_id',
  'thumbnail_preset_id',
  'thumbnail_preset_enabled'
);
```

Résultat attendu :
```
column_name              | data_type | is_nullable
-------------------------+-----------+-------------
script_preset_id         | uuid      | YES
tts_preset_id            | uuid      | YES
project_preset_id        | uuid      | YES
thumbnail_preset_id      | uuid      | YES
thumbnail_preset_enabled | boolean   | YES
```

### 2. Vérifier les foreign keys

```sql
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_name = 'channels';
```

Résultat attendu : 4 foreign keys vers les tables de presets

### 3. Tester l'insertion

```sql
-- Exemple de mise à jour d'une chaîne avec des presets
UPDATE channels
SET
  script_preset_id = (SELECT id FROM script_presets LIMIT 1),
  tts_preset_id = (SELECT id FROM tts_presets LIMIT 1),
  project_preset_id = (SELECT id FROM presets LIMIT 1),
  thumbnail_preset_id = (SELECT id FROM thumbnail_presets LIMIT 1),
  thumbnail_preset_enabled = true
WHERE id = 'your-channel-id';

-- Vérifier
SELECT * FROM channels WHERE id = 'your-channel-id';
```

## Rollback (Annulation de la Migration)

Si vous devez annuler cette migration :

```sql
-- Supprimer les colonnes ajoutées
ALTER TABLE channels
  DROP COLUMN IF EXISTS script_preset_id,
  DROP COLUMN IF EXISTS tts_preset_id,
  DROP COLUMN IF EXISTS project_preset_id,
  DROP COLUMN IF EXISTS thumbnail_preset_id,
  DROP COLUMN IF EXISTS thumbnail_preset_enabled;
```

⚠️ **Attention** : Cette opération supprimera toutes les associations preset-chaîne configurées.

## Impact sur les Données Existantes

- ✅ **Aucune donnée perdue** : La migration n'affecte pas les données existantes
- ✅ **Compatibilité ascendante** : Les chaînes existantes continuent de fonctionner normalement
- ✅ **Valeurs par défaut** : Toutes les nouvelles colonnes acceptent NULL
- ✅ **Pas de downtime** : La migration peut être appliquée sans interruption de service

## Dépendances

Cette migration nécessite que les tables suivantes existent :

- ✅ `channels` (déjà existante)
- ✅ `script_presets` (déjà existante)
- ✅ `tts_presets` (déjà existante)
- ✅ `presets` (déjà existante)
- ✅ `thumbnail_presets` (déjà existante)

## Prochaines Étapes

Après avoir appliqué la migration :

1. ✅ Redémarrer l'application pour charger les nouveaux types TypeScript
2. ✅ Tester la configuration des presets dans le gestionnaire de chaînes
3. ✅ Vérifier que les presets sont auto-chargés lors du lancement depuis le calendrier
4. ✅ Consulter la documentation complète dans `docs/CHANNEL_PRESETS.md`

## Support

Pour toute question ou problème avec cette migration :

1. Consultez le fichier `CHANNEL_PRESETS_IMPLEMENTATION.md` pour les détails techniques
2. Vérifiez les logs Supabase pour les erreurs de migration
3. Consultez la documentation Supabase : https://supabase.com/docs/guides/database/migrations
