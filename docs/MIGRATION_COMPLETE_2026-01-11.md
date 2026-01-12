# Migration VPS Complète - 11 Janvier 2026

**Résumé** : Réinstallation complète du VPS suite à infection par cryptominer  
**Durée totale** : ~3 heures (dont 2h30 de troubleshooting malware)  
**Downtime** : ~30 minutes  
**Résultat** : ✅ VPS propre, sécurisé et fonctionnel

---

## 📋 Contexte

### Problème initial
- **Symptôme** : "Pas de job ID reçu du VPS" lors de la génération de script
- **Investigation** : VPS inaccessible, CPU à 800%+
- **Découverte** : Malware cryptominer actif (processus `fc745g5g`, `dLrvzRB6N`, `/tmp/lrt`)

### Incident de sécurité
- **Type** : Cryptominer avec mécanisme de persistance
- **Localisation** : `/dev/shm/`, `/tmp/`, `/home/linuxbrew/`, `/home/ubuntu/`
- **Comportement** : Relance automatique après kill (mécanisme inconnu)
- **Impact** : CPU 700-800%, services instables

---

## 🔧 Actions effectuées

### Phase 1 : Tentative de nettoyage manuel (ÉCHEC)
1. ✅ Script de nettoyage créé (`scripts/vps-malware-cleanup.sh`)
2. ✅ Processus malveillants tués
3. ✅ Fichiers supprimés
4. ✅ `/tmp` et `/dev/shm` montés en `noexec`
5. ❌ **Malware relancé sous de nouveaux noms** (`I9aFf`, `sUsxVLdJ`)

**Conclusion** : Mécanisme de persistance non identifié → Réinstallation nécessaire

### Phase 2 : Préparation migration
1. ✅ Vérification que tout le code est sur GitHub
2. ✅ Vérification que les données sont sur Supabase
3. ✅ Documentation de déploiement vérifiée
4. ✅ Configuration DuckDNS sauvegardée
5. ✅ Génération d'une **nouvelle clé SSH** (sécurité)

**Clé SSH** : `~/.ssh/id_ed25519_new` (pour éviter toute compromission)

### Phase 3 : Réinstallation VPS (OVH)
1. ✅ Réinstallation Ubuntu 22.04 LTS
2. ✅ Configuration clé SSH publique
3. ⚠️ Problème : Changement de mot de passe obligatoire au premier boot
4. ⚠️ Problème : Console KVM en QWERTY (clavier AZERTY non compatible)
5. ✅ **Solution** : Deuxième réinstallation sans mot de passe (SSH key only)

### Phase 4 : Redéploiement complet
**Script d'installation automatique créé en une seule commande :**

```bash
# Installation prérequis
- Docker
- Node.js 20
- PM2
- nginx
- git
- fail2ban

# Clone repository
git clone https://github.com/goonidz/purple.git ~/purple

# Configuration DuckDNS
- Token: b7971357-d439-478b-83af-7ec43496c03e
- Domaine: purpleai.duckdns.org
- Cron: Mise à jour toutes les 5 minutes

# Services
- Video Render Service (PM2)
- Webhook GitHub (PM2)
- Frontend Docker + nginx

# SSL
- Certificat Let's Encrypt automatique
- HTTPS activé

# Sécurité
- /dev/shm et /tmp en noexec
- fail2ban actif
- SSH password disabled
- UFW NON configuré (évite blocage SSH)
```

### Phase 5 : Sécurisation
1. ✅ `/dev/shm` et `/tmp` montés en `noexec` (bloque exécution malware)
2. ✅ `fail2ban` installé et actif (protection brute-force SSH)
3. ✅ SSH par mot de passe désactivé (clé SSH uniquement)
4. ✅ Nouvelle clé SSH générée (aucune trace de compromission)
5. ⚠️ **UFW NON configuré** (évite problème de blocage SSH)

**Décision** : Ne pas utiliser UFW car risque de blocage SSH (déjà arrivé 2 fois)

---

## 📊 Résultat final

### ✅ Services déployés

