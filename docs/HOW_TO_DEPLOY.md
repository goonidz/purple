# How to deploy (VideoFlow)

This repo has **five** deploy targets:

- **Frontend web app** (Docker + nginx on the VPS)
- **Supabase Edge Functions** (deployed to the Supabase project)
- **Image Worker (VPS)** (`image-worker/`, managed by PM2 — polls DB for image/prompt/thumbnail jobs)
- **Video Render Service (VPS)** (`video-render-service/`, managed by PM2 on port 3000)
- **Video Storage API (VPS)** (`video-storage-api/`, managed by PM2 on port 3001)

This doc is the **fast path** that matches the workflow we used successfully.

---

## 0) Prerequisites

### Local machine
- Git configured so `git push` works to GitHub (`origin`).
- Node.js installed (for `npx supabase`).
- Supabase CLI available via `npx supabase` (recommended).

### Tokens / secrets
- `SUPABASE_ACCESS_TOKEN` available locally (we keep it in `.env` in this repo).
- Supabase project ref: `laqgmqyjstisipsbljha`

### VPS access
- SSH access:

```bash
ssh ubuntu@51.91.158.233
```

---

## 1) Deploy code to GitHub (push)

From the repo root:

```bash
git status
git add -A
git commit -m "your message"
git push origin main
```

---

## 2) Deploy Supabase Database Migrations

### 2.1 Understanding Supabase Migrations

Supabase migrations are SQL files in `supabase/migrations/` that modify the database schema. They're **tricky** because:

1. The Supabase CLI tracks migration history in a remote table
2. If local and remote histories diverge, `supabase db push` will fail
3. Migrations marked as "applied" in history might not actually have been executed
4. The CLI doesn't provide a direct way to execute arbitrary SQL on the remote DB

### 2.2 The Working Process (Lessons Learned - Jan 2026)

When you need to apply a new migration (e.g., adding columns to a table):

#### Step 1: Create the migration file

Create a timestamped SQL file in `supabase/migrations/`:

```bash
# Format: YYYYMMDD_description.sql
# Example: 20260108_add_channel_preset_associations.sql
```

#### Step 2: Link your project

```bash
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d '=' -f2)
supabase link --project-ref laqgmqyjstisipsbljha
```

#### Step 3: Check migration status

```bash
supabase migration list
```

This shows which migrations are applied locally vs remotely.

#### Step 4: Handle migration history conflicts

**⚠️ CRITICAL**: If you see migrations out of order or marked as "applied" but not actually in the DB, you need to repair the history:

```bash
# Mark problematic migrations as "reverted" so they can be reapplied
supabase migration repair --status reverted 20260105
supabase migration repair --status reverted 20260108

# Now push with --include-all to apply all missing migrations
echo "Y" | supabase db push --include-all
```

#### Step 5: Verify the migration was actually applied

**Don't trust the migration history!** Verify with a direct query:

```bash
# Test via REST API (replace with your actual column names)
curl -s "https://laqgmqyjstisipsbljha.supabase.co/rest/v1/channels?select=id,script_preset_id&limit=1" \
  -H "apikey: sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY" \
  -H "Authorization: Bearer sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY"
```

- If you get `{"code": "42703", "message": "column ... does not exist"}` → **Migration failed**
- If you get `[]` or actual data → **Migration succeeded**

### 2.3 What Doesn't Work (Avoid These)

❌ **`supabase db push` without `--include-all`** - Fails if migrations are out of order

❌ **Direct psql connections** - Pooler credentials in `.env` are often incorrect/expired

❌ **Supabase Management API SQL endpoint** - Doesn't exist or requires different auth

❌ **Edge Functions with RPC exec()** - The `exec()` or `exec_sql()` RPC functions don't exist by default

❌ **Trusting migration history** - A migration can be marked "applied" but not actually executed

### 2.4 Emergency: Manual SQL Execution

If all else fails, use the Supabase Dashboard:

