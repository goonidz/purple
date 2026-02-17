# VideoFlow - Architecture Technique

## Vue d'ensemble

VideoFlow utilise une architecture basée sur des **jobs asynchrones** pour gérer les tâches longues (génération de prompts, images, QA, upscale, thumbnails). L'architecture repose sur deux composants principaux :

1. **Supabase Edge Functions** : Orchestrent la création des jobs et le traitement léger (prompts via Gemini)
2. **VPS Image Worker** : Service Node.js sur le VPS qui poll la base de données et exécute les pipelines de génération d'images, thumbnails et prompts avec un contrôle fin de la concurrence

Cette architecture permet de :
- Traiter plusieurs projets en parallèle équitablement (round-robin)
- Contrôler la concurrence globale (20 jobs simultanés max)
- Résister aux timeouts des Edge Functions
- Annuler proprement une génération en cours
- Suivre la progression en temps réel

---

## Architecture des Jobs

### Hiérarchie Parent-Enfant

```
Parent Job (ex: "images")
├── Child Job: single_image (scene 1)     ← Traité par le VPS Worker
├── Child Job: single_image (scene 2)     ← Traité par le VPS Worker
├── Child Job: single_image (scene 3)     ← Traité par le VPS Worker
└── ... (jusqu'à 118+ par projet)

Parent Job (ex: "prompts")
├── Child Job: single_prompt (scene 1)    ← Dispatché par le VPS Worker → Edge Function
├── Child Job: single_prompt (scene 2)
└── ...

Parent Job (ex: "thumbnails")             ← Traité directement par le VPS Worker
```

### Types de Jobs

| Type | Description | Traitement | Concurrence |
|------|-------------|------------|-------------|
| `prompts` | Job parent pour générer tous les prompts | Edge Function crée les enfants | 1 par projet |
| `single_prompt` | Génère 1 prompt pour 1 scène | VPS Worker → dispatch vers Edge Function | Pool de 20 |
| `images` | Job parent pour générer toutes les images | Edge Function crée les enfants | 1 par projet |
| `single_image` | Pipeline complet : génération + upload + QA + upscale | VPS Worker (Replicate + Gemini) | Pool de 20 |
| `single_upscale` | Upscale 1 image | Créé par le VPS Worker pendant le pipeline | Inline |
| `thumbnails` | Génère 3 miniatures pour le projet | VPS Worker (prompts Gemini + Replicate) | Pool de 20 |

### Cycle de vie d'un Job

```
pending → processing → completed
                    → failed
                    → cancelled
```

---

## VPS Image Worker (`image-worker/index.js`)

### Rôle

Le VPS Image Worker est un service Node.js géré par PM2 qui :
1. **Poll** la table `generation_jobs` toutes les 3 secondes
2. **Claim** les jobs `pending` de manière atomique
3. **Exécute** le pipeline complet (génération → upload → QA → upscale)
4. **Met à jour** la progression du parent et les données de la scène

### Concurrence et Round-Robin

Le worker maintient un pool de **20 slots** maximum. Quand des slots se libèrent, il :

1. Fetch jusqu'à 100 jobs `pending` (tous types confondus)
2. **Filtre** les jobs dont le parent est annulé (les marque `cancelled`)
3. **Groupe** par `project_id`
4. **Distribue équitablement** via round-robin : 1 job du projet A, 1 du projet B, 1 du A, 1 du B, etc.
5. **Claim** chaque job de manière atomique (`UPDATE ... WHERE status = 'pending'`)

```javascript
// Round-robin: chaque projet reçoit sa part des slots
const byProject = new Map();
for (const job of validJobs) {
  const pid = job.project_id || 'none';
  if (!byProject.has(pid)) byProject.set(pid, []);
  byProject.get(pid).push(job);
}

const fairJobs = [];
const projectQueues = [...byProject.values()];
let idx = 0;
while (fairJobs.length < availableSlots && projectQueues.some(q => q.length > 0)) {
  const queue = projectQueues[idx % projectQueues.length];
  if (queue.length > 0) fairJobs.push(queue.shift());
  idx++;
}
```

**Résultat** : Avec 4 projets et 20 slots, chaque projet reçoit ~5 slots par cycle.

### Pipeline `single_image`

```
1. Get Replicate API key (cached)
2. Build input & generate image (Replicate polling)
3. Upload to Supabase Storage (in-memory, pas d'écriture disque)
4. Update project_scenes
5. Mark single_image completed, update parent progress
6. ── CHECK: job annulé ? → stop ──
7. QA check (Gemini 2.0 Flash)
8. Update QA result in DB
9. ── CHECK: job annulé ? → stop ──
10. Handle QA result:
    - OK → upscale (ou skip si Seedream)
    - REJECT (1ère fois) → créer regen job
    - REJECT (2ème fois) → forcer OK, upscale
11. Update parent progress, check parent completion
```

### Pipeline `thumbnails`