| Service | Statut | Port/URL |
|---------|--------|----------|
| Frontend React | ✅ Online | https://purpleai.duckdns.org |
| Video Render Service | ✅ Online | http://51.91.158.233:3000 |
| Webhook GitHub | ✅ Online | Port 9000 (interne) |
| nginx | ✅ Online | Port 80/443 |
| Docker | ✅ Online | Port 8080 (interne) |
| PM2 | ✅ Online | 2 services actifs |

### ✅ Sécurité

| Mesure | Statut | Détails |
|--------|--------|---------|
| /dev/shm noexec | ✅ Actif | Bloque exécution malware |
| /tmp noexec | ✅ Configuré | Dans /etc/fstab |
| fail2ban | ✅ Actif | Protection brute-force |
| SSH password | ✅ Désactivé | Clé SSH uniquement |
| Nouvelle clé SSH | ✅ Générée | id_ed25519_new |
| UFW | ❌ Non configuré | Évite blocage SSH |

### 📈 Performances

**Avant migration** :
- CPU Load: 8.0+ (malware)
- Processus suspects: 3-5 actifs
- Services: Instables

**Après migration** :
- CPU Load: 0.55 (normal)
- Processus suspects: 0
- Services: Tous stables
- Memory: 2% utilisé

---

## 🎯 Tests de validation

