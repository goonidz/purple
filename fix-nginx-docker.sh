#!/bin/bash

# nginx + Docker setup for purpleai.duckdns.org.
#
# Source of truth for the VPS nginx config: ./nginx-purpleai.conf in
# the repo. This script installs it to /etc/nginx/sites-available/purpleai,
# runs a preflight check on required routes, backs up the current live
# config, validates with `nginx -t`, and rolls back on failure so we
# can never leave nginx broken after a deploy.
#
# Exits non-zero on any failure. deploy.sh relies on that.

set -euo pipefail

readonly DOMAIN="purpleai.duckdns.org"
# Resolve repo conf path relative to this script so it works regardless
# of who runs it (root via sudo, ubuntu, etc.) — $HOME would point to
# /root under sudo and break the lookup at /root/purple/...
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
readonly SCRIPT_DIR
readonly REPO_CONF="$SCRIPT_DIR/nginx-purpleai.conf"
readonly LIVE_CONF="/etc/nginx/sites-available/purpleai"
readonly ENABLED_LINK="/etc/nginx/sites-enabled/purpleai"
readonly LEGACY_AVAILABLE="/etc/nginx/sites-available/videoflow"
readonly LEGACY_ENABLED="/etc/nginx/sites-enabled/videoflow"
readonly LEGACY_DEFAULT="/etc/nginx/sites-enabled/default"

# Critical location blocks. If any is missing from the repo conf the
# script aborts BEFORE touching nginx on the VPS. Add any new route
# here so future refactors cannot silently drop it.
readonly REQUIRED_LOCATIONS=(
    "location /"
    "location /api/render/"
    "location /api/upload-video"
    "location /api/download-video/"
    "location /rendered-videos/"
    "location /gameplay/"
    "location /api/upload-gameplay"
    "location /api/list-gameplay"
    "location /api/delete-gameplay/"
    "location /blackscreen/"
    "location /api/upload-blackscreen"
    "location /api/list-blackscreen"
    "location /api/delete-blackscreen/"
    "location /remotion-api/"
    "location /remotion-renders/"
    "location /remotion-preview/"
    "location /health"
    "location /crm/"
)

log()  { printf "\033[1;34m▶\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m⚠\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

log "🔧 nginx + Docker setup for ${DOMAIN}"

# 1. Docker frontend container -------------------------------------------------
# Note: we no longer stop nginx here. Docker binds to 127.0.0.1:8080 so
# there is zero port conflict. Stopping nginx unconditionally was a bug
# that left the site offline whenever step 2 (preflight) failed.
log "🐳 (Re)starting Docker frontend on 127.0.0.1:8080..."
sudo docker stop videoflow 2>/dev/null || true
sudo docker rm   videoflow 2>/dev/null || true
sudo docker run -d \
    --name videoflow \
    -p 127.0.0.1:8080:80 \
    --restart unless-stopped \
    videoflow:latest >/dev/null
sleep 2

for _ in 1 2 3 4 5; do
    if curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
        ok "Docker answers on :8080"
        break
    fi
    sleep 1
done

# 2. Preflight on the repo conf ------------------------------------------------
log "🔍 Preflight: checking ${REPO_CONF##*/} has all required routes..."
[[ -f "$REPO_CONF" ]] || die "Missing $REPO_CONF — run this from a machine that has the repo at ~/purple."

missing=()
for loc in "${REQUIRED_LOCATIONS[@]}"; do
    if ! grep -qF "$loc" "$REPO_CONF"; then
        missing+=("$loc")
    fi
done

if (( ${#missing[@]} > 0 )); then
    echo
    printf "   - %s\n" "${missing[@]}" >&2
    die "Refus de déployer : ${#missing[@]} route(s) critique(s) manque(nt) dans $REPO_CONF. Ajoute-les avant de relancer."
fi
ok "All ${#REQUIRED_LOCATIONS[@]} required routes present in repo config"

# 3. Backup current live config ------------------------------------------------
backup=""
if [[ -f "$LIVE_CONF" ]]; then
    backup="${LIVE_CONF}.bak-$(date +%s)"
    sudo cp -a "$LIVE_CONF" "$backup"
    ok "Backup saved to $backup"
fi

# 4. Install the repo conf as the live conf -----------------------------------
log "📄 Installing $REPO_CONF → $LIVE_CONF"
sudo install -m 0644 "$REPO_CONF" "$LIVE_CONF"

# 5. Enable only the purpleai site; remove the legacy "videoflow" leftover ----
log "🔗 Fixing sites-enabled symlinks"
sudo ln -sf "$LIVE_CONF" "$ENABLED_LINK"
sudo rm -f "$LEGACY_ENABLED"    "$LEGACY_DEFAULT"
sudo rm -f "$LEGACY_AVAILABLE"

# 6. Validate nginx config; rollback on failure -------------------------------
log "🧪 nginx -t"
if ! sudo nginx -t 2>&1; then
    warn "nginx -t FAILED — rolling back"
    if [[ -n "$backup" && -f "$backup" ]]; then
        sudo install -m 0644 "$backup" "$LIVE_CONF"
        sudo ln -sf "$LIVE_CONF" "$ENABLED_LINK"
        sudo nginx -t >/dev/null 2>&1 \
            && ok "Rolled back to previous live config" \
            || die "Rollback also failed — manual intervention required. Backup at $backup"
    fi
    die "nginx config rejected."
fi
ok "nginx -t passed"

# 7. Reload / start nginx ------------------------------------------------------
if sudo systemctl is-active --quiet nginx; then
    sudo systemctl reload nginx
    ok "nginx reloaded"
else
    sudo systemctl start  nginx
    sudo systemctl enable nginx 2>/dev/null || true
    ok "nginx started"
fi

# 8. DuckDNS refresh (unchanged from the old script) --------------------------
if [[ -f "$HOME/.duckdns" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.duckdns"
    if [[ -n "${DUCKDNS_DOMAIN:-}" && -n "${DUCKDNS_TOKEN:-}" ]]; then
        resp=$(curl -s --max-time 10 \
            "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" 2>&1 || true)
        if [[ "$resp" == "OK" ]]; then
            ok "DuckDNS updated"
        else
            warn "DuckDNS response: $resp"
        fi
    fi
fi

# 9. Smoke tests ---------------------------------------------------------------
log "🧪 Smoke tests"
curl -fsS http://localhost:8080/health   >/dev/null && ok "frontend :8080  OK" || warn "frontend :8080 KO"
curl -fsS http://localhost/health        >/dev/null && ok "nginx  → /health OK" || warn "nginx → /health KO"

# /remotion-preview/ is the one that silently broke in the past.
# Try a HEAD on a known-404 path — we only want to see that it is NOT
# served by the SPA fallback (which would return index.html / 200).
preview_code=$(curl -o /dev/null -s -w '%{http_code}' \
    "http://localhost/remotion-preview/__sentinel__/bundle.js" || true)
case "$preview_code" in
    404|502|403) ok "/remotion-preview/ is proxied (got $preview_code, not SPA fallback)" ;;
    200)        warn "/remotion-preview/ returned 200 — looks like the SPA fallback caught it!" ;;
    *)          warn "/remotion-preview/ returned $preview_code (remotion-service may be down, check pm2)" ;;
esac

echo
ok "nginx setup complete for https://${DOMAIN}"
