# Applio RunPod Setup

## 1. Créer le Pod sur RunPod

- **GPU** : RTX 3090 / 4090 / 5090 (minimum 24 Go VRAM)
- **Cloud** : Community (~$0.22/h) ou Secure
- **Template** : RunPod PyTorch 2.x (avec CUDA)
- **Expose HTTP Ports** : `8888, 6969`
- **Volume** : 20 Go minimum

> ⚠️ Le port 6969 DOIT être ajouté à la création du Pod, impossible de l'ajouter après.

---

## 2. Installer Applio (terminal web ou Jupyter)

### Terminal web (Web Console)
Colle cette commande en une seule fois :

```bash
apt-get update && apt-get install -y ffmpeg && cd /tmp && wget http://files.portaudio.com/archives/pa_stable_v190700_20210406.tgz && tar -xzf pa_stable_v190700_20210406.tgz && cd portaudio && ./configure && make && make install && ldconfig && cd /workspace && git clone https://github.com/IAHispano/Applio.git && cd Applio && pip install --no-cache-dir torch==2.7.1+cu128 torchaudio==2.7.1+cu128 torchvision==0.22.1+cu128 --index-url https://download.pytorch.org/whl/cu128 && pip install --no-cache-dir -r requirements.txt && MPLBACKEND=Agg python app.py --server-name 0.0.0.0 --port 6969
```

### Jupyter Lab (cellule)
```python
%%bash
apt-get update && apt-get install -y ffmpeg && cd /tmp && wget http://files.portaudio.com/archives/pa_stable_v190700_20210406.tgz && tar -xzf pa_stable_v190700_20210406.tgz && cd portaudio && ./configure && make && make install && ldconfig && cd /workspace && git clone https://github.com/IAHispano/Applio.git && cd Applio && pip install --no-cache-dir torch==2.7.1+cu128 torchaudio==2.7.1+cu128 torchvision==0.22.1+cu128 --index-url https://download.pytorch.org/whl/cu128 && pip install --no-cache-dir -r requirements.txt && MPLBACKEND=Agg python app.py --server-name 0.0.0.0 --port 6969
```

> ⏱️ Durée : ~10-15 min

---

## 3. Accéder à Applio

```
https://[POD-ID]-6969.proxy.runpod.net
```

L'ID du Pod est visible dans RunPod sous le nom du Pod (ex: `vh600cpvmjoqem`).

---

## 4. Relancer Applio (si le terminal se ferme)

```bash
cd /workspace/Applio && MPLBACKEND=Agg python app.py --server-name 0.0.0.0 --port 6969
```

---

## 5. Paramètres de training recommandés

| Paramètre | RTX 3090 (24 Go) | RTX 5090 (31 Go) |
|---|---|---|
| **Sampling Rate** | 40000 | 40000 |
| **Vocoder** | HIFI-GAN | HIFI-GAN |
| **Batch Size** | 16 | 24 |
| **Save Every Epoch** | 25 | 25 |
| **Total Epoch** | 300 | 300 |
| **Pitch Extraction** | RMVPE | RMVPE |

**Dataset** : minimum 10 min d'audio propre (.wav ou .flac, sans bruit de fond)

---

## 6. Récupérer le modèle entraîné

Les modèles sont dans `/workspace/Applio/logs/[NOM_DU_MODELE]/`

Fichiers à télécharger :
- `[nom].pth` — le modèle
- `[nom].index` — l'index (pour la qualité)

**Comment télécharger :**
1. Ouvre Jupyter Lab sur `https://[POD-ID]-8888.proxy.runpod.net`
2. Dans le **panneau gauche** (File Browser), navigue vers `workspace/Applio/logs/[NOM_DU_MODELE]/`
3. **Clic droit** sur le fichier `.pth` → **Download**
4. **Clic droit** sur le fichier `.index` → **Download**

> ⚠️ Télécharge les fichiers **avant de stopper le Pod**, les données sont perdues à l'arrêt si pas de Network Volume.

---

## 7. SSH & téléchargement rapide avec SCP

Pour télécharger les fichiers via SCP (plus rapide que Jupyter), ajoute ta clé SSH **avant** de créer le Pod.

**Ajouter la clé SSH sur RunPod :**
1. Va sur RunPod → **Settings → SSH Public Keys**
2. Colle ta clé publique Mac :
```bash
cat ~/.ssh/id_ed25519.pub
```
3. Clique **Update public key**

> ⚠️ La clé SSH doit être ajoutée **avant** la création du Pod, elle n'est pas appliquée aux Pods déjà existants.

**Télécharger un fichier via SCP depuis ton Mac :**

L'IP et le port TCP sont dans RunPod → **Connect → Direct TCP ports**

```bash
scp -P [PORT] -i ~/.ssh/id_ed25519 root@[IP]:/workspace/Applio/logs/[NOM_MODELE]/[NOM].index ~/Desktop/
scp -P [PORT] -i ~/.ssh/id_ed25519 root@[IP]:/workspace/Applio/logs/[NOM_MODELE]/[NOM].pth ~/Desktop/
```

**Si pas de clé SSH configurée :** télécharge via Jupyter Lab → File Browser → clic droit → Download (plus lent mais fonctionne toujours).

---

## Notes

- L'erreur Discord au lancement est normale, ignore-la
- `MPLBACKEND=Agg` est obligatoire pour éviter le crash matplotlib sur serveur
- Ne pas utiliser `--init_service true` sur ACE-Step (sature la RAM)
- Community Cloud : le GPU peut être repris si le Pod est stoppé → toujours utiliser un Network Volume pour sauvegarder
- La clé SSH doit être ajoutée avant la création du Pod pour fonctionner