```
1. Get API keys
2. Call generate-thumbnail-prompts Edge Function (3 prompts)
3. Generate 3 images via Replicate (polling)
4. Upload each to Supabase Storage
5. Update generation_jobs metadata + insert into generated_thumbnails
6. Mark job completed
```

### Pipeline `single_prompt`

```
1. Dispatch vers start-generation-job Edge Function via HTTP
2. L'Edge Function traite le prompt (Gemini) et met à jour la DB
3. Worker marque le job completed/failed selon la réponse
```

### Annulation de Jobs

L'annulation fonctionne à 3 niveaux :

1. **Frontend** (`cancelJob` dans `useGenerationJobs.ts`) :
   - Met le parent à `cancelled`
   - Met tous les enfants `pending`/`processing` à `cancelled` via `parent_job_id`

2. **Worker - Polling** (avant de prendre un job) :
   - Vérifie si le parent de chaque job est `cancelled`
   - Si oui, marque les orphelins `cancelled` automatiquement
   - Ne les traite jamais

3. **Worker - Mid-pipeline** (pendant le traitement) :
   - Vérifie le statut du parent avant QA et avant upscale
   - Si annulé, arrête immédiatement sans gaspiller d'appels API

---

## Gestion des Race Conditions

### Problème : Mise à jour du JSON `projects.prompts`

Quand plusieurs jobs mettent à jour le même tableau JSON en parallèle :

```
Job A: read prompts → [null, null, null]
Job B: read prompts → [null, null, null]
Job A: write prompts[0] = "prompt A" → [A, null, null]
Job B: write prompts[1] = "prompt B" → [null, B, null]  // ❌ Écrase A !
```

### Solution : RPC Atomique avec `FOR UPDATE`

```sql
CREATE FUNCTION update_prompt_in_array(p_project_id, p_scene_index, p_prompt)
RETURNS VOID AS $$
BEGIN
  SELECT prompts INTO current_prompts
  FROM projects WHERE id = p_project_id
  FOR UPDATE;
  
  current_prompts := jsonb_set(current_prompts, ARRAY[p_scene_index], ...);
  
  UPDATE projects SET prompts = current_prompts WHERE id = p_project_id;
END;
$$
```

### Fonctions RPC Atomiques

| Fonction | Usage |
|----------|-------|
| `update_prompt_in_array` | Sauvegarde un prompt sans écraser les autres |
| `update_prompt_qa_status` | Met à jour le statut QA d'une scène |

### Atomic Job Claiming

Le worker utilise `UPDATE ... WHERE status = 'pending' ... RETURNING id` pour garantir qu'un seul process claim chaque job :

```javascript
const { data: claimed } = await supabase
  .from('generation_jobs')
  .update({ status: 'processing', updated_at: new Date().toISOString() })
  .eq('id', job.id)
  .eq('status', 'pending')  // Atomique : échoue si déjà claimé
  .select('id')
  .single();
```

---

## Double Source de Vérité

### Historique

VideoFlow utilise deux systèmes de stockage pour les données de scènes :

1. **Legacy JSON** : `projects.prompts` (tableau JSONB)
2. **Table Robuste** : `project_scenes` (une row par scène)

### Stratégie d'écriture

```typescript
// 1. Write to project_scenes (robust, atomic)
await adminClient
  .from('project_scenes')
  .upsert({ project_id, scene_index, prompt, ... });

// 2. Write to legacy JSON (for backward compatibility)
await adminClient.rpc('update_prompt_in_array', { ... });
```

### Stratégie de lecture

```typescript
// 1. Try project_scenes first
const { data: scenes } = await supabase
  .from('project_scenes')
  .select('*')
  .eq('project_id', projectId);

// 2. Fallback to legacy JSON if empty
if (!scenes?.length) {
  const { data: project } = await supabase
    .from('projects')
    .select('prompts')
    .eq('id', projectId);
}
```

---

## Chaînage des Jobs

### Pipeline Semi-Automatique

```
prompts → images → [QA + regen if needed] → upscale
                                                    (thumbnails en parallèle si configuré)
```

### Chaînage Conditionnel

Le chaînage vers l'étape suivante est **explicite** via `metadata.chainToImages` :

```typescript
const shouldChainToImages = parentJob.metadata?.chainToImages === true;
if (shouldChainToImages) {
  // Crée un job "images" qui sera traité par le worker
}
```

---

## Indicateurs UI

### Pastilles de statut

| Badge | Couleur | Signification |
|-------|---------|---------------|
| ✓ Check | 🟢 Vert | QA passé du premier coup |
| ✓ Check | 🔵 Bleu | QA passé après régénération automatique |
| ↺ RotateCcw | 🔵 Bleu | Image régénérée automatiquement par le QA |
| ℹ Info | 🟠 Orange | Image régénérée manuellement par l'utilisateur |
| ⚠ AlertCircle | 🔴 Rouge | QA rejeté (avec raison) |

### Distinction manuelle vs QA

