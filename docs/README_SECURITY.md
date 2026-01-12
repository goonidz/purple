# 📚 Documentation Sécurité et Migration

Ce dossier contient toute la documentation relative à l'incident de sécurité du 11 janvier 2026 et la migration VPS.

---

## 📂 Fichiers principaux

### 🚨 Incident et résolution

#### **`VPS_SECURITY_RESOLVED.md`** ⭐ COMPLET
**Le document principal** avec tous les détails :
- Chronologie complète de l'incident
- Analyse technique du malware
- Toutes les actions correctives
- Comparaisons avant/après
- Leçons apprises

👉 **Commence par celui-ci pour comprendre tout ce qui s'est passé**

#### **`MIGRATION_COMPLETE_2026-01-11.md`** ⭐ RÉSUMÉ
Résumé exécutif de la migration :
- Actions effectuées étape par étape
- Timeline détaillée
- Checklist complète
- Résultat final

👉 **Pour un aperçu rapide de ce qui a été fait**

#### **`VPS_SECURITY.md`** 
Guide de sécurité général (pré-existant) :
- Comment se connecter au VPS
- Mesures de sécurité en place
- Gestion des clés SSH
- Surveillance et maintenance

---

### 🔄 Guides de migration

#### **`VPS_RESET_MIGRATION.md`** 
Guide complet pour futures migrations :
- Préparation (ce qu'il faut savoir)
- Procédure de reset OVH
- Redéploiement automatique
- Troubleshooting
- Ce qui a mal fonctionné (KVM, UFW)

👉 **Utilise ce guide si tu dois réinstaller le VPS à l'avenir**

#### **`../INFOS_RESET_VPS.md`** (racine du projet)
Aide-mémoire avec :
- Toutes les infos de connexion (DuckDNS, Supabase, GitHub)
- Commande d'installation complète (copier-coller)
- Liens utiles

👉 **Le document à avoir sous la main pendant une migration**

---

### 🛠️ Scripts créés

#### **`../scripts/vps-malware-cleanup.sh`**
Script de nettoyage du malware (historique) :
- Kill des processus malveillants
- Suppression des fichiers
- Recherche de persistance
- Vérifications post-nettoyage

⚠️ **Ce script n'a pas fonctionné** (malware se relançait), mais conservé pour référence

#### **`../scripts/vps-save-config-before-reset.sh`**
Sauvegarde automatique avant réinstallation :
- Configuration DuckDNS
- Configuration Webhook
- Liste services PM2
- Git remotes

---

## 🎯 Quel document lire selon ta situation ?

### Tu veux comprendre ce qui s'est passé ?
1. 📖 **`VPS_SECURITY_RESOLVED.md`** - Document complet avec tout le contexte

### Tu dois réinstaller le VPS ?
1. 📋 **`../INFOS_RESET_VPS.md`** - Commandes et infos de connexion
2. 📖 **`VPS_RESET_MIGRATION.md`** - Guide étape par étape
3. ⚠️ **Lis les leçons apprises** (KVM, UFW à éviter)

### Tu veux voir le résumé ?
1. 📊 **`MIGRATION_COMPLETE_2026-01-11.md`** - Timeline et checklist

### Tu veux gérer la sécurité au quotidien ?
1. 🔒 **`VPS_SECURITY.md`** - Connexion SSH, surveillance, maintenance

---

## 📊 Chronologie rapide

| Heure | Événement |
|-------|-----------|
| 21:07 | 🚨 Malware détecté (CPU 800%+) |
| 21:30 | 🧹 Tentative nettoyage manuel (échec) |
| 21:45 | 💡 Décision de réinstaller |
| 21:55 | ❌ Première réinstallation (problème KVM) |
| 22:05 | ❌ SSH bloqué par UFW |
| 22:10 | ✅ Deuxième réinstallation (succès) |
| 22:18 | 🚀 Installation automatique |
| 22:23 | ✅ Validation complète |

---

## ✅ État actuel

**VPS** : ✅ Propre et sécurisé  
**Services** : ✅ Tous opérationnels  
**Site** : ✅ https://purpleai.duckdns.org  
**CPU** : ✅ Normal (0.55 vs 8.0+)  
**Malware** : ✅ Éliminé (0 processus suspects)

---

## 🔐 Nouvelles mesures de sécurité

1. ✅ **SSH key only** : Nouvelle clé `id_ed25519_new`
2. ✅ **fail2ban** : Protection brute-force SSH
3. ✅ **/dev/shm + /tmp noexec** : Bloque exécution malware
4. ✅ **SSH password disabled** : Impossible de se connecter par mot de passe
5. ❌ **UFW NON utilisé** : Risque de blocage SSH > Bénéfice

---

## 📞 Contacts d'urgence

- **OVH Manager** : https://www.ovh.com/manager/
- **Supabase Dashboard** : https://app.supabase.com
- **GitHub Repository** : https://github.com/goonidz/purple
- **DuckDNS** : https://www.duckdns.org

---

## 🎓 Leçons clés

1. **Ne jamais** utiliser de mots de passe SSH
2. **Toujours** installer fail2ban dès le début
3. **Toujours** monter /dev/shm et /tmp en noexec
4. **Éviter** UFW (fail2ban + SSH keys suffisent)
5. **Éviter** console KVM (problème clavier QWERTY/AZERTY)
6. **Documenter** toute la configuration
7. **Architecture cloud** = migration facile (GitHub + Supabase)

---

---

## 🔧 Corrections post-migration

Quelques ajustements ont été nécessaires après la migration :

1. ✅ **HTTPS** : Maintenant configuré automatiquement (voir `HTTPS_SETUP.md`)
2. ✅ **Rendu vidéo** : FFmpeg installé + variables Supabase configurées (voir `POST_MIGRATION_FIXES.md`)

---

**Documentation créée** : 11 janvier 2026  
**Dernière mise à jour** : 11 janvier 2026, 22:30 UTC
