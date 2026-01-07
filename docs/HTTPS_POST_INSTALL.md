# Checklist post-installation HTTPS

Après avoir configuré HTTPS avec le script `setup-https.sh`, suivez cette checklist pour mettre à jour toutes les configurations.

## ✅ Checklist

### 1. Mettre à jour VPS_PUBLIC_URL dans video-render-service

Sur le VPS, éditer `video-render-service/.env` :

```bash
ssh ubuntu@51.91.158.233
cd ~/purple/video-render-service
nano .env
```

Changer :
```env
VPS_PUBLIC_URL=https://purpleai.duckdns.org/api/render
```

Redémarrer le service :
```bash
npm run pm2:restart
```

### 2. Mettre à jour FFMPEG_SERVICE_URL dans Supabase

Depuis votre machine locale :

```bash
npx supabase secrets set FFMPEG_SERVICE_URL=https://purpleai.duckdns.org/api/render --project-ref laqgmqyjstisipsbljha
```

### 3. Vérifier que le frontend utilise HTTPS

Le frontend appelle le service via l'Edge Function Supabase, donc pas de changement nécessaire si vous avez mis à jour `FFMPEG_SERVICE_URL` ci-dessus.

Cependant, si vous avez des appels directs (comme dans `CreateFromScratch.tsx`), ils utilisent maintenant HTTPS automatiquement.

### 4. Tester les endpoints

```bash
# Test du frontend
curl -I https://purpleai.duckdns.org

# Test du service de rendu
curl https://purpleai.duckdns.org/api/render/health

# Test de la génération de script
curl -X POST https://purpleai.duckdns.org/api/render/generate-script \
  -H "Content-Type: application/json" \
  -d '{"anthropicApiKey":"test","customPrompt":"test"}'
```

### 5. Vérifier le renouvellement automatique

```bash
sudo certbot renew --dry-run
```

Si cette commande fonctionne, le renouvellement automatique est configuré correctement.

## 🔍 Vérifications

- [ ] HTTPS fonctionne sur https://purpleai.duckdns.org
- [ ] La redirection HTTP → HTTPS fonctionne
- [ ] Le service de rendu répond sur https://purpleai.duckdns.org/api/render/health
- [ ] Les vidéos générées utilisent des URLs HTTPS
- [ ] Le renouvellement automatique est configuré

## 📝 Notes

- Les certificats Let's Encrypt sont valides 90 jours
- Le renouvellement est automatique via cron
- Si vous changez de domaine, réexécutez `certbot --nginx -d nouveau-domaine.duckdns.org`
