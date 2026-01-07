# How to deploy (VideoFlow)

This repo has **three** deploy targets:

- **Frontend web app** (Docker + nginx on the VPS)
- **Supabase Edge Functions** (deployed to the Supabase project)
- **Video Render Service (VPS)** (`video-render-service/`, managed by PM2 on port 3000)

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

## 2) Deploy Supabase Edge Functions

### 2.1 Load `SUPABASE_ACCESS_TOKEN`

If you store it in `.env`:

```bash
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d '=' -f2)
```

### 2.2 Deploy a specific function

Example (what we deployed today):

```bash
npx supabase functions deploy generate-script --project-ref laqgmqyjstisipsbljha
```

Other functions can be deployed similarly:

```bash
npx supabase functions deploy <function-name> --project-ref laqgmqyjstisipsbljha
```

---

## 3) Deploy / restart services on the VPS

### 3.1 Video render service (PM2)

The PM2 process name is `video-render`.

Fast path (pull latest + restart + show logs):

```bash
ssh ubuntu@51.91.158.233 "set -e; cd ~/purple; git pull origin main; pm2 restart video-render; pm2 logs video-render --lines 20 --nostream"
```

Health check on the VPS:

```bash
ssh ubuntu@51.91.158.233 "curl --max-time 3 -s http://localhost:3000/health"
```

### 3.2 Frontend (Docker + nginx)

If you use the webhook-based auto-deploy, pushing to `main` triggers it automatically.
If you need to do it manually on the VPS:

```bash
ssh ubuntu@51.91.158.233 "set -e; cd ~/purple; git pull origin main; ./deploy.sh"
```

---

## 4) Quick validation checklist

### Supabase
- Open Supabase Dashboard → Functions → confirm `generate-script` shows a recent deploy.

### VPS render service
- Health returns JSON:

```bash
ssh ubuntu@51.91.158.233 "curl --max-time 3 -s http://localhost:3000/health"
```

### App smoke test
- Trigger a script generation from the UI and confirm the logs on the VPS show the expected model / thinking settings (if applicable).

---

## Troubleshooting

### “git push” asks for username/password
- Use a GitHub credential helper (macOS keychain) or a Personal Access Token (PAT).
- If you’re using HTTPS remotes, GitHub no longer supports password auth (PAT required).

### Supabase deploy fails (“Not authorized”)
- Ensure `SUPABASE_ACCESS_TOKEN` is exported in the same shell session.
- Confirm you’re deploying to the correct project ref: `laqgmqyjstisipsbljha`.

### VPS: service won’t respond
- Check PM2 status and logs:

```bash
ssh ubuntu@51.91.158.233 "pm2 status; pm2 logs video-render --lines 50 --nostream"
```

- Confirm port 3000 is listening:

```bash
ssh ubuntu@51.91.158.233 "ss -lntp | grep ':3000' || true"
```

