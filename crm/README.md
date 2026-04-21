# Mes emails — webmail unifié pour privateemail

Petit webmail personnel qui centralise plusieurs boîtes **privateemail** (ou n'importe quel compte IMAP/SMTP) dans une seule interface :

- **Page d'accueil** avec stats sur les 7 derniers jours : reçus, non lus, non répondus, répondus — totaux et par compte
- Une boîte par compte dans une sidebar, avec un **badge de non-lus** à côté du nom
- Lecture des messages avec pièces jointes, mise en gras + point bleu des non-lus
- Écriture et réponse en choisissant **l'expéditeur** dans une liste déroulante — le destinataire voit la bonne adresse (`contact@...`, `facture@...`, etc.)
- Les messages envoyés sont copiés dans le dossier `Sent` du compte correspondant
- Les originaux reçoivent automatiquement le flag IMAP `\Answered` quand tu y réponds (suivi "répondu / non répondu")
- **Filtrage automatique des rapports DMARC / postmaster** dans la liste (éditable dans `app/filters.py`, lien "Tout afficher" pour bypass)
- **Pixels de tracking bloqués** : les images distantes sont strippées du HTML des emails par défaut
- **Extensions dangereuses signalées** (`.exe`, `.html`, `.js`, `.docm`…) → avertissement avant téléchargement
- Rate-limit brute-force sur `/login`, cookie session `secure`/`httponly`, headers CSP/X-Frame-Options/HSTS
- Protégé par un mot de passe unique (indispensable sur un VPS public)

Stack : Python 3.11+ / FastAPI / Jinja2 / imap-tools. Base SQLite locale (`cache.sqlite`) uniquement pour cacher les en-têtes des messages — les corps et les pièces jointes sont toujours lus directement depuis IMAP, rien n'est dupliqué.

## Performance

Chargement typique (après le premier sync) :

| Action                           | Temps   |
|----------------------------------|---------|
| Ouvrir la boîte (déjà sync)      | ~0.3 s  |
| Ouvrir un message                | ~0.6 s  |
| Premier sync d'un gros compte    | 2–5 s   |
| Rafraîchir à fond (bouton ↻)     | 1–10 s  |

Ce qui rend ça rapide :

- **Connexions IMAP persistantes** : le `LOGIN` n'est payé qu'une fois par compte par démarrage du serveur.
- **Cache SQLite local** des en-têtes (sujet, expéditeur, date, flags). Au chargement suivant, on demande juste `STATUS (UIDVALIDITY UIDNEXT)` et on sert depuis le cache si rien n'a bougé.
- **Sync incrémental** : on ne télécharge que les UIDs plus récents que le dernier connu.
- Premier sync limité aux **200 derniers messages** par dossier (configurable via `_INITIAL_SYNC_LIMIT` dans `app/mail.py`).

## 1. Installation locale

```bash
cd /Users/Tom/emails
./run.sh
```

Le premier lancement crée `.env` et `accounts.yml` depuis les exemples. **Édite-les**, puis relance.

### Configuration

**`.env`** (mot de passe du site + secret de session) :

```
APP_PASSWORD=un_mdp_solide
SESSION_SECRET=une_longue_chaine_aleatoire
HOST=127.0.0.1
PORT=8000
```

Génère un secret avec :

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**`accounts.yml`** — un bloc par adresse privateemail :

```yaml
accounts:
  - name: "Contact"
    email: "contact@masociete.com"
    password: "mdp_du_compte_privateemail"
    display_name: "Ma Société - Contact"
    imap_host: "mail.privateemail.com"
    imap_port: 993
    smtp_host: "mail.privateemail.com"
    smtp_port: 465
    smtp_ssl: true
```

Ouvre ensuite http://127.0.0.1:8000, connecte-toi avec `APP_PASSWORD`.

## 2. Déploiement sur un VPS

### Prérequis

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx
```

### Mise en place

```bash
sudo mkdir -p /opt/emails
sudo chown $USER /opt/emails
# copie le projet
scp -r . user@ton-vps:/opt/emails/

ssh user@ton-vps
cd /opt/emails
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # édite APP_PASSWORD + SESSION_SECRET
cp accounts.example.yml accounts.yml   # édite avec tes comptes
```

### Service systemd

Crée `/etc/systemd/system/emails.service` :

```ini
[Unit]
Description=Mes emails (webmail unifié)
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/emails
Environment="PATH=/opt/emails/.venv/bin"
ExecStart=/opt/emails/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/emails
sudo systemctl enable --now emails
sudo systemctl status emails
```

### Nginx + HTTPS (Let's Encrypt)

`/etc/nginx/sites-available/emails` :

```nginx
server {
    listen 80;
    server_name mail.mondomaine.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 32M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/emails /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mail.mondomaine.com
```

## 3. Sécurité

### Protections intégrées

| Vecteur | Protection |
|---|---|
| Brute-force `/login` | 5 tentatives / 15 min / IP → **HTTP 429** (`app/security.py`). Ajoute fail2ban sur nginx pour durcir davantage. |
| Timing attack sur le mot de passe | Comparaison constant-time via `secrets.compare_digest`. |
| Cookie session volé en clair | `secure=True` auto-activé en HTTPS (via `X-Forwarded-Proto` du reverse proxy), `httponly`, `samesite=lax`, expiration 7 jours. |
| CSRF | `SameSite=Lax` bloque l'envoi du cookie sur POST cross-site → auth échoue côté attaquant. |
| XSS depuis le corps des emails | `<iframe sandbox>` sans aucun `allow-*` → JS inerte, forms inertes, pas de same-origin. |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. |
| Tracking pixel / read receipt | Les images et feuilles de style distantes (`http://`, `https://`, `//`) sont **strippées par défaut** dans le HTML des emails. Lien « Afficher les images » en bas pour réactiver (passe `?show_images=1`). `cid:` et `data:` (images inline, font partie du message) sont préservés. |
| Content sniffing | `X-Content-Type-Options: nosniff` global + sur les pièces jointes. |
| CSP | `default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`. |
| Header injection via nom de PJ | Filename RFC 5987 (`filename*=UTF-8''...`) + ASCII fallback, CRLF et `"` neutralisés (`security.safe_content_disposition`). |
| HTML/SVG malveillant auto-ouvert | Toutes les pièces jointes servies en `Content-Type: application/octet-stream` + `Content-Security-Policy: sandbox` → jamais rendues par le navigateur. |
| Exécutables dangereux | Extensions `.exe .scr .bat .cmd .com .cpl .dll .vbs .js .hta .lnk .msi .jar .apk .app .dmg .iso .html .htm .svg .docm .xlsm .pptm …` → **page d'avertissement interstitielle** avant téléchargement (double-clic requis). Liste dans `app/security.py`. |
| Upload monstrueux | 25 Mo / pièce jointe, 32 Mo au total (HTTP 413 sinon). Nginx `client_max_body_size 32M` en défense secondaire. |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains` en HTTPS. |

### Ce qui **n'est pas** fait

- **Pas de scan antivirus** sur les pièces jointes. L'app se contente d'avertir sur les extensions à risque. Pour une vraie défense, installer ClamAV sur le VPS : `sudo apt install clamav-daemon` puis ajouter un hook dans `download_attachment` qui appelle `clamdscan --stdout --no-summary - < payload`.
- **Pas de 2FA**. Pour un usage exposé sur internet public, mettre l'app derrière un VPN (WireGuard, Tailscale) ou un reverse proxy Cloudflare Access est une meilleure défense que tout ce qui précède.
- **Pas de log d'audit** persistant : les logs uvicorn stdout contiennent les requêtes mais rien de structuré.

### Conseils de déploiement

- **Mot de passe fort** pour `APP_PASSWORD` — c'est la seule barrière. Le site donne un accès total à toutes tes boîtes.
- `accounts.yml` et `.env` contiennent des secrets en clair. Ils sont ignorés par git (voir `.gitignore`) — `chmod 600` sur le VPS, propriétaire = user du service systemd.
- Derrière nginx, toujours activer HTTPS (Let's Encrypt). Sans TLS, le cookie session et le mot de passe passent en clair.
- Expose l'app derrière un VPN si possible. L'internet public n'est pas une nécessité pour un webmail perso.

## 4. Trucs utiles

- Le bouton **⌂ Accueil** en haut du sidebar ouvre la page stats globales (tous comptes, 7 derniers jours).
- Appuyer sur `c` (en dehors d'un champ) ouvre la fenêtre de composition.
- La liste affiche 50 messages par page. Ajuste `per_page` dans `app/main.py` si besoin.
- Ajout de nouveaux comptes : édite `accounts.yml`, pas besoin de redémarrer (les comptes sont relus à chaque requête).
- Le bouton **↻ Rafraîchir** force un resync complet : détecte les suppressions côté serveur et remet à jour les flags lu/non-lu.
- Pour repartir à zéro (après un changement de compte, un debug, etc.) il suffit de supprimer `cache.sqlite*` à la racine du projet — le cache sera reconstruit au prochain chargement.

### Filtrage des messages automatiques

Par défaut les rapports DMARC et les mails de postmaster sont **masqués** de la liste et ne comptent pas dans les non-lus. Un bandeau discret en haut de l'inbox indique `N rapport(s) masqué(s)` avec un lien **"Tout afficher"** (passe `?show_all=1` dans l'URL).

Les patterns (LIKE SQL) sont dans `app/filters.py`, directement éditables — pas besoin de toucher au cache, le filtre est appliqué à la volée :

```python
HIDDEN_SUBJECT_PATTERNS = ["%dmarc%", "report domain:%", ...]
HIDDEN_FROM_PATTERNS    = ["%dmarc%", "postmaster@%", "mailer-daemon@%", ...]
```

### Stats "répondu / non répondu"

Le suivi s'appuie sur le flag IMAP standard `\Answered` :

- Quand tu envoies une réponse depuis cette app, le message original est marqué `\Answered` automatiquement (via `mail.mark_flag`) — côté serveur aussi, donc visible depuis tes autres clients.
- Les messages déjà marqués `\Answered` par Thunderbird, Mail.app ou le webmail privateemail sont comptés comme répondus.
- "Non répondus" = reçus ces 7 derniers jours sans flag `\Answered`. Inclut les notifs automatiques (Shopify, Stripe…) — si ça devient bruyant, étends `app/filters.py` pour les exclure aussi.

## 5. Structure

```
.
├── app/
│   ├── main.py          # routes FastAPI (/, /mailbox, /compose, …)
│   ├── mail.py          # pool IMAP persistant + sync incrémental + SMTP
│   ├── cache.py         # cache SQLite des en-têtes + stats home
│   ├── filters.py       # patterns DMARC / postmaster masqués
│   ├── security.py      # rate-limit login + filename + blocklist extensions
│   ├── auth.py          # session signée (itsdangerous)
│   ├── config.py        # chargement YAML + env
│   ├── static/          # CSS + JS
│   └── templates/       # Jinja2 (home, inbox, message, compose, attachment_warning, …)
├── cache.sqlite         # créé automatiquement (ignoré par git)
├── accounts.example.yml
├── .env.example
├── requirements.txt
├── run.sh
└── README.md
```

## 6. Limitations connues

- Pas de preview (snippet) dans la liste : seuls sujet, expéditeur et date sont cachés pour que le premier sync soit rapide. Le corps s'affiche quand on ouvre un message.
- Pas d'IDLE / push : les nouveaux mails apparaissent quand tu recharges la page (ou quand tu cliques Rafraîchir).
- Pas de recherche full-text (côté serveur IMAP uniquement, non exposé pour l'instant).
- Pas de threading visuel (les réponses conservent cependant les bons headers `In-Reply-To` / `References`, et le flag `\Answered` est posé sur l'original).
- Stats "répondu / non répondu" basées sur les 7 derniers jours uniquement — fenêtre non configurable depuis l'UI (modifier `days=7` dans l'appel à `cache.get_home_stats` dans `app/main.py`).

Ajoute une issue ou demande une évolution si tu veux une de ces fonctionnalités.