1. Go to [app.supabase.com](https://app.supabase.com)
2. Select your project (`laqgmqyjstisipsbljha`)
3. Go to **SQL Editor** in the left menu
4. Click **New Query**
5. Paste your migration SQL
6. Click **Run** (or Ctrl+Enter)
7. Then mark it as applied locally: `supabase migration repair --status applied 20260108`

### 2.5 Quick Reference

```bash
# Standard workflow (when everything is in sync)
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d '=' -f2)
supabase link --project-ref laqgmqyjstisipsbljha
supabase db push

# When migrations are out of sync
supabase migration list  # Check status
supabase migration repair --status reverted 20260108  # Unstick a migration
echo "Y" | supabase db push --include-all  # Force push all

# Verify a column exists
curl -s "https://laqgmqyjstisipsbljha.supabase.co/rest/v1/TABLE?select=NEW_COLUMN&limit=1" \
  -H "apikey: sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY" \
  -H "Authorization: Bearer sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY"
```

---

## 3) Deploy Supabase Edge Functions

### 3.1 Load `SUPABASE_ACCESS_TOKEN`

If you store it in `.env`:

```bash
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d '=' -f2)
```

### 3.2 Deploy a specific function

Example (what we deployed today):

```bash
npx supabase functions deploy generate-script --project-ref laqgmqyjstisipsbljha
```

Other functions can be deployed similarly:

```bash
npx supabase functions deploy <function-name> --project-ref laqgmqyjstisipsbljha
```

---

## 4) Deploy / restart services on the VPS

### 4.1 Image Worker (PM2)

The PM2 process name is `image-worker`. This service polls the `generation_jobs` table and processes `single_image`, `single_prompt`, and `thumbnails` jobs with 20 concurrent slots and fair round-robin across projects.

**Deploy from local machine** (no git pull needed — `index.js` is deployed via SCP):

```bash
scp -i ~/.ssh/id_ed25519_new image-worker/index.js ubuntu@51.91.158.233:~/purple/image-worker/index.js
ssh vps-clean "pm2 restart image-worker && pm2 logs image-worker --lines 10 --nostream"
```

**First-time setup on VPS:**

```bash
ssh vps-clean
cd ~/purple/image-worker
npm install
cp .env.example .env
nano .env  # Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
pm2 start index.js --name image-worker
pm2 save
```

**Check it's working:**

```bash
ssh vps-clean "pm2 logs image-worker --lines 20 --nostream"
# Should show: Image Worker started (MAX_CONCURRENT=20, POLL=3000ms)
```

### 4.2 Video render service (PM2)

The PM2 process name is `video-render-service`.

Fast path (pull latest + restart + show logs):

```bash
ssh ubuntu@51.91.158.233 "set -e; cd ~/purple; git pull origin main; pm2 restart video-render-service; pm2 logs video-render-service --lines 20 --nostream"
```

Health check on the VPS:

```bash
ssh ubuntu@51.91.158.233 "curl --max-time 3 -s http://localhost:3000/health"
```

### 4.3 Frontend (Docker + nginx)

If you use the webhook-based auto-deploy, pushing to `main` triggers it automatically.
If you need to do it manually on the VPS:

```bash
ssh ubuntu@51.91.158.233 "set -e; cd ~/purple; git pull origin main; ./deploy.sh"
```

### 4.4 Video Storage API (PM2)

**Pourquoi ?** Bypass les limites de Supabase Storage (50 MB par fichier, timeouts). Les vidéos GPU rendues peuvent facilement dépasser 100-500 MB.

**Ce que ça fait** : API Node.js qui reçoit les uploads vidéo depuis RunPod et les stocke dans `/var/www/rendered-videos/`, servis via nginx.

**Première installation** (à faire une seule fois) :

```bash
ssh ubuntu@51.91.158.233
cd ~/purple/video-storage-api

# Installer dépendances
npm install

# Générer token sécurisé
openssl rand -hex 32  # COPIE CE TOKEN !

# Créer .env
nano .env
# Coller :
# VIDEO_STORAGE_PORT=3001
# VIDEOS_DIR=/var/www/rendered-videos
# PUBLIC_URL_BASE=https://purpleai.duckdns.org/rendered-videos
# VIDEO_UPLOAD_TOKEN=<le-token-généré>

# Créer dossier de stockage
sudo mkdir -p /var/www/rendered-videos
sudo chown ubuntu:ubuntu /var/www/rendered-videos

# Démarrer le service
pm2 start server.js --name video-storage-api
pm2 save
```

**Configuration nginx** (déjà fait normalement) : Les locations `/api/upload-video` et `/rendered-videos/` doivent être dans `/etc/nginx/sites-available/purpleai`.

**Mise à jour après changements** :

```bash
ssh ubuntu@51.91.158.233 "set -e; cd ~/purple; git pull origin main; cd video-storage-api; pm2 restart video-storage-api; pm2 logs video-storage-api --lines 20 --nostream"
```

**Health check** :

```bash
ssh ubuntu@51.91.158.233 "curl -s http://localhost:3001/health"
# Devrait retourner : {"status":"ok","videosDir":"/var/www/rendered-videos",...}
```

**Test upload** (depuis ton Mac) :

```bash
curl -X POST https://purpleai.duckdns.org/api/upload-video
# Devrait retourner : {"error":"Unauthorized"}
```

**Configuration RunPod** : Ajoute ces variables d'env dans le Pod Template (voir `RUNPOD_POD_CONFIG.md`) :
```
VPS_UPLOAD_URL=https://purpleai.duckdns.org/api/upload-video
VPS_UPLOAD_TOKEN=<le-token-du-fichier-.env>
```

Voir `video-storage-api/DEPLOY.md` pour tous les détails.

---

## 5) Quick validation checklist

### Image Worker
- Logs show polling and no errors:

```bash
ssh vps-clean "pm2 logs image-worker --lines 5 --nostream"
```

### Supabase
- Open Supabase Dashboard → Functions → confirm `generate-script` shows a recent deploy.

### VPS render service
- Health returns JSON:

```bash
ssh ubuntu@51.91.158.233 "curl --max-time 3 -s http://localhost:3000/health"
```

### App smoke test
- Trigger a script generation from the UI and confirm the logs on the VPS show the expected model / thinking settings (if applicable).

#### Vérifier "Sonnet 4.5 thinking" (Anthropic direct)
La génération de script "Anthropic direct" passe par le **service VPS** (`/api/render/generate-script`), donc **il n'y aura pas de logs dans Supabase** pour ce flux.

Sur le VPS, vérifie les logs PM2 :

```bash
ssh ubuntu@51.91.158.233 "pm2 logs video-render --lines 200 --nostream | egrep '\\[generate-script\\]|Starting script generation|Extended thinking' -n"
```

À voir dans les logs :
- `Starting script generation with model: ...sonnet...`
- `Extended thinking enabled (budget_tokens=...)`

---

## Troubleshooting

### Supabase migrations: "Remote migration versions not found"

This happens when the migration history is out of sync. **Solution:**

```bash
# 1. Check what's out of sync
supabase migration list

# 2. Mark problematic migrations as reverted
supabase migration repair --status reverted 20260108

# 3. Force push all migrations
echo "Y" | supabase db push --include-all
```

### Supabase migrations: Column doesn't exist after "successful" push

The migration was marked as applied in history but **didn't actually execute**. **Solution:**

```bash
# 1. Mark as reverted
supabase migration repair --status reverted 20260108

# 2. Push again with --include-all
echo "Y" | supabase db push --include-all

# 3. Verify with curl
curl -s "https://laqgmqyjstisipsbljha.supabase.co/rest/v1/TABLE?select=NEW_COLUMN&limit=1" \
  -H "apikey: sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY" \
  -H "Authorization: Bearer sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY"
```

If you get `{"code": "42703"}` it still doesn't exist → Use Supabase Dashboard SQL Editor as last resort.

### "git push" fails with authentication error

GitHub no longer supports password auth for HTTPS remotes. Use the macOS keychain credential helper:

```bash
# Configure credential helper (one-time setup)
git config credential.helper osxkeychain

# Then push normally
git push origin main
```

If that doesn't work, create a Personal Access Token (PAT):
1. Go to: https://github.com/settings/tokens
2. Generate a new token with `repo` scope
3. Use the token as your password when prompted

Alternative: Use SSH instead of HTTPS:
```bash
git remote set-url origin git@github.com:goonidz/purple.git
git push origin main
```
(Requires SSH key configured in GitHub)

### Supabase deploy fails ("Not authorized")
- Ensure `SUPABASE_ACCESS_TOKEN` is exported in the same shell session.
- Confirm you're deploying to the correct project ref: `laqgmqyjstisipsbljha`.

### VPS: service won't respond
- Check PM2 status and logs:

```bash
ssh ubuntu@51.91.158.233 "pm2 status; pm2 logs video-render-service --lines 50 --nostream"
```

- Confirm port 3000 is listening:

```bash
ssh ubuntu@51.91.158.233 "ss -lntp | grep ':3000' || true"
```

### Image Worker: jobs stay pending
- Check the worker is running and not in error:

```bash
ssh vps-clean "pm2 status"
ssh vps-clean "pm2 logs image-worker --lines 50 --nostream"
```

- Check for stuck `processing` jobs (means worker crashed mid-job):

```sql
SELECT id, status, job_type, scene_index, updated_at
FROM generation_jobs
WHERE status = 'processing'
  AND job_type IN ('single_image', 'single_prompt', 'thumbnails')
  AND updated_at < NOW() - INTERVAL '5 minutes';
```

- Reset stuck jobs if needed:

```sql
UPDATE generation_jobs SET status = 'pending'
WHERE status = 'processing'
  AND job_type IN ('single_image', 'single_prompt', 'thumbnails')
  AND updated_at < NOW() - INTERVAL '5 minutes';
```
