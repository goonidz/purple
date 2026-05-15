# Extension Transcript API

> **Endpoint:** `GET https://purpleai.duckdns.org/api/extension/transcript?videoId=<YT_ID>`
> **Auth:** header `X-Extension-Token: <shared secret>`
> **Use case:** the **YouTube AI Comments** browser extension needs the original VideoFlow script of a video to feed the Gemini reply prompt, even on browser profiles (AdsPower) that aren't logged into VideoFlow.

---

## Why this exists

The extension already had a "VideoFlow context lookup" — it called Supabase REST directly with the logged-in user's JWT to fetch the script from `content_calendar` / `projects`. That works fine when the user is signed into `purpleai.duckdns.org` in the same browser.

**Problem:** on AdsPower automation profiles, we use the extension on dozens of different Chrome profiles. None of them are logged into VideoFlow (and we don't want to log them in — that would mean sharing the master account across sessions). So the existing lookup always returned `Not connected to VideoFlow`, and the extension fell back to scraping YouTube captions. YouTube captions are often missing for fresh uploads or auto-generated and unusable.

We need a way for the extension to read the script **without any per-user auth**, while still being safe to ship.

## High-level design

Two paths kept side-by-side:

| Path | When it fires | Auth | Backend |
|------|--------------|------|---------|
| **A. Session** | User is signed into `purpleai.duckdns.org` in the same browser (`auth-content.js` bridge stored a JWT) | User JWT in `Authorization` | Supabase REST (`/rest/v1/content_calendar`), filtered by RLS |
| **B. Shared-token** | No session — typical AdsPower case | Hardcoded `X-Extension-Token` header | `/api/extension/transcript` on VPS → `video-render-service` (port 3000) → Supabase service role |

The extension tries A first, falls back to B, then if nothing is in VideoFlow's DB it falls back to YouTube captions scraping (innertube / page scrape).

## Why a server-side proxy instead of a hardcoded service role key

Three reasons:

1. **Whitelist of fields.** The endpoint returns ONLY `{ title, script, notes }`. It never exposes other tables, user IDs, API keys, etc. If the token leaks, the blast radius is "someone can read scripts of any video by YouTube ID" — bad but bounded. With a hardcoded service role key, leaking it would give full DB access including writes.
2. **Server-side rate limiting + logging.** Every call is logged in PM2 (`pm2 logs video-render-service | grep extension/transcript`). We can spot scrapers.
3. **Easy revocation.** Rotate `EXTENSION_API_TOKEN` env var on the VPS → every existing extension copy becomes useless in one PM2 restart. With a hardcoded service role key, we'd have to rotate the actual Supabase service role key, which would break every other backend service.

## Components

### Backend route

`video-render-service/server.js` exposes `GET /extension/transcript`:

```js
app.get('/extension/transcript', async (req, res) => {
  const expected = process.env.EXTENSION_API_TOKEN;
  if (!expected) return res.status(503).json({ error: '…' });
  const token = req.get('X-Extension-Token');
  if (!token || token !== expected) return res.status(401).json({ error: '…' });
  // …
});
```

Logic mirrors the original `handleGetVideoContext` in `ytb-ai-comments/background.js`:

1. `content_calendar` lookup by `youtube_url ilike '%<videoId>%'`
2. If the matched row has no `script` but has a `project_id`, fall through to `projects.script` (or `projects.summary` as a last resort)
3. Returns `{ source, title, script, notes }`

The endpoint uses the existing `supabase` client of `video-render-service`, which is already initialised with `SUPABASE_SERVICE_ROLE_KEY` from the service's local `.env`.

### Nginx route

`nginx-purpleai.conf` proxies `/api/extension/` → `127.0.0.1:3000/extension/`:

```nginx
location /api/extension/ {
    proxy_pass http://127.0.0.1:3000/extension/;
    # … standard proxy headers …
}
```

The route is also in `REQUIRED_LOCATIONS` of `fix-nginx-docker.sh`, so any nginx redeploy that drops it fails fast.

### Extension client

`ytb-ai-comments/background.js`:

- Constants at the top:

  ```js
  const EXTENSION_API_BASE = 'https://purpleai.duckdns.org/api/extension';
  const EXTENSION_API_TOKEN = '<32-byte hex secret>';
  ```

- `handleGetVideoContext(videoId)` now sequentially tries:
  1. `fetchVideoContextViaSession(videoId)` — Supabase REST with stored JWT
  2. `fetchVideoContextViaSharedToken(videoId)` — VPS endpoint with shared token
  3. (caller) falls back to YouTube captions scraping if both return null

The flow is invisible to `content.js` — it still does `chrome.runtime.sendMessage({ type: 'GET_VIDEO_CONTEXT', videoId })` and the background worker handles routing.

## Setup / Ops

### Initial install on VPS

```bash
# 1. Set the secret (the same value as EXTENSION_API_TOKEN in background.js)
ssh vps-clean
echo 'EXTENSION_API_TOKEN=0aaf47d93848683737dcd2f75624a8b92e2109ee6eb73a20babeb9dbfb51b721' \
  >> ~/purple/video-render-service/.env

# 2. Pull the new code
cd ~/purple
git pull origin main

# 3. Restart the service so dotenv picks up the new env var
#    (pm2 restart alone does NOT reload .env — recreate the process)
pm2 delete video-render-service
cd ~/purple/video-render-service
pm2 start server.js --name video-render-service --time
pm2 save

# 4. Reload nginx with the new /api/extension/ route
sudo ./deploy.sh   # or: sudo cp nginx-purpleai.conf /etc/nginx/sites-available/purpleai && sudo nginx -t && sudo systemctl reload nginx
```

### Verify it works

```bash
# From your laptop — should return 401 without a token
curl -i 'https://purpleai.duckdns.org/api/extension/transcript?videoId=dQw4w9WgXcQ'

# With token — returns 404 if not in DB, 200 + { title, script, notes } if found
curl -i \
  -H 'X-Extension-Token: 0aaf47d93848683737dcd2f75624a8b92e2109ee6eb73a20babeb9dbfb51b721' \
  'https://purpleai.duckdns.org/api/extension/transcript?videoId=<KNOWN_VF_VIDEO_ID>'
```

### Rotating the secret (revoke all extensions)

1. Generate a new token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Update `EXTENSION_API_TOKEN` on the VPS:

   ```bash
   ssh vps-clean
   # edit ~/purple/video-render-service/.env, replace EXTENSION_API_TOKEN=…
   pm2 delete video-render-service
   cd ~/purple/video-render-service
   pm2 start server.js --name video-render-service --time
   pm2 save
   ```
3. Update the constant in `ytb-ai-comments/background.js`, bump `manifest.json` version, rebuild `ytb-ai-comments.zip`, reinstall on every AdsPower profile.

Old extension copies hit the endpoint, get `401`, and silently fall back to YouTube captions.

### Monitoring

```bash
# Live tail of requests
ssh vps-clean "pm2 logs video-render-service --nostream --lines 200 | grep extension/transcript"
```

Each request logs a line like:

```
[extension/transcript] videoId=dQw4w9WgXcQ title="Never Gonna Give You Up" script=12450c
```

(or `script=null` if there's no script saved yet for that video).

## Security notes

- **Token hardcoded in extension** = anyone with the `.crx`/unpacked extension can read the token. Acceptable because:
  - The extension is shipped privately (AdsPower profiles you control)
  - Endpoint is whitelist-only (`title` / `script` / `notes`)
  - Token rotation is one PM2 restart + extension reinstall
- **No write surface.** The endpoint is `GET` only, no body, no mutation.
- **Strict videoId regex** (`/^[A-Za-z0-9_-]{6,20}$/`) prevents abuse via crafted query strings.
- **Service role is never sent to the client** — it lives only inside the `video-render-service` process via the `.env` file.

## Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Extension always falls back to YouTube captions | Token mismatch between extension and VPS | Re-check `EXTENSION_API_TOKEN` on VPS matches `background.js`, restart service |
| `503 Extension API not configured` | `EXTENSION_API_TOKEN` env var missing | Add to `~/purple/video-render-service/.env`, restart with `pm2 delete && pm2 start` |
| `404 Video not found in VideoFlow DB` | The YouTube URL isn't yet associated to a `content_calendar` entry | Normal — happens for non-VideoFlow videos. Extension falls back to YouTube captions automatically. |
| `500 Internal error` | Supabase query failed (usually transient) | Check Supabase status; check `pm2 logs video-render-service` |
| 401 from previously-working extension | Token was rotated server-side | Reinstall the extension with the matching new token |

## Files touched

- `video-render-service/server.js` — endpoint implementation
- `nginx-purpleai.conf` — proxy route `/api/extension/`
- `fix-nginx-docker.sh` — `REQUIRED_LOCATIONS` entry to guard the route
- `ytb-ai-comments/background.js` — client (path A + path B) + token constant
- `ytb-ai-comments/manifest.json` — version bump (1.2.0 → 1.3.0)
- `ytb-ai-comments.zip` — rebuilt package for AdsPower deployment
- `docs/EXTENSION_TRANSCRIPT_API.md` — this file

---

## Sibling endpoint: `POST /extension/generate` (v1.4.0+)

> **Endpoint:** `POST https://purpleai.duckdns.org/api/extension/generate`
> **Auth:** same `X-Extension-Token` shared secret as `/transcript`.
> **Body:** `{ "prompt": "<full prompt string>" }`
> **Returns:** `{ "text": "<reply>", "finishReason": "STOP", "source": "gemini-vps" }`

### Why this exists

We initially put a hardcoded Gemini key directly in `background.js` (constant `HARDCODED_GEMINI_KEY`) so the extension could call `generativelanguage.googleapis.com` from the AdsPower profile without any VideoFlow login. Within minutes of pushing the commit to GitHub, Google's leak scanner detected the key in the public repo and auto-revoked it. The extension started returning:

```
403 Forbidden — Your API key was reported as leaked. Please use another API key.
```

Generating a new key would just get revoked again the next push. So **all Gemini calls now relay through the VPS**, exactly like `/extension/transcript`: the extension sends the assembled prompt and `X-Extension-Token`, the server applies its key (`GEMINI_API_KEY` env var) and forwards to Gemini.

### Server-side controls

- **Model** is hardcoded server-side (currently `gemini-2.5-flash`) — change without redeploying the extension.
- **Generation config** is server-side too: `temperature 0.7`, `maxOutputTokens 1024`.
- **Rate limit:** 30 generations / minute / IP (in-memory `extensionGenerateRate` map). Light defence against a runaway extension loop.
- **Prompt size cap:** 200k chars (enough for a full 33k-char script + comment + template).
- **Upstream timeout:** 45s (`AbortSignal.timeout(45_000)`), with nginx `proxy_read_timeout 60s` to leave headroom.

### Setup

Add to `~/purple/video-render-service/.env` on the VPS:

```bash
GEMINI_API_KEY=AIza...
```

Then `pm2 delete video-render-service && pm2 start ...` (PM2 `restart` does **not** reload `.env`).

### Test

```bash
# OK
curl -X POST https://purpleai.duckdns.org/api/extension/generate \
  -H 'X-Extension-Token: <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Say hello in French in 3 words."}'

# → {"source":"gemini-vps","text":"Bonjour à toi.","finishReason":"STOP"}

# Bad token → 401
# Missing GEMINI_API_KEY → 503
# Prompt > 200k chars → 413
# > 30 req/min/IP → 429
```

### Client path

The extension's `content.js` now picks between two paths in `generateReply()`:

1. **`apiKey` provided** (user is signed into VideoFlow OR set a personal key in the popup) → direct call to Google, same as before.
2. **`apiKey` null/empty** → `chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', prompt })` → `background.js#handleGenerateReply()` → `POST /api/extension/generate`.

`background.js#handleGetApiKeys()` returns `{ success: true, source: 'vps-proxy', geminiKey: null }` when no per-user key is available, signaling the proxy path. **There is no hardcoded Gemini key anywhere in the extension anymore.**
