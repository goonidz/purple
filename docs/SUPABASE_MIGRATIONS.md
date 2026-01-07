# Appliquer des migrations Supabase via l'API Management

Quand `supabase db push` ne fonctionne pas (problèmes de synchronisation des migrations locales/distantes), on peut appliquer les migrations directement via l'API Management de Supabase.

## Prérequis

- `SUPABASE_ACCESS_TOKEN` dans le fichier `.env`
- `VITE_SUPABASE_URL` dans le fichier `.env`

## Méthode 1 : Script Node.js (recommandé)

### Structure du script

Créer un fichier dans `scripts/` avec le nom `apply-<nom-migration>.cjs` :

```javascript
require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'laqgmqyjstisipsbljha';

async function applyMigration() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  console.log('🔍 Checking environment variables...');
  console.log('   SUPABASE_URL:', supabaseUrl ? '✅ Found' : '❌ Missing');
  console.log('   ACCESS_TOKEN:', accessToken ? '✅ Found' : '❌ Missing');

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env');
    process.exit(1);
  }

  if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL not found in .env');
    process.exit(1);
  }

  console.log('🚀 Applying migration via Supabase Management API...');
  console.log(`   Project: ${PROJECT_REF}`);
  
  // ⬇️ MODIFIER CETTE REQUÊTE SQL ⬇️
  const sqlQuery = 'ALTER TABLE public.ma_table ADD COLUMN IF NOT EXISTS ma_colonne TEXT DEFAULT NULL;';
  
  const postData = JSON.stringify({
    query: sqlQuery
  });

  const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/database/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log('✅ Migration applied successfully!');
          console.log('   Response:', data);
          resolve();
        } else {
          console.error(`❌ Management API error: ${res.statusCode}`);
          console.error('   Response:', data);
          
          // Check if error is because column already exists
          if (data.includes('already exists') || data.includes('duplicate')) {
            console.log('✅ Column already exists (this is OK)');
            resolve();
          } else {
            reject(new Error(`API returned ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

applyMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### Exécution

```bash
node scripts/apply-<nom-migration>.cjs
```

## Méthode 2 : Commande cURL (rapide)

```bash
curl -X POST "https://api.supabase.com/v1/projects/laqgmqyjstisipsbljha/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "ALTER TABLE public.ma_table ADD COLUMN IF NOT EXISTS ma_colonne TEXT DEFAULT NULL;"}'
```

## Exemples de migrations courantes

### Ajouter une colonne TEXT

```sql
ALTER TABLE public.content_calendar ADD COLUMN IF NOT EXISTS source_transcript TEXT DEFAULT NULL;
```

### Ajouter une colonne BOOLEAN

```sql
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS visual_continuity_enabled BOOLEAN DEFAULT false;
```

### Ajouter une colonne avec contrainte NOT NULL

```sql
ALTER TABLE public.ma_table ADD COLUMN IF NOT EXISTS ma_colonne VARCHAR(255) NOT NULL DEFAULT '';
```

## Scripts existants

- `scripts/apply-visual-continuity-migration.cjs` - Ajoute `visual_continuity_enabled` à `projects`
- `scripts/apply-source-transcript-migration.cjs` - Ajoute `source_transcript` à `content_calendar`

## Notes importantes

1. **Toujours créer le fichier de migration SQL** dans `supabase/migrations/` même si on l'applique via l'API
2. **Utiliser `IF NOT EXISTS`** pour éviter les erreurs si la migration est rejouée
3. **Mettre à jour les types TypeScript** dans `src/integrations/supabase/types.ts`
4. **PROJECT_REF** = `laqgmqyjstisipsbljha` (identifiant du projet Supabase)