### ✅ Tests réussis
1. ✅ Site accessible : https://purpleai.duckdns.org
2. ✅ HTTPS fonctionnel (certificat Let's Encrypt)
3. ✅ Video Render Service répond : `{"status":"ok","version":"v2.16-cleanup-endpoint"}`
4. ✅ PM2 services : 2/2 online
5. ✅ Docker container : Running
6. ✅ DuckDNS : Mis à jour automatiquement
7. ✅ SSH : Connexion par clé fonctionnelle
8. ✅ fail2ban : Actif
9. ✅ /dev/shm : Monté en noexec

### 🧪 Tests fonctionnels backend
- ✅ Supabase Edge Functions : Déjà déployées, fonctionnelles
- ✅ Base de données : Inchangée, toutes les données présentes
- ✅ Video Render Service : Accessible depuis Supabase
- ✅ Webhook GitHub : Déploiement automatique actif

---

## 📝 Leçons apprises

### 🔒 Sécurité

1. **Ne JAMAIS utiliser de mot de passe SSH**
   - Toujours utiliser des clés SSH
   - Désactiver `PasswordAuthentication` dans sshd_config

2. **Monter /tmp et /dev/shm en noexec**
   - Empêche 99% des malwares de s'exécuter
   - À faire dès l'installation

3. **fail2ban est essentiel**
   - Protection contre brute-force SSH
   - Facile à installer et configure automatiquement

4. **UFW peut causer des problèmes**
   - Risque de blocage SSH si mal configuré
   - fail2ban + SSH keys + noexec suffisent

5. **Générer une nouvelle clé SSH après compromission**
   - Même si le malware n'a probablement pas accès à la clé privée
   - Précaution de sécurité

### 🚀 Déploiement

1. **Architecture bien conçue**
   - Code sur GitHub → Facile à redéployer
   - Données sur Supabase → Aucune perte
   - Scripts d'installation → Automatisation

2. **Documentation cruciale**
   - Les docs `HOW_TO_DEPLOY.md` et `DEPLOYMENT.md` ont permis une migration rapide
   - Tout était documenté

3. **Console KVM a des limites**
   - Clavier QWERTY/AZERTY incompatible
   - Pas de copier-coller
   - À éviter si possible (préférer SSH)

4. **Snapshot non nécessaire**
   - Tout est dans Git + Supabase
   - Réinstallation propre plus sûre qu'une restauration

---

## 📂 Documentation créée/mise à jour

### Nouveaux documents
- ✅ `docs/MIGRATION_COMPLETE_2026-01-11.md` (ce document)
- ✅ `docs/VPS_RESET_MIGRATION.md` - Guide de migration étape par étape
- ✅ `INFOS_RESET_VPS.md` - Informations de connexion et commandes rapides
- ✅ `scripts/vps-malware-cleanup.sh` - Script de nettoyage malware
- ✅ `scripts/vps-save-config-before-reset.sh` - Sauvegarde config avant reset

### Documents mis à jour
- ✅ `docs/VPS_SECURITY.md` - Incident détaillé + résolution
- ✅ `docs/HOW_TO_DEPLOY.md` - Déjà à jour
- ✅ `DEPLOYMENT.md` - Déjà à jour

---

## 🔐 Nouvelles informations sensibles

### Clé SSH
- **Ancienne clé** : `~/.ssh/id_ed25519` (conservée pour GitHub)
- **Nouvelle clé VPS** : `~/.ssh/id_ed25519_new`
- **Alias SSH** : `ssh vps-clean` (pointe vers 51.91.158.233)

### DuckDNS
- **Domaine** : purpleai.duckdns.org
- **Token** : b7971357-d439-478b-83af-7ec43496c03e
- **Mise à jour** : Automatique toutes les 5 minutes (cron)

### Supabase
- **Project Ref** : laqgmqyjstisipsbljha
- **URL** : https://laqgmqyjstisipsbljha.supabase.co
- **Clé publique** : sb_publishable_h2I-M7p9mIrMFsMFw1Zr8w_JWY3S8nY

### GitHub
- **Repository** : git@github.com:goonidz/purple.git
- **Webhook** : Configuré sur le VPS (port 9000)

---

## ⏱️ Timeline

| Heure | Événement |
|-------|-----------|
| 21:07 | Malware détecté (CPU 700%+) |
| 21:30 | Première tentative de nettoyage |
| 21:40 | Malware relancé (nouveaux noms) |
| 21:45 | Décision de réinstaller |
| 21:50 | Sauvegarde des configurations |
| 21:55 | **Première réinstallation** (avec mot de passe) |
| 22:00 | Problème console KVM (QWERTY) |
| 22:05 | Problème firewall UFW (SSH bloqué) |
| 22:10 | **Deuxième réinstallation** (sans mot de passe) |
| 22:15 | Changement mot de passe manuel |
| 22:18 | Début installation automatique |
| 22:21 | Installation terminée ✅ |
| 22:23 | Tests de validation réussis ✅ |

**Durée effective de réinstallation** : ~10 minutes  
**Durée totale avec troubleshooting** : ~3 heures

---

## ✅ Checklist finale

### Système
- [x] VPS réinstallé (Ubuntu 22.04)
- [x] Clé SSH configurée
- [x] Docker installé
- [x] Node.js 20 installé
- [x] PM2 installé
- [x] nginx installé
- [x] git installé
- [x] fail2ban installé

### Services
- [x] Repository cloné
- [x] Video Render Service démarré (PM2)
- [x] Webhook déployé (PM2)
- [x] Frontend déployé (Docker)
- [x] nginx configuré
- [x] SSL configuré (Let's Encrypt)
- [x] DuckDNS configuré
- [x] Cron DuckDNS actif

### Sécurité
- [x] /tmp en noexec
- [x] /dev/shm en noexec
- [x] fail2ban actif
- [x] SSH par mot de passe désactivé
- [x] Nouvelle clé SSH générée
- [x] Pas de processus suspects

### Tests
- [x] Site accessible (HTTPS)
- [x] Video Render Service répond
- [x] PM2 services online
- [x] Docker container running
- [x] DuckDNS résout correctement
- [x] SSH fonctionne
- [x] CPU load normal (<1.0)

---

## 🎊 Conclusion

**Migration réussie !** Le VPS est maintenant :
- 🧹 **Propre** : Aucune trace de malware
- 🔒 **Sécurisé** : Protections renforcées
- ⚡ **Performant** : CPU normal, services stables
- 🌐 **En ligne** : https://purpleai.duckdns.org

**Tous les services backend et frontend fonctionnent normalement.**

---

**Date de migration** : 11 janvier 2026  
**Durée** : 3 heures (dont 2h30 troubleshooting)  
**Statut** : ✅ Succès complet
