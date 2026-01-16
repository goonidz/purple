# VideoFlow - Architecture Technique

## Vue d'ensemble

VideoFlow utilise une architecture basée sur des **jobs asynchrones** pour gérer les tâches longues (génération de prompts, images, QA, upscale). Cette architecture permet de :
- Traiter plusieurs tâches en parallèle
- Résister aux timeouts des Edge Functions (max ~50s)
- Reprendre les tâches interrompues
- Suivre la progression en temps réel

---

## Architecture des Jobs

### Hiérarchie des Jobs

```
Parent Job (ex: "prompts")
├── Child Job: single_prompt (scene 1)
├── Child Job: single_prompt (scene 2)
├── Child Job: single_prompt (scene 3)
└── ... (jusqu'à 100 en parallèle)
```

### Types de Jobs

| Type | Description | Max Parallèle |
|------|-------------|---------------|
| `prompts` | Job parent pour générer tous les prompts | 1 par projet |
| `single_prompt` | Génère 1 prompt pour 1 scène | 100 |
| `images` | Job parent pour générer toutes les images | 1 par projet |
| `single_image` | Génère 1 image pour 1 scène | 20 |
| `qa` | Job parent pour vérifier toutes les images | 1 par projet |
| `single_qa` | Vérifie 1 image | 100 |
| `upscale` | Job parent pour upscaler toutes les images | 1 par projet |
| `single_upscale` | Upscale 1 image | 20 |

### Cycle de vie d'un Job

```
pending → processing → completed
                    → failed
                    → cancelled
```

### Pattern "Launcher"

Chaque type de job enfant a une fonction launcher qui :
1. Vérifie la capacité disponible (slots libres)
2. Trouve le prochain job `pending`
3. Fait un "atomic claim" (update WHERE status='pending')
4. Lance le job via fetch (fire-and-forget)

```typescript
async function launchNextPendingPromptJob(adminClient) {
  // 1. Check capacity
  const { count } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_prompt');
  
  if (count >= PROMPTS_MAX_CONCURRENT) return;
  
  // 2. Find pending job
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('*')
    .eq('status', 'pending')
    .eq('job_type', 'single_prompt')
    .limit(1);
  
  // 3. Atomic claim
  const { data: claimed } = await adminClient
    .from('generation_jobs')
    .update({ status: 'processing' })
    .eq('id', pendingJobs[0].id)
    .eq('status', 'pending')  // Important: prevents double-claim
    .select();
  
  // 4. Launch
  fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
    body: JSON.stringify({ jobId: claimed.id, ... })
  });
}
```

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
  -- Lock row to prevent concurrent modifications
  SELECT prompts INTO current_prompts
  FROM projects WHERE id = p_project_id
  FOR UPDATE;
  
  -- Update only the specific index
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

---

## Gestion des Timeouts et Interruptions

### Problème : Edge Functions Timeout

Les Edge Functions Supabase peuvent être interrompues à tout moment (shutdown signal). Les jobs en cours sont perdus s'ils ne sont pas gérés.

### Solution : Cleanup des Jobs Bloqués

Avant de créer de nouveaux jobs, on nettoie les anciens :

```typescript
// Jobs stuck in "processing" for > 2 minutes = probably dead
const TWO_MINUTES_AGO = new Date(Date.now() - 2 * 60 * 1000).toISOString();

const { data: stuckJobs } = await adminClient
  .from('generation_jobs')
  .select('id')
  .eq('job_type', 'single_prompt')
  .eq('status', 'processing')
  .lt('updated_at', TWO_MINUTES_AGO);

// Reset to pending for retry
await adminClient
  .from('generation_jobs')
  .update({ status: 'pending' })
  .in('id', stuckJobs.map(j => j.id));
```

### Pattern `EdgeRuntime.waitUntil`

Pour les tâches qui doivent continuer après la réponse HTTP :

```typescript
// Don't await - let it run in background
EdgeRuntime.waitUntil(
  fetch(`${url}/functions/v1/start-generation-job`, { ... })
);
```

---

## Double Source de Vérité

### Historique

VideoFlow utilise deux systèmes de stockage pour les données de scènes :

1. **Legacy JSON** : `projects.prompts` (tableau JSONB)
2. **Table Robuste** : `project_scenes` (une row par scène)

### Pourquoi deux systèmes ?

