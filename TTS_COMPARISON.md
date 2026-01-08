# 🎙️ Guide de Comparaison TTS

Deux systèmes TTS testables localement dans ce projet :

---

## ⚡ Soprano TTS

**Dossier** : `soprano-test/`  
**Lancement** : Double-clic sur `soprano-test/LANCER_INTERFACE.command`  
**URL** : http://localhost:7861

### ✅ Points forts

- ⚡ **ULTRA-RAPIDE** : RTF ~2000× (10h d'audio en 20s)
- 🪶 **Léger** : 80M paramètres (~300MB)
- 📦 **Installation simple** : Une commande, tout automatique
- 🌊 **Streaming** : <15ms latency, temps-réel
- 🔊 **Qualité** : 32kHz, Vocos decoder
- ⏱️ **Setup** : 3-5 minutes

### ❌ Limitations

- 🇬🇧 **Anglais uniquement** (pas de français)
- 🎤 **Voix fixe** (pas de voice cloning)
- 🖥️ **GPU recommandé** pour RTF optimal (mais fonctionne sur CPU)

### 🎯 Cas d'usage idéaux

- Génération massive de voice-overs en anglais
- Prototypage rapide
- Applications temps-réel (chatbots vocaux)
- Livres audio (batch generation)
- Quand la **vitesse** est prioritaire

---

## 🎨 CosyVoice 3

**Dossier** : `cosyvoice-test/`  
**Lancement** : Double-clic sur `cosyvoice-test/LANCER_INTERFACE.command`  
**URL** : http://localhost:7860

### ✅ Points forts

- 🎤 **Voice cloning** : Zero-shot, clone n'importe quelle voix
- 🌍 **9 langues** : Français, Anglais, Espagnol, Allemand, Italien, Japonais, Coréen, Russe, Chinois
- 🎭 **Contrôle avancé** : Émotions, dialectes, vitesse, pauses
- 🎨 **Cross-lingual** : Voix française parlant anglais (et vice-versa)
- 📊 **Qualité SOTA** : Meilleur modèle open-source 0.5B

### ❌ Limitations

- 🐢 **Plus lent** : RTF ~0.3-0.5× (3-7s pour 30s d'audio sur M1)
- 💾 **Lourd** : 500M paramètres (~2GB)
- 🔧 **Installation complexe** : Plusieurs étapes, third_party requis
- ⏱️ **Setup** : 15-20 minutes

### 🎯 Cas d'usage idéaux

- Voix personnalisées (clonage de voix spécifique)
- Contenu multilingue (surtout français)
- Contrôle créatif (émotions, styles)
- Quand la **qualité** et la **flexibilité** sont prioritaires

---

## 📊 Comparaison détaillée

| Critère                | Soprano ⚡         | CosyVoice 🎨      |
|------------------------|-------------------|-------------------|
| **Paramètres**         | 80M               | 500M              |
| **Téléchargement**     | ~300MB            | ~2GB              |
| **Installation**       | 3-5 min           | 15-20 min         |
| **RTF (M1/M2)**        | ~100-500×         | ~0.3-0.5×         |
| **Latency streaming**  | <15ms             | ~1-3s             |
| **Sample rate**        | 32kHz             | 22.05kHz          |
| **Langues**            | 🇬🇧 Anglais       | 🌍 9 langues      |
| **Voice cloning**      | ❌ Non            | ✅ Oui            |
| **Cross-lingual**      | ❌ Non            | ✅ Oui            |
| **Contrôle émotions**  | ❌ Non            | ✅ Oui            |
| **Batch generation**   | ✅ Oui            | ✅ Oui            |
| **Streaming**          | ✅ <15ms          | ⚠️ ~1-3s          |
| **Port interface**     | 7861              | 7860              |

---

## 🚀 Guide de choix rapide

### Tu as besoin de VITESSE ?
→ **Soprano** ⚡

### Tu as besoin de MULTILANGUE (français) ?
→ **CosyVoice** 🎨

### Tu veux CLONER une voix spécifique ?
→ **CosyVoice** 🎨

### Tu génères des GROS VOLUMES (heures d'audio) ?
→ **Soprano** ⚡

### Tu veux du TEMPS-RÉEL (<50ms) ?
→ **Soprano** ⚡

### Tu veux du CONTRÔLE CRÉATIF (émotions, styles) ?
→ **CosyVoice** 🎨

### Tu veux une INSTALLATION SIMPLE ?
→ **Soprano** ⚡

---

## 🔄 Utiliser les deux

**Bonne nouvelle** : Les deux peuvent coexister !

- **Soprano** : Port 7861
- **CosyVoice** : Port 7860

Tu peux lancer les deux interfaces en même temps et switcher selon tes besoins ! 🎉

---

## 🎯 Mon workflow recommandé

1. **Prototypage / Tests rapides** → Soprano
2. **Production (anglais, volumes)** → Soprano
3. **Production (français, multilingue)** → CosyVoice
4. **Voix personnalisées** → CosyVoice

---

## 📝 Installation

### Soprano (rapide)

```bash
cd soprano-test
# Double-clic sur INSTALLER.command
# Puis double-clic sur LANCER_INTERFACE.command
```

### CosyVoice (plus long)

```bash
cd cosyvoice-test
# Double-clic sur INSTALLER.command
# Puis double-clic sur LANCER_INTERFACE.command
```

---

## 🔗 Ressources

### Soprano
- GitHub: https://github.com/ekwek1/soprano
- Model: https://huggingface.co/ekwek/Soprano-80M
- Demo: https://huggingface.co/spaces/ekwek/Soprano-TTS

### CosyVoice
- GitHub: https://github.com/FunAudioLLM/CosyVoice
- Model: https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512
- Paper: https://arxiv.org/abs/2505.17589

---

**💡 Conseil pro** : Installe les deux, teste, et garde celui qui correspond le mieux à ton use case !