- `manually_regenerated` (JSON legacy) : L'utilisateur a cliqué "Régénérer" → pastille orange
- `was_regenerated` (colonne `project_scenes`) : Le QA a rejeté et régénéré → pastille bleue
- Ces deux flags sont **indépendants** pour éviter les faux positifs

---

## Tables Principales

### `generation_jobs`

| Colonne | Description |
|---------|-------------|
| `id` | UUID du job |
| `project_id` | Projet associé |
| `user_id` | Utilisateur propriétaire |
| `job_type` | Type de job (voir tableau ci-dessus) |
| `status` | pending / processing / completed / failed / cancelled |
| `progress` | Nombre de tâches complétées |
| `total` | Nombre total de tâches |
| `parent_job_id` | Job parent (pour les child jobs) |
| `scene_index` | Index de scène (pour single_* jobs) |
| `is_regen` | true si c'est une régénération QA |
| `metadata` | Données additionnelles (JSONB) |
| `created_at` | Date de création |
| `updated_at` | Dernière mise à jour |
| `completed_at` | Date de complétion |

### `project_scenes`

| Colonne | Description |
|---------|-------------|
| `project_id` | Projet |
| `scene_index` | Index (0-based) |
| `prompt` | Prompt généré |
| `image_url` | URL de l'image |
| `upscaled_url` | URL upscalée |
| `qa_status` | OK / REJECT / ERROR |
| `qa_checked` | Si le QA a été fait |
| `qa_explication` | Raison du rejet |
| `was_regenerated` | Si régénéré après QA |
| `regenerated_prompt` | Nouveau prompt si régénéré |

### `generated_thumbnails`

| Colonne | Description |
|---------|-------------|
| `project_id` | Projet |
| `image_url` | URL de la miniature |
| `prompt` | Prompt utilisé |
| `model` | Modèle Replicate utilisé |

---

## Infrastructure VPS

### Services PM2

| Service | Port | Description |
|---------|------|-------------|
| `image-worker` | - | Worker de génération d'images/prompts/thumbnails (polling) |
| `video-render-service` | 3000 | Rendu vidéo FFmpeg |
| `video-storage-api` | 3001 | Upload vidéo depuis RunPod |
| `webhook-deploy` | 9000 | Déploiement auto GitHub |

### Image Worker - Configuration

```bash
# Répertoire : ~/purple/image-worker/
# Variables d'environnement (.env) :
SUPABASE_URL=https://laqgmqyjstisipsbljha.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

# Constantes dans index.js :
MAX_CONCURRENT = 20        # Slots parallèles
POLL_INTERVAL_MS = 3000    # Intervalle de polling (3s)
```

### Déploiement du Worker

```bash
# Depuis la machine locale :
scp image-worker/index.js ubuntu@51.91.158.233:~/purple/image-worker/index.js
ssh vps-clean "pm2 restart image-worker"

# Vérifier les logs :
ssh vps-clean "pm2 logs image-worker --lines 20 --nostream"
```

---

## Supabase Edge Functions

### Fonctions principales

| Fonction | Rôle |
|----------|------|
| `start-generation-job` | Orchestrateur : crée le parent + les enfants `pending` |
| `qa-image-gemini` | Analyse QA d'une image (Gemini 2.0 Flash) |
| `generate-thumbnail-prompts` | Génère 3 prompts créatifs pour les miniatures |
| `check-stuck-jobs` | Cron : nettoie les jobs bloqués depuis > 5 min |

### Flux de création d'un job

```
1. Frontend appelle start-generation-job (jobType: 'images')
2. Edge Function crée le parent job (status: 'processing')
3. Edge Function crée N enfants single_image (status: 'pending')
4. Edge Function retourne → WEBHOOK_MODE_ACTIVE
5. VPS Worker poll → trouve les enfants pending → les traite
6. Quand tous les enfants sont done → parent marqué 'completed'
```

---

## Bonnes Pratiques

### 1. Toujours utiliser des updates atomiques

```typescript
// ❌ Bad: read-modify-write (race condition)
const prompts = await getPrompts();
prompts[index] = newPrompt;
await savePrompts(prompts);

// ✅ Good: atomic RPC
await adminClient.rpc('update_prompt_in_array', { ... });
```

### 2. In-memory processing sur le VPS

Le worker ne écrit **jamais** de fichiers temporaires sur le disque. Les images sont fetch en mémoire, uploadées directement à Supabase Storage :

```javascript
const response = await fetch(imageUrl);
const buffer = Buffer.from(await response.arrayBuffer());
await supabase.storage.from('images').upload(path, buffer);
```

### 3. Idempotence des jobs

Un job doit pouvoir être relancé sans effets de bord :
- Vérifier si le travail n'est pas déjà fait
- Utiliser `upsert` plutôt que `insert`
- Ne pas créer de doublons

### 4. Logs explicites

```javascript
log(`Processing scene ${sceneIndex + 1} (job ${jobId.substring(0, 8)}...) [REGEN]`);
log(`  Scene 42: QA -> REJECT (texte visible)`);
log(`Found 200 pending jobs from 4 project(s), picking 20 (active: 0/20)`);
```