- Le JSON legacy était le système original
- La table `project_scenes` a été ajoutée pour la robustesse
- Migration progressive : on écrit dans les deux, on lit la table quand possible

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
  // Use project.prompts
}
```

---

## Webhooks et Async Processing

### Pattern pour les appels API longs (Replicate, etc.)

1. **Lancer** : Appeler l'API avec un webhook URL
2. **Tracker** : Créer une entrée `pending_predictions`
3. **Recevoir** : Le webhook reçoit le résultat
4. **Finaliser** : Mettre à jour la DB et lancer le prochain job

```typescript
// 1. Start prediction with webhook
const response = await fetch('https://api.replicate.com/predictions', {
  body: JSON.stringify({
    webhook: `${supabaseUrl}/functions/v1/replicate-webhook`,
    ...
  })
});

// 2. Track prediction
await adminClient.from('pending_predictions').insert({
  prediction_id: response.id,
  job_id: jobId,
  scene_index: sceneIndex,
  status: 'pending'
});

// 3. Webhook receives result (in replicate-webhook/index.ts)
// 4. Update DB and launch next job
```

---

## Chaînage des Jobs

### Pipeline Semi-Automatique

```
prompts → images → qa → [regen if needed] → upscale → thumbnails
```

### Chaînage Conditionnel

Le chaînage vers l'étape suivante est **explicite** :

```typescript
// Only chain if explicitly requested
const shouldChainToImages = parentJob.metadata?.chainToImages === true;
if (shouldChainToImages) {
  fetch(`${url}/functions/v1/start-generation-job`, {
    body: JSON.stringify({ projectId, jobType: 'images' })
  });
}
```

---

## Indicateurs UI

### Pastilles QA

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | QA passé du premier coup |
| 🔵 Bleu | QA passé après régénération |
| 🟠 Orange | En attente de QA |
| 🔴 Rouge | QA rejeté |

### Tracking dans la DB

```typescript
// project_scenes columns
was_regenerated: boolean  // true if scene went through regen
regenerated_prompt: text  // the new prompt used for regen
qa_status: text           // 'OK', 'REJECT', 'ERROR'
```

---

## Bonnes Pratiques

### 1. Toujours utiliser des updates atomiques

```typescript
// ❌ Bad: read-modify-write
const prompts = await getPrompts();
prompts[index] = newPrompt;
await savePrompts(prompts);

// ✅ Good: atomic RPC
await adminClient.rpc('update_prompt_in_array', { ... });
```

### 2. Fire-and-forget pour les jobs

```typescript
// ❌ Bad: await blocks the current function
await fetch(`${url}/functions/v1/start-generation-job`, { ... });

// ✅ Good: fire-and-forget
fetch(`${url}/functions/v1/start-generation-job`, { ... })
  .catch(err => console.error(err));
```

### 3. Idempotence des jobs

Un job doit pouvoir être relancé sans effets de bord :
- Vérifier si le travail n'est pas déjà fait
- Utiliser `upsert` plutôt que `insert`
- Ne pas créer de doublons

### 4. Logs explicites

```typescript
console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Starting`);
console.log(`[processSinglePromptJob] Parent progress: ${progress}/${total}`);
```

---

## Constantes Importantes

```typescript
// Concurrence maximale par type de job
const PROMPTS_MAX_CONCURRENT = 100;
const IMAGES_MAX_CONCURRENT = 20;
const QA_MAX_CONCURRENT = 100;
const UPSCALE_MAX_CONCURRENT = 20;

// Timeouts pour cleanup
const STUCK_JOB_TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes
const STALE_JOB_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes
```

---

## Tables Principales

### `generation_jobs`

| Colonne | Description |
|---------|-------------|
| `id` | UUID du job |
| `project_id` | Projet associé |
| `job_type` | Type de job |
| `status` | pending/processing/completed/failed |
| `progress` | Nombre de tâches complétées |
| `total` | Nombre total de tâches |
| `parent_job_id` | Job parent (pour les child jobs) |
| `scene_index` | Index de scène (pour single_* jobs) |
| `metadata` | Données additionnelles (JSONB) |

### `pending_predictions`

| Colonne | Description |
|---------|-------------|
| `prediction_id` | ID Replicate |
| `job_id` | Job associé |
| `scene_index` | Index de scène |
| `status` | pending/processing/succeeded/failed |
| `prediction_type` | scene_image/upscale/qa |

### `project_scenes`

| Colonne | Description |
|---------|-------------|
| `project_id` | Projet |
| `scene_index` | Index (0-based) |
| `prompt` | Prompt généré |
| `image_url` | URL de l'image |
| `upscaled_url` | URL upscalée |
| `qa_status` | OK/REJECT/ERROR |
| `was_regenerated` | Si régénéré après QA |
| `regenerated_prompt` | Nouveau prompt si régénéré |
