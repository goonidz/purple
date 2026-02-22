require('dotenv').config();
const Replicate = require('replicate');
const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// CONFIGURATION
// ============================================================================
const MAX_CONCURRENT = 20;
const POLL_INTERVAL_MS = 3000;
const REPLICATE_POLL_MS = 2000;
const REPLICATE_TIMEOUT_MS = 5 * 60 * 1000;
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================================
// STATE
// ============================================================================
let activeJobs = 0;
const apiKeyCache = new Map();

// ============================================================================
// QA PROMPT (from qa-image-gemini/index.ts)
// ============================================================================
const QA_PROMPT = `Tu es un expert QA qui détecte UNIQUEMENT les erreurs TECHNIQUES de génération d'image cartoon.

========================================
TA MISSION : DÉTECTER DES BUGS, PAS VÉRIFIER DES CONSIGNES
========================================

Tu ne dois PAS vérifier si l'image respecte les instructions du prompt source. Ignore complètement "no text", "avoid text", ou toute autre consigne.

Ton rôle : détecter si l'IA a produit un BUG TECHNIQUE visible.

========================================
RÈGLE SUR LE TEXTE (ULTRA-SIMPLE)
========================================

- Texte LISIBLE (peu importe le contenu) = PAS UN BUG = status: "OK"
- Texte ILLISIBLE/GRIBOUILLIS (lettres mélangées, symboles aléatoires) = BUG = status: "REJECT"

Exemples de texte LISIBLE (TOUS acceptables) :
- Mots réels : "NVIDIA", "Amazon", "BORING", "OPEN", "Hello", "2024"
- Symboles : "$", "€", "+", "✓", "✗"
- Logos de marques
- Panneaux, affiches, enseignes
- Tout texte dont on peut lire les lettres

Exemples de texte ILLISIBLE (à rejeter) :
- "NVIDI@#$A", "am@z0n##", "B0R!N6#"
- Lettres déformées, fondues, incompréhensibles

========================================
RÈGLE SUR L'ANATOMIE
========================================

- Membres EN TROP (3 bras, 6 doigts, 3 jambes) = BUG = status: "REJECT"
- Membre détaché du corps ou traversant un objet = BUG = status: "REJECT"
- Personnage sans visage ou simplifié = PAS UN BUG = status: "OK"

========================================
RÈGLE SUR LE CADRAGE
========================================

- Bandes NOIRES sur les côtés, en haut ou en bas = BUG = status: "REJECT"
- L'image doit prendre TOUT l'écran, pas de letterbox/pillarbox
- Marges blanches/colorées normales = OK
- Seules les bandes NOIRES épaisses sont un problème

========================================
PROMPT DE RÉGÉNÉRATION (SI REJECT)
========================================

Si tu dois rejeter (status: "REJECT"), ton prompt de régénération DOIT :
1. GARDER LA MÊME STRUCTURE que le prompt source
2. GARDER LE MÊME DÉBUT (style, character description, etc.)
3. CHANGER UNIQUEMENT la scène visuelle pour éviter le bug

Exemple :
- Prompt source : "simple 2D cartoon illustration by using the same style and character I sent you, showing him looking at a broken calculator, clean white background"
- Prompt régénération : "simple 2D cartoon illustration by using the same style and character I sent you, showing him looking at a handheld device with a grid of small empty squares, clean white background"

GARDE TOUJOURS : "simple 2D cartoon illustration by using the same style and character I sent you, showing"
CHANGE UNIQUEMENT : la description de la scène après "showing"

========================================
FORMAT DE RÉPONSE JSON
========================================

Réponds UNIQUEMENT avec ce format JSON :
{
"status": "OK" ou "REJECT",
"anomalie_detectee": "anatomie" | "texte" | "aucune",
"explication": "Brève description du BUG TECHNIQUE si REJECT, sinon chaîne vide",
"prompt_regeneration": "Prompt avec EXACTEMENT la même structure que le prompt source si REJECT, sinon chaîne vide"
}

========================================
CONTEXTE
========================================

Prompt source qui a généré l'image :
(variable qui insère le prompt lié à l'image)

Note : Le prompt source peut contenir "no text" ou "avoid text". IGNORE-LE complètement. Il ne définit PAS ce qui est un bug.`;

// ============================================================================
// MODEL CONFIGURATION (from generate-image-seedream/index.ts)
// ============================================================================
const MODEL_MAP = {
  'seedream-4': 'bytedance/seedream-4',
  'seedream-4.5': 'bytedance/seedream-4.5',
  'z-image-turbo': 'prunaai/z-image-turbo',
  'z-image-turbo-lora': 'prunaai/z-image-turbo-lora',
};

const UPSCALE_MODEL = 'daanelson/real-esrgan-a100';

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg, ...args) {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] ${msg}`, ...args);
}

function logError(msg, ...args) {
  const ts = new Date().toISOString().substring(11, 23);
  console.error(`[${ts}] ERROR: ${msg}`, ...args);
}

// ============================================================================
// API KEY MANAGEMENT (cached per user)
// ============================================================================

async function getUserApiKey(userId, keyName) {
  const cacheKey = `${userId}:${keyName}`;
  const cached = apiKeyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < API_KEY_CACHE_TTL_MS) {
    return cached.value;
  }

  const rpcName = keyName === 'gemini' ? 'get_user_api_key' : 'get_user_api_key_for_service';
  const params = keyName === 'gemini'
    ? { key_name: keyName, p_user_id: userId }
    : { target_user_id: userId, key_name: keyName };

  const { data, error } = await supabase.rpc(rpcName, params);
  if (error || !data) {
    throw new Error(`Failed to get ${keyName} API key for user ${userId}: ${error?.message || 'not found'}`);
  }

  apiKeyCache.set(cacheKey, { value: data, ts: Date.now() });
  return data;
}

// ============================================================================
// REPLICATE: BUILD INPUT (from generate-image-seedream/index.ts)
// ============================================================================

function buildReplicateInput(metadata) {
  const modelVersion = metadata.model || 'seedream-4.5';
  let width = metadata.width || 1920;
  let height = metadata.height || 1080;

  const sanitizePrompt = (p) => typeof p === 'string' ? p.replace(/dead/gi, '') : p;
  const prompt = sanitizePrompt(metadata.prompt);

  // Z-Image dimension constraints
  if (modelVersion === 'z-image-turbo' || modelVersion === 'z-image-turbo-lora') {
    const MAX_DIM = 1440;
    if (width > MAX_DIM || height > MAX_DIM) {
      const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }
    width = Math.round(width / 16) * 16;
    height = Math.round(height / 16) * 16;
  }

  // SeedDream 4.5 minimum pixel constraint
  if (modelVersion === 'seedream-4.5') {
    const MIN_PIXELS = 3686400;
    const currentPixels = width * height;
    if (currentPixels < MIN_PIXELS) {
      const scaleFactor = Math.sqrt(MIN_PIXELS / currentPixels);
      width = Math.ceil(width * scaleFactor);
      height = Math.ceil(height * scaleFactor);
      width = width % 2 === 0 ? width : width + 1;
      height = height % 2 === 0 ? height : height + 1;
    }
  }

  const input = { prompt };

  if (modelVersion === 'z-image-turbo') {
    input.width = width;
    input.height = height;
    input.guidance_scale = 0;
    input.num_inference_steps = 8;
  } else if (modelVersion === 'z-image-turbo-lora') {
    input.width = width;
    input.height = height;
    input.guidance_scale = 0;
    input.num_inference_steps = metadata.loraSteps || 10;
    input.output_format = 'jpg';
    input.output_quality = 80;
    if (metadata.loraUrl) {
      const weights = Array.isArray(metadata.loraUrl) ? metadata.loraUrl : [metadata.loraUrl];
      input.lora_weights = weights;
      input.lora_scales = new Array(weights.length).fill(1.0);
    }
  } else {
    // SeedDream models
    input.size = 'custom';
    input.width = width;
    input.height = height;
    if (metadata.styleRefs && metadata.styleRefs.length > 0) {
      input.image_input = metadata.styleRefs;
    }
  }

  return { input, modelName: MODEL_MAP[modelVersion] || MODEL_MAP['seedream-4.5'] };
}

// ============================================================================
// REPLICATE: CREATE + POLL PREDICTION (no webhook)
// ============================================================================

async function runReplicatePrediction(replicateClient, modelName, input) {
  const [owner, name] = modelName.split('/');
  const modelInfo = await replicateClient.models.get(owner, name);
  const latestVersion = modelInfo.latest_version?.id;
  if (!latestVersion) {
    throw new Error(`Could not find latest version for model: ${modelName}`);
  }

  const prediction = await replicateClient.predictions.create({
    version: latestVersion,
    input,
  });

  log(`  Prediction ${prediction.id} created (${modelName})`);

  const startTime = Date.now();
  let result = prediction;

  while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled') {
    if (Date.now() - startTime > REPLICATE_TIMEOUT_MS) {
      throw new Error(`Prediction ${prediction.id} timed out after ${REPLICATE_TIMEOUT_MS / 1000}s`);
    }
    await sleep(REPLICATE_POLL_MS);
    result = await replicateClient.predictions.get(prediction.id);
  }

  if (result.status !== 'succeeded') {
    throw new Error(`Prediction ${prediction.id} ${result.status}: ${result.error || 'unknown error'}`);
  }

  return result;
}

// ============================================================================
// SUPABASE STORAGE: UPLOAD IMAGE
// ============================================================================

async function uploadImageToStorage(imageUrl, projectId, filename) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const storagePath = `${projectId}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from('generated-images')
    .upload(storagePath, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from('generated-images')
    .getPublicUrl(storagePath);

  return publicUrl;
}

// ============================================================================
// QA: CALL GEMINI DIRECTLY
// ============================================================================

async function runQACheck(geminiKey, imageUrl, sourcePrompt, qaPrompt) {
  let promptToUse = qaPrompt || QA_PROMPT;

  if (sourcePrompt) {
    promptToUse = promptToUse.replace(
      "(variable qui insère le prompt lié à l'image)",
      sourcePrompt
    );
  } else {
    promptToUse = promptToUse.replace(
      "Prompt source qui a généré l'image que tu as reçu :\n\n(variable qui insère le prompt lié à l'image)\n\n",
      ''
    );
  }

  // Fetch image as base64
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) {
    throw new Error(`Failed to fetch image for QA: ${imgResponse.status}`);
  }
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
  const base64 = imgBuffer.toString('base64');

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptToUse },
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['OK', 'REJECT'] },
              anomalie_detectee: { type: 'string', enum: ['aucune', 'anatomie', 'texte', 'cadrage'] },
              explication: { type: 'string' },
              prompt_regeneration: { type: 'string' },
            },
            required: ['status', 'anomalie_detectee', 'explication', 'prompt_regeneration'],
          },
        },
      }),
    }
  );

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text();
    throw new Error(`Gemini API error ${geminiResponse.status}: ${errText.substring(0, 300)}`);
  }

  const geminiResult = await geminiResponse.json();
  const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) {
    throw new Error('No response text from Gemini');
  }

  return JSON.parse(responseText);
}

// ============================================================================
// DB: UPDATE SCENE IMAGE
// ============================================================================

async function updateSceneImage(projectId, sceneIndex, publicUrl, metadata) {
  const updateData = {
    image_url: publicUrl,
    image_width: metadata.width || null,
    image_height: metadata.height || null,
    upscaled_url: null,
    is_upscaled: false,
    qa_status: null,
    qa_checked: false,
    qa_explication: null,
    qa_regeneration_prompt: null,
    updated_at: new Date().toISOString(),
  };

  if (metadata.is_regen) {
    updateData.regenerated_prompt = metadata.prompt;
    updateData.was_regenerated = true;
  }

  const { error } = await supabase
    .from('project_scenes')
    .update(updateData)
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex);

  if (error) {
    logError(`Failed to update project_scenes for scene ${sceneIndex + 1}:`, error.message);
  }

  // Sync imageUrl back to projects.prompts JSON to prevent desync
  try {
    const { data: project } = await supabase
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();
    
    if (project?.prompts && Array.isArray(project.prompts) && sceneIndex < project.prompts.length) {
      const prompts = [...project.prompts];
      if (!prompts[sceneIndex]) prompts[sceneIndex] = {};
      prompts[sceneIndex] = { ...prompts[sceneIndex], imageUrl: publicUrl, upscaledUrl: null };
      await supabase.from('projects').update({ prompts }).eq('id', projectId);
    }
  } catch (e) {
    logError(`Failed to sync imageUrl to projects.prompts for scene ${sceneIndex + 1}:`, e.message);
  }
}

// ============================================================================
// DB: UPDATE QA RESULT
// ============================================================================

async function updateSceneQA(projectId, sceneIndex, qaResult) {
  const status = qaResult.status === 'OK' ? 'OK' : (qaResult.status === 'REJECT' ? 'REJECT' : 'OK');

  const { error } = await supabase
    .from('project_scenes')
    .update({
      qa_checked: true,
      qa_status: status,
      qa_explication: qaResult.explication || null,
      qa_regeneration_prompt: qaResult.prompt_regeneration || null,
      updated_at: new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex);

  if (error) {
    logError(`Failed to update QA for scene ${sceneIndex + 1}:`, error.message);
  }

  // Also update legacy JSON via RPC (best-effort)
  try {
    await supabase.rpc('update_prompt_qa_status', {
      p_project_id: projectId,
      p_scene_index: sceneIndex,
      p_qa_checked: true,
      p_qa_status: status,
      p_qa_explication: qaResult.explication || null,
      p_qa_regeneration_prompt: qaResult.prompt_regeneration || null,
    });
  } catch (_) {}
}

// ============================================================================
// DB: UPDATE UPSCALED IMAGE
// ============================================================================

async function updateSceneUpscale(projectId, sceneIndex, upscaledUrl) {
  const { error } = await supabase
    .from('project_scenes')
    .update({
      upscaled_url: upscaledUrl,
      is_upscaled: true,
      updated_at: new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex);

  if (error) {
    logError(`Failed to update upscale for scene ${sceneIndex + 1}:`, error.message);
  }

  // Sync upscaledUrl back to projects.prompts JSON
  try {
    const { data: project } = await supabase
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();
    
    if (project?.prompts && Array.isArray(project.prompts) && sceneIndex < project.prompts.length) {
      const prompts = [...project.prompts];
      if (!prompts[sceneIndex]) prompts[sceneIndex] = {};
      prompts[sceneIndex] = { ...prompts[sceneIndex], upscaledUrl };
      await supabase.from('projects').update({ prompts }).eq('id', projectId);
    }
  } catch (e) {
    logError(`Failed to sync upscaledUrl to projects.prompts for scene ${sceneIndex + 1}:`, e.message);
  }
}

// ============================================================================
// DB: UPDATE PARENT JOB PROGRESS (from start-generation-job)
// ============================================================================

async function updateParentProgress(parentJobId) {
  const { data: parentJob } = await supabase
    .from('generation_jobs')
    .select('total, metadata, project_id')
    .eq('id', parentJobId)
    .single();

  if (!parentJob || !parentJob.project_id) return;

  const projectId = parentJob.project_id;
  const total = parentJob.total || 0;
  const sceneIndices = parentJob.metadata?.sceneIndices;
  const isManualRegen = sceneIndices && Array.isArray(sceneIndices) && sceneIndices.length > 0;

  let imgDone = 0, qaDone = 0, upscaleDone = 0;

  if (isManualRegen) {
    const { data: scenes } = await supabase
      .from('project_scenes')
      .select('scene_index, image_url, qa_status, upscaled_url')
      .eq('project_id', projectId)
      .in('scene_index', sceneIndices);

    if (scenes) {
      imgDone = scenes.filter(s => s.image_url).length;
      qaDone = scenes.filter(s => s.qa_status).length;
      upscaleDone = scenes.filter(s => s.upscaled_url).length;
    }
  } else {
    const [imgRes, qaRes, upRes] = await Promise.all([
      supabase.from('project_scenes').select('id', { count: 'exact', head: true })
        .eq('project_id', projectId).not('image_url', 'is', null),
      supabase.from('project_scenes').select('id', { count: 'exact', head: true })
        .eq('project_id', projectId).not('qa_status', 'is', null),
      supabase.from('project_scenes').select('id', { count: 'exact', head: true })
        .eq('project_id', projectId).not('upscaled_url', 'is', null),
    ]);
    imgDone = imgRes.count || 0;
    qaDone = qaRes.count || 0;
    upscaleDone = upRes.count || 0;
  }

  const newMetadata = {
    ...(parentJob.metadata || {}),
    progress_images: imgDone,
    progress_qa: qaDone,
    progress_upscale: upscaleDone,
    total_scenes: total,
  };

  await supabase
    .from('generation_jobs')
    .update({ metadata: newMetadata, updated_at: new Date().toISOString() })
    .eq('id', parentJobId);
}

// ============================================================================
// DB: CHECK IF PARENT IS FULLY COMPLETE
// ============================================================================

async function checkParentCompletion(parentJobId) {
  const { data: parent } = await supabase
    .from('generation_jobs')
    .select('id, status, total, project_id, metadata')
    .eq('id', parentJobId)
    .single();

  if (!parent || parent.status !== 'processing') return;

  // Count all children (any type) that are still pending/processing
  const { count: activeChildren } = await supabase
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('parent_job_id', parentJobId)
    .in('status', ['pending', 'processing']);

  if ((activeChildren || 0) === 0) {
    log(`Parent ${parentJobId} complete: all children done`);
    await supabase
      .from('generation_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', parentJobId)
      .eq('status', 'processing');
  }
}

// ============================================================================
// DB: CREATE REGEN JOB (when QA rejects)
// ============================================================================

async function createRegenJob(projectId, userId, sceneIndex, parentJobId, qaResult) {
  const { data: project } = await supabase
    .from('projects')
    .select('prompts, image_model, image_width, image_height, style_reference_url, lora_url, lora_steps, preset_id')
    .eq('id', projectId)
    .single();

  if (!project) return;

  let loraUrl = project.lora_url || null;
  let loraSteps = project.lora_steps || 10;
  if (!loraUrl && project.preset_id) {
    const { data: preset } = await supabase
      .from('presets')
      .select('lora_url, lora_steps')
      .eq('id', project.preset_id)
      .single();
    if (preset?.lora_url) {
      loraUrl = preset.lora_url;
      loraSteps = preset.lora_steps || 10;
    }
  }

  const prompts = (project.prompts) || [];
  const originalPrompt = prompts[sceneIndex]?.prompt || '';
  const newPrompt = qaResult?.prompt_regeneration || originalPrompt;

  let styleReferenceUrls = [];
  if (project.style_reference_url) {
    try {
      styleReferenceUrls = JSON.parse(project.style_reference_url);
    } catch {
      styleReferenceUrls = [project.style_reference_url];
    }
  }

  // Z-Image 16:9 detection
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
  if (isZImage) {
    const ratio = imageWidth / imageHeight;
    if (Math.abs(ratio - (16 / 9)) < 0.1) {
      imageWidth = 960;
      imageHeight = 544;
    }
  }

  const { error } = await supabase
    .from('generation_jobs')
    .insert({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_image',
      status: 'pending',
      progress: 0,
      total: 1,
      scene_index: sceneIndex,
      parent_job_id: parentJobId,
      is_regen: true,
      metadata: {
        prompt: newPrompt,
        model: imageModel,
        width: imageWidth,
        height: imageHeight,
        styleRefs: styleReferenceUrls,
        loraUrl: loraUrl || null,
        loraSteps: loraSteps || 10,
        is_regen: true,
        original_prompt: originalPrompt,
        qa_rejection_reason: qaResult?.explication || 'QA rejection',
        useWebhook: false,
      },
    });

  if (error) {
    logError(`Failed to create regen job for scene ${sceneIndex + 1}:`, error.message);
  } else {
    log(`  Created regen job for scene ${sceneIndex + 1}`);
  }
}

// ============================================================================
// DB: CREATE COMPLETED UPSCALE JOB (for Seedream - no upscale needed)
// ============================================================================

async function createCompletedUpscaleJob(projectId, userId, sceneIndex, parentJobId) {
  await supabase
    .from('generation_jobs')
    .insert({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_upscale',
      status: 'completed',
      progress: 1,
      total: 1,
      scene_index: sceneIndex,
      parent_job_id: parentJobId,
      completed_at: new Date().toISOString(),
      metadata: { skipped: true, reason: 'Seedream model - already high-res' },
    });
}

// ============================================================================
// HELPER: Check if a job or its parent has been cancelled
// ============================================================================

async function isJobCancelled(jobId, parentJobId) {
  if (parentJobId) {
    const { data } = await supabase
      .from('generation_jobs')
      .select('status')
      .eq('id', parentJobId)
      .single();
    if (data?.status === 'cancelled') return true;
  }
  const { data } = await supabase
    .from('generation_jobs')
    .select('status')
    .eq('id', jobId)
    .single();
  return data?.status === 'cancelled';
}

// ============================================================================
// MAIN PIPELINE: Process one single_image job end-to-end
// ============================================================================

async function processImagePipeline(job) {
  const { id: jobId, project_id: projectId, user_id: userId, scene_index: sceneIndex, metadata, parent_job_id: parentJobId } = job;
  const isRegen = job.is_regen === true || metadata?.is_regen === true;

  log(`Processing scene ${sceneIndex + 1} (job ${jobId.substring(0, 8)}...) ${isRegen ? '[REGEN]' : ''}`);

  try {
    // ---- STEP 1: Get user's Replicate API key ----
    const replicateKey = await getUserApiKey(userId, 'replicate');
    const replicateClient = new Replicate({ auth: replicateKey });

    // ---- STEP 2: Build input & generate image ----
    const { input, modelName } = buildReplicateInput(metadata);
    log(`  Scene ${sceneIndex + 1}: generating with ${metadata.model || 'seedream-4.5'}...`);

    const result = await runReplicatePrediction(replicateClient, modelName, input);
    const imageOutput = Array.isArray(result.output) ? result.output[0] : result.output;

    if (!imageOutput) {
      throw new Error('No image output from Replicate');
    }

    // ---- STEP 3: Upload to Supabase Storage ----
    const timestamp = Date.now();
    const filename = `scene_${sceneIndex + 1}_${timestamp}.jpg`;
    const publicUrl = await uploadImageToStorage(imageOutput, projectId, filename);
    log(`  Scene ${sceneIndex + 1}: uploaded -> ${publicUrl.substring(0, 80)}...`);

    // ---- STEP 4: Update project_scenes ----
    await updateSceneImage(projectId, sceneIndex, publicUrl, metadata);

    // ---- STEP 5: Mark single_image job completed ----
    await supabase
      .from('generation_jobs')
      .update({ status: 'completed', progress: 1, completed_at: new Date().toISOString() })
      .eq('id', jobId);

    // ---- STEP 6: Update parent progress ----
    if (parentJobId) {
      await updateParentProgress(parentJobId);
    }

    // ---- CHECK: Abort if cancelled ----
    if (await isJobCancelled(jobId, parentJobId)) {
      log(`  Scene ${sceneIndex + 1}: CANCELLED, skipping QA/upscale`);
      return;
    }

    // ---- STEP 7: QA check ----
    let qaResult = { status: 'OK', anomalie_detectee: 'aucune', explication: '', prompt_regeneration: '' };
    try {
      const geminiKey = await getUserApiKey(userId, 'gemini');

      // Get QA prompt from parent job metadata if available
      let qaPrompt = null;
      if (parentJobId) {
        const { data: parentData } = await supabase
          .from('generation_jobs')
          .select('metadata')
          .eq('id', parentJobId)
          .single();
        qaPrompt = parentData?.metadata?.qaPrompt || null;
      }

      qaResult = await runQACheck(geminiKey, publicUrl, metadata.prompt, qaPrompt);
      log(`  Scene ${sceneIndex + 1}: QA -> ${qaResult.status}${qaResult.anomalie_detectee !== 'aucune' ? ` (${qaResult.anomalie_detectee})` : ''}`);
    } catch (qaError) {
      log(`  Scene ${sceneIndex + 1}: QA error (assumed OK): ${qaError.message.substring(0, 100)}`);
      qaResult = { status: 'OK', anomalie_detectee: 'aucune', explication: `QA error: ${qaError.message.substring(0, 100)}`, prompt_regeneration: '' };
    }

    // ---- STEP 8: Update QA result in DB ----
    await updateSceneQA(projectId, sceneIndex, qaResult);

    // ---- CHECK: Abort if cancelled before upscale ----
    if (await isJobCancelled(jobId, parentJobId)) {
      log(`  Scene ${sceneIndex + 1}: CANCELLED, skipping upscale`);
      return;
    }

    // ---- STEP 9: Handle QA result ----
    const modelVersion = metadata.model || 'seedream-4.5';
    const isSeedream = modelVersion.toLowerCase().includes('seedream');
    const needsUpscale = !isSeedream;

    if (qaResult.status === 'REJECT' && !isRegen) {
      // First rejection: regenerate
      log(`  Scene ${sceneIndex + 1}: REJECTED -> creating regen job`);
      await createRegenJob(projectId, userId, sceneIndex, parentJobId, qaResult);
    } else if (qaResult.status === 'REJECT' && isRegen) {
      // Already regen: force OK, proceed to upscale
      log(`  Scene ${sceneIndex + 1}: REJECTED after regen -> forcing OK, proceeding to upscale`);
      await updateSceneQA(projectId, sceneIndex, {
        status: 'OK',
        anomalie_detectee: 'aucune',
        explication: 'Forcé OK après régénération (limite 1 regen atteinte)',
        prompt_regeneration: '',
      });

      if (needsUpscale) {
        await doUpscale(replicateClient, projectId, userId, sceneIndex, parentJobId, publicUrl);
      } else {
        await createCompletedUpscaleJob(projectId, userId, sceneIndex, parentJobId);
      }
    } else {
      // QA OK -> upscale
      if (needsUpscale) {
        await doUpscale(replicateClient, projectId, userId, sceneIndex, parentJobId, publicUrl);
      } else {
        await createCompletedUpscaleJob(projectId, userId, sceneIndex, parentJobId);
      }
    }

    // ---- STEP 10: Final parent progress update ----
    if (parentJobId) {
      await updateParentProgress(parentJobId);
      await checkParentCompletion(parentJobId);
    }

  } catch (error) {
    logError(`Scene ${sceneIndex + 1} (job ${jobId.substring(0, 8)}...) FAILED:`, error.message);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: error.message?.substring(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (parentJobId) {
      await updateParentProgress(parentJobId);
    }
  }
}

// ============================================================================
// UPSCALE HELPER
// ============================================================================

async function doUpscale(replicateClient, projectId, userId, sceneIndex, parentJobId, imageUrl) {
  log(`  Scene ${sceneIndex + 1}: upscaling...`);

  // Create upscale job as 'processing' FIRST to prevent parent premature completion
  const { data: upscaleJob } = await supabase
    .from('generation_jobs')
    .insert({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_upscale',
      status: 'processing',
      progress: 0,
      total: 1,
      scene_index: sceneIndex,
      parent_job_id: parentJobId,
    })
    .select('id')
    .single();

  const upscaleJobId = upscaleJob?.id;

  try {
    const upscaleResult = await runReplicatePrediction(replicateClient, UPSCALE_MODEL, {
      image: imageUrl,
      scale: 2,
      face_enhance: false,
    });

    const upscaledOutput = typeof upscaleResult.output === 'string'
      ? upscaleResult.output
      : (Array.isArray(upscaleResult.output) ? upscaleResult.output[0] : upscaleResult.output);

    if (!upscaledOutput) {
      throw new Error('No upscale output');
    }

    const timestamp = Date.now();
    const filename = `scene_${sceneIndex + 1}_upscaled_${timestamp}.jpg`;
    const upscaledUrl = await uploadImageToStorage(upscaledOutput, projectId, filename);

    await updateSceneUpscale(projectId, sceneIndex, upscaledUrl);
    log(`  Scene ${sceneIndex + 1}: upscaled -> ${upscaledUrl.substring(0, 80)}...`);

    // Mark upscale job completed
    if (upscaleJobId) {
      await supabase
        .from('generation_jobs')
        .update({ status: 'completed', progress: 1, completed_at: new Date().toISOString(), metadata: { upscaled_url: upscaledUrl } })
        .eq('id', upscaleJobId);
    }

  } catch (upscaleError) {
    logError(`  Scene ${sceneIndex + 1} upscale failed:`, upscaleError.message);
    if (upscaleJobId) {
      await supabase
        .from('generation_jobs')
        .update({ status: 'failed', error_message: upscaleError.message?.substring(0, 200), completed_at: new Date().toISOString() })
        .eq('id', upscaleJobId);
    }
  }
}

// ============================================================================
// THUMBNAILS PIPELINE: Process a thumbnails job (3 images)
// ============================================================================

async function processThumbnailsPipeline(job) {
  const { id: jobId, project_id: projectId, user_id: userId, metadata } = job;
  const {
    videoScript, videoTitle, exampleUrls, characterRefUrl,
    previousPrompts, customPrompt, userIdea, imageModel, textModel,
    thumbnailProjectId, presetName, standalone,
  } = metadata || {};

  log(`Processing thumbnails (job ${jobId.substring(0, 8)}...)`);

  try {
    // ---- STEP 1: Get API keys ----
    const replicateKey = await getUserApiKey(userId, 'replicate');
    const replicateClient = new Replicate({ auth: replicateKey });

    // ---- STEP 2: Generate 3 prompts via Edge Function ----
    log('  Thumbnails: generating 3 prompts...');
    const promptsResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-thumbnail-prompts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoScript, videoTitle, exampleUrls, characterRefUrl,
        previousPrompts, customPrompt, userIdea, textModel, userId,
      }),
    });

    if (!promptsResponse.ok) {
      const errorText = await promptsResponse.text();
      throw new Error(`Failed to generate thumbnail prompts: ${errorText.substring(0, 200)}`);
    }

    const promptsData = await promptsResponse.json();
    if (promptsData.error || !promptsData.prompts || promptsData.prompts.length !== 3) {
      throw new Error(promptsData.error || 'Failed to generate 3 thumbnail prompts');
    }

    const creativePrompts = promptsData.prompts;
    log(`  Thumbnails: got ${creativePrompts.length} prompts`);

    // Update job metadata with prompts
    await supabase
      .from('generation_jobs')
      .update({ metadata: { ...metadata, generatedPrompts: creativePrompts } })
      .eq('id', jobId);

    // ---- STEP 3: Generate 3 images via Replicate (polling) ----
    const model = imageModel || 'seedream-4.5';
    const modelName = MODEL_MAP[model] || MODEL_MAP['seedream-4.5'];
    const generatedThumbnails = [];

    // Mutex to serialize DB updates and prevent race conditions
    // Without this, parallel completions can overwrite each other's metadata
    let dbUpdateLock = Promise.resolve();

    // Combine style refs
    const allImageRefs = [];
    if (exampleUrls && Array.isArray(exampleUrls)) allImageRefs.push(...exampleUrls);
    if (characterRefUrl) allImageRefs.push(characterRefUrl);

    // Generate all 3 thumbnails in parallel, update DB as each finishes
    const thumbPromises = creativePrompts.map(async (prompt, i) => {
      try {
        log(`  Thumbnail ${i + 1}/3: generating with ${model}...`);

        const thumbInput = buildReplicateInput({
          prompt,
          model,
          width: 1920,
          height: 1080,
          styleRefs: allImageRefs,
        });

        const result = await runReplicatePrediction(replicateClient, thumbInput.modelName, thumbInput.input);
        const imageOutput = Array.isArray(result.output) ? result.output[0] : result.output;

        if (!imageOutput) {
          logError(`  Thumbnail ${i + 1}: no output`);
          return null;
        }

        // Upload to Storage
        const timestamp = Date.now();
        const effectiveProjectId = standalone ? (thumbnailProjectId || 'standalone') : projectId;
        const filename = `thumb_v${i + 1}_${timestamp}.jpg`;
        const publicUrl = await uploadImageToStorage(imageOutput, effectiveProjectId, filename);
        log(`  Thumbnail ${i + 1}/3: uploaded -> ${publicUrl.substring(0, 80)}...`);

        const thumb = { index: i, url: publicUrl, prompt };

        // Serialize push + DB update to prevent race conditions:
        // Without this, two thumbnails finishing at the same time can cause
        // the later DB write to overwrite the earlier one, losing a thumbnail.
        dbUpdateLock = dbUpdateLock.then(async () => {
          generatedThumbnails.push(thumb);
          await supabase
            .from('generation_jobs')
            .update({
              progress: generatedThumbnails.length,
              metadata: { ...metadata, generatedPrompts: creativePrompts, generatedThumbnails: [...generatedThumbnails] },
            })
            .eq('id', jobId);
        });
        await dbUpdateLock;

        return thumb;
      } catch (thumbError) {
        logError(`  Thumbnail ${i + 1} failed:`, thumbError.message);
        return null;
      }
    });

    await Promise.all(thumbPromises);

    // ---- STEP 4: Save to generated_thumbnails table ----
    if (generatedThumbnails.length > 0) {
      generatedThumbnails.sort((a, b) => a.index - b.index);
      const thumbnailUrls = generatedThumbnails.map(t => t.url);
      const thumbnailPrompts = generatedThumbnails.map(t => t.prompt);

      const { error: saveError } = await supabase
        .from('generated_thumbnails')
        .insert({
          project_id: standalone ? null : projectId,
          thumbnail_project_id: thumbnailProjectId || null,
          thumbnail_urls: thumbnailUrls,
          prompts: thumbnailPrompts,
          preset_name: presetName || null,
          user_id: userId,
        });

      if (saveError) {
        logError('  Failed to save to generated_thumbnails:', saveError.message);
      }
    }

    // ---- STEP 5: Mark job complete ----
    if (generatedThumbnails.length === 0) {
      throw new Error('All 3 thumbnail generations failed');
    }

    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: generatedThumbnails.length,
        completed_at: new Date().toISOString(),
        metadata: { ...metadata, generatedPrompts: creativePrompts, generatedThumbnails },
      })
      .eq('id', jobId);

    log(`  Thumbnails complete: ${generatedThumbnails.length}/3 generated`);

  } catch (error) {
    logError(`Thumbnails (job ${jobId.substring(0, 8)}...) FAILED:`, error.message);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: error.message?.substring(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }
}

// ============================================================================
// THUMBNAIL V2 PIPELINE: Direct prompt to image model (no Claude/Gemini analysis)
// ============================================================================

const THUMBNAIL_V2_PROMPT_TEMPLATE = `You are a professional YouTube thumbnail designer.

You create thumbnails based on example images provided by the user.

Image 1 will always contain the character that must be used in the thumbnail.
The following images are examples that you must study and draw inspiration from (composition, layout, typography, color palette, lighting, emotional tone, visual hierarchy, background style, and overall aesthetic).

Your Process

Step 1 — Deep Analysis
Carefully analyze each example image in depth:
Composition and framing
Color grading and dominant tones
Text placement and typography style
Contrast, lighting, and depth
Emotional expression and intensity
Visual hierarchy and focal points

Step 2 — Identify Patterns & Success Principles
Identify what ALL example thumbnails have in common (recurring colors, layout patterns, text style, character placement, background treatment, emotional tone). These shared elements are the channel's visual identity — you MUST reuse them.
Then analyze WHY these thumbnails are effective: what makes them clickable, what psychological triggers they use (curiosity gap, shock, urgency, contrast, simplicity), how they stand out in a YouTube feed. Apply these same principles to your design.

Step 3 — Understand the Topic
Fully understand the subject of the user's video before designing the thumbnail.

Step 4 — Concept Creation
Create the most compelling thumbnail concept:
Aligned with the video topic
Matching the style and structure of the example images
Using the user's character from Image 1
Optimized for curiosity, clarity, and click-through rate

If the example thumbnails contain text overlays, you MUST include text in your thumbnail too. Match the examples precisely:
Same approximate number of words (if examples have 1-2 words, use 1-2 words; if 3-5 words, use 3-5 words)
Same text size and weight relative to the image
Same color scheme and effects (outlines, shadows, gradients, glow)
Same placement and positioning on the thumbnail
Do NOT copy the exact words — write NEW text adapted to this video's topic
The text should complement the video title, create tension, spark curiosity, or amplify emotion
If the example thumbnails have NO text, do NOT add text.

Step 5 — Generate the Final Image
Produce the final thumbnail image.

Video Title:
{videoTitle}`;

// Upload a raw Buffer (e.g. from Gemini base64 response) to Supabase Storage
async function uploadBufferToStorage(buffer, projectId, filename, contentType = 'image/png') {
  const storagePath = `${projectId}/${filename}`;
  const { error: uploadError } = await supabase.storage
    .from('generated-images')
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
  const { data: { publicUrl } } = supabase.storage
    .from('generated-images')
    .getPublicUrl(storagePath);
  return publicUrl;
}

// Fetch an image URL and return its base64-encoded content
async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

// Generate a single thumbnail using Gemini image generation
async function callGeminiImageApi(geminiKey, prompt, imageUrls, modelName) {
  const parts = [{ text: prompt }];
  for (const url of imageUrls) {
    const base64 = await fetchImageAsBase64(url);
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText.substring(0, 300)}`);
  }

  const data = await response.json();
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    const err = new Error(`Gemini blocked: ${blockReason}`);
    err.blockReason = blockReason;
    throw err;
  }

  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error(`Gemini no content parts. finishReason=${candidate?.finishReason || 'unknown'}`);
  }

  const imagePart = candidate.content.parts.find(p => p.inline_data?.data || p.inlineData?.data);
  if (!imagePart) {
    const textParts = candidate.content.parts.filter(p => p.text).map(p => p.text).join(' ');
    throw new Error(`Gemini returned no image. Text: ${textParts.substring(0, 200)}`);
  }

  return Buffer.from(imagePart.inline_data?.data || imagePart.inlineData?.data, 'base64');
}

// Analyze example images via Gemini Flash (text-only, never blocked) and return a style description
async function analyzeStyleFromExamples(geminiKey, exampleUrls) {
  const parts = [{ text: `Analyze these YouTube thumbnail images in detail. Describe their visual style precisely: composition, framing, color grading, dominant tones, text placement and typography style (font weight, size, color, effects like outlines/shadows/gradients), contrast, lighting, depth, emotional expression, visual hierarchy, focal points, background style, and overall aesthetic. Be extremely specific and detailed.` }];
  for (const url of exampleUrls) {
    const base64 = await fetchImageAsBase64(url);
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } });
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT'] },
      }),
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || null;
}

// Generate a detailed image-generation prompt for SeedDream using Gemini Flash
// Uses the same full analysis prompt as Gemini Pro, but outputs a text prompt instead of an image
async function generateSeedreamPrompt(geminiKey, fullV2Prompt, exampleUrls, characterRefUrl, videoTitle, userDirectives, variationIndex, totalVariations) {
  const parts = [];

  let variationInstruction = '';
  if (totalVariations > 1) {
    variationInstruction = `\n\nIMPORTANT — This is variation ${variationIndex + 1} of ${totalVariations} for A/B testing. Each variation MUST be significantly different:
- Use completely different text/words on the thumbnail
- Try a different composition or layout
- Vary the color mood or background
- Change the character's expression or pose
Do NOT repeat the same text or concept as other variations.`;
  }

  parts.push({ text: `You are a YouTube thumbnail designer. You will follow the EXACT same analysis process described below, but instead of generating an image, you will output a DETAILED image-generation prompt for an AI image model (SeedDream) that only understands direct visual descriptions.

HERE IS YOUR ANALYSIS PROCESS (follow every step):
---
${fullV2Prompt}
---
${variationInstruction}
${userDirectives ? `\nAdditional directives from the user: ${userDirectives}` : ''}

FINAL OUTPUT INSTRUCTIONS:
After completing ALL the analysis steps above (style analysis, pattern identification, success principles, topic understanding, concept creation), write ONE detailed image-generation prompt that describes the EXACT thumbnail to create.

CRITICAL: The image model will also receive the example thumbnails as style reference images. Your prompt MUST explicitly tell it to closely follow and replicate the style of these reference images. Start your prompt with something like "YouTube thumbnail closely matching the visual style of the provided reference images." Then describe every detail.

Your prompt must be a direct visual description — NOT instructions or reasoning. Describe:
- The exact scene, composition and framing (matching the examples' layout patterns)
- The character's appearance, pose, expression, clothing (matching the reference in Image 1)
- Background: colors, elements, lighting, effects (matching the examples' color palette and treatment)
- Text overlays: the exact words to display, their size, color, font style, effects (outlines, shadows, glow), placement (matching the examples' typography)
- Color grading, contrast, mood, atmosphere (matching the examples' visual tone)
- Every visual detail needed to reproduce the thumbnail you designed

Explicitly reference that the result must look like it belongs to the SAME YouTube channel as the reference images. Same visual identity, same energy, same production quality.

Be EXHAUSTIVE and SPECIFIC. The more detail you give, the better the result. Output ONLY the image prompt, no preamble or explanation.` });

  if (characterRefUrl) {
    const base64 = await fetchImageAsBase64(characterRefUrl);
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } });
  }
  for (const url of exampleUrls) {
    const base64 = await fetchImageAsBase64(url);
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } });
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT'] },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Flash prompt generation failed (${response.status}): ${errText.substring(0, 200)}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  if (!text) throw new Error('Gemini Flash returned no text for SeedDream prompt');
  return text.trim();
}

const GEMINI_RELAY_URL = 'http://46.250.231.57:3456/gemini-image';
const GEMINI_RELAY_SECRET = 'thumbv2-sg-relay-2026';

async function callGeminiViaRelay(geminiKey, prompt, imageUrls, modelName) {
  const response = await fetch(GEMINI_RELAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GEMINI_RELAY_SECRET}`,
    },
    body: JSON.stringify({
      geminiKey,
      prompt,
      imageUrls,
      modelName: modelName || 'gemini-3-pro-image-preview',
      aspectRatio: '16:9',
      imageSize: '1K',
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const err = new Error(data.error || `Relay error (${response.status})`);
    if (data.blockReason) err.blockReason = data.blockReason;
    throw err;
  }
  if (!data.imageBase64) throw new Error('Relay returned no image data');
  return Buffer.from(data.imageBase64, 'base64');
}

async function generateWithGemini(geminiKey, prompt, imageUrls, modelName, exampleUrls) {
  return await callGeminiViaRelay(geminiKey, prompt, imageUrls, modelName);
}

async function processThumbnailsV2Pipeline(job) {
  const { id: jobId, project_id: projectId, user_id: userId, metadata } = job;
  const {
    videoTitle, exampleUrls, characterRefUrl, imageModel,
    thumbnailProjectId, standalone, numThumbnails, userDirectives,
  } = metadata || {};

  const count = numThumbnails || 3;
  const model = imageModel || 'seedream-4.5';
  const isGemini = model.startsWith('gemini-');
  log(`Processing thumbnails V2 (job ${jobId.substring(0, 8)}...) - ${count} thumbnails, model: ${model}`);

  try {
    let prompt = THUMBNAIL_V2_PROMPT_TEMPLATE.replace('{videoTitle}', videoTitle || 'Untitled');
    if (userDirectives) {
      prompt += `\n\nAdditional user input:\n${userDirectives}`;
    }

    // Character reference first, then example thumbnails
    const allImageRefs = [];
    if (characterRefUrl) allImageRefs.push(characterRefUrl);
    if (exampleUrls && Array.isArray(exampleUrls)) {
      allImageRefs.push(...exampleUrls);
    }

    // Get the right API key
    let replicateClient = null;
    let geminiKey = null;
    if (isGemini) {
      geminiKey = await getUserApiKey(userId, 'gemini');
    } else {
      const replicateKey = await getUserApiKey(userId, 'replicate');
      replicateClient = new Replicate({ auth: replicateKey });
    }
    log(`  Image refs: ${allImageRefs.length} (character: ${characterRefUrl ? 'yes' : 'no'}, examples: ${exampleUrls?.length || 0})`);

    const generatedThumbnails = [];
    let dbUpdateLock = Promise.resolve();

    await supabase
      .from('generation_jobs')
      .update({ metadata: { ...metadata, generatedPrompts: [prompt] } })
      .eq('id', jobId);

    // For SeedDream, get a Gemini key to generate proper prompts via Flash
    let geminiKeyForPrompts = geminiKey;
    if (!isGemini && !geminiKeyForPrompts) {
      try {
        geminiKeyForPrompts = await getUserApiKey(userId, 'gemini');
      } catch (e) {
        log('  Warning: no Gemini key available for SeedDream prompt generation, using raw prompt');
      }
    }

    const thumbPromises = Array.from({ length: count }, (_, i) => (async () => {
      try {
        log(`  Thumbnail V2 ${i + 1}/${count}: generating with ${model}...`);

        const timestamp = Date.now();
        const effectiveProjectId = standalone ? (thumbnailProjectId || 'standalone') : projectId;
        let publicUrl;
        let usedPrompt = prompt;

        if (isGemini) {
          const variationPrompt = count > 1
            ? prompt + `\n\nIMPORTANT — This is variation ${i + 1} of ${count} for A/B testing. Each variation MUST be significantly different:\n- Use completely different text/words on the thumbnail\n- Try a different composition or layout\n- Vary the color mood or background\n- Change the character's expression or pose\nDo NOT repeat the same text or concept as other variations.`
            : prompt;
          const imageBuffer = await generateWithGemini(geminiKey, variationPrompt, allImageRefs, model, exampleUrls);
          const filename = `thumb_v2_${i + 1}_${timestamp}.png`;
          publicUrl = await uploadBufferToStorage(imageBuffer, effectiveProjectId, filename, 'image/png');
          usedPrompt = variationPrompt;
        } else {
          // SeedDream: use Gemini Flash with the SAME full analysis prompt to generate a detailed visual description
          if (geminiKeyForPrompts) {
            log(`  Thumbnail V2 ${i + 1}: generating SeedDream prompt via Gemini Flash (full analysis)...`);
            usedPrompt = await generateSeedreamPrompt(
              geminiKeyForPrompts, prompt, exampleUrls || [], characterRefUrl, videoTitle, userDirectives, i, count
            );
            log(`  Thumbnail V2 ${i + 1}: SeedDream prompt: ${usedPrompt.substring(0, 150)}...`);
          }

          const thumbInput = buildReplicateInput({
            prompt: usedPrompt,
            model,
            width: 1920,
            height: 1080,
            styleRefs: allImageRefs,
          });
          const result = await runReplicatePrediction(replicateClient, thumbInput.modelName, thumbInput.input);
          const imageOutput = Array.isArray(result.output) ? result.output[0] : result.output;
          if (!imageOutput) {
            logError(`  Thumbnail V2 ${i + 1}: no output`);
            return null;
          }
          const filename = `thumb_v2_${i + 1}_${timestamp}.jpg`;
          publicUrl = await uploadImageToStorage(imageOutput, effectiveProjectId, filename);
        }

        log(`  Thumbnail V2 ${i + 1}/${count}: uploaded -> ${publicUrl.substring(0, 80)}...`);
        const thumb = { index: i, url: publicUrl, prompt: usedPrompt };

        dbUpdateLock = dbUpdateLock.then(async () => {
          generatedThumbnails.push(thumb);
          await supabase
            .from('generation_jobs')
            .update({
              progress: generatedThumbnails.length,
              metadata: { ...metadata, generatedPrompts: [prompt], generatedThumbnails: [...generatedThumbnails] },
            })
            .eq('id', jobId);
        });
        await dbUpdateLock;

        return thumb;
      } catch (thumbError) {
        const errMsg = thumbError.message || String(thumbError);
        logError(`  Thumbnail V2 ${i + 1} failed:`, errMsg);
        // Save error detail to job metadata so we can debug without SSH
        dbUpdateLock = dbUpdateLock.then(async () => {
          const errorList = metadata._thumbErrors || [];
          errorList.push({ index: i, error: errMsg.substring(0, 500) });
          await supabase
            .from('generation_jobs')
            .update({ metadata: { ...metadata, _thumbErrors: errorList } })
            .eq('id', jobId);
          metadata._thumbErrors = errorList;
        });
        await dbUpdateLock;
        return null;
      }
    })());

    await Promise.all(thumbPromises);

    if (generatedThumbnails.length > 0) {
      generatedThumbnails.sort((a, b) => a.index - b.index);
      const thumbnailUrls = generatedThumbnails.map(t => t.url);
      const thumbnailPrompts = generatedThumbnails.map(t => t.prompt);

      const { error: saveError } = await supabase
        .from('generated_thumbnails')
        .insert({
          project_id: standalone ? null : projectId,
          thumbnail_project_id: thumbnailProjectId || null,
          thumbnail_urls: thumbnailUrls,
          prompts: thumbnailPrompts,
          preset_name: null,
          user_id: userId,
        });

      if (saveError) {
        logError('  Failed to save to generated_thumbnails:', saveError.message);
      }
    }

    if (generatedThumbnails.length === 0) {
      throw new Error(`All ${count} thumbnail V2 generations failed. Last errors in job metadata.`);
    }

    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: generatedThumbnails.length,
        completed_at: new Date().toISOString(),
        metadata: { ...metadata, generatedPrompts: [prompt], generatedThumbnails },
      })
      .eq('id', jobId);

    log(`  Thumbnails V2 complete: ${generatedThumbnails.length}/${count} generated`);

  } catch (error) {
    logError(`Thumbnails V2 (job ${jobId.substring(0, 8)}...) FAILED:`, error.message);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: error.message?.substring(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }
}

// ============================================================================
// PROMPT PIPELINE: Dispatch single_prompt job to Edge Function
// ============================================================================

async function processPromptJob(job) {
  const { id: jobId, project_id: projectId, user_id: userId, parent_job_id: parentJobId } = job;
  const MAX_RETRIES = 2;

  log(`Processing prompt (job ${jobId.substring(0, 8)}...)`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = attempt * 3000;
        log(`  Prompt job ${jobId.substring(0, 8)}... retry ${attempt}/${MAX_RETRIES} (waiting ${delay}ms)`);
        await new Promise(r => setTimeout(r, delay));
        // Reset to processing for retry
        await supabase.from('generation_jobs')
          .update({ status: 'processing', error_message: null })
          .eq('id', jobId);
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/start-generation-job`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId, projectId, userId, jobType: 'single_prompt' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge Function error: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      log(`  Prompt job ${jobId.substring(0, 8)}... dispatched OK`);
      return; // Success - exit

    } catch (error) {
      if (attempt < MAX_RETRIES) {
        logError(`Prompt (job ${jobId.substring(0, 8)}...) attempt ${attempt + 1} failed:`, error.message);
        continue; // Retry
      }

      // All retries exhausted
      logError(`Prompt (job ${jobId.substring(0, 8)}...) FAILED after ${MAX_RETRIES + 1} attempts:`, error.message);
      await supabase
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message: error.message?.substring(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      // Notify parent so it doesn't stay stuck forever
      if (parentJobId) {
        try {
          await notifyParentJobProgress(parentJobId);
        } catch (e) {
          logError(`Failed to notify parent after prompt failure:`, e.message);
        }
      }
    }
  }
}

async function notifyParentJobProgress(parentJobId) {
  const [{ count: completedCount }, { count: failedCount }] = await Promise.all([
    supabase.from('generation_jobs').select('id', { count: 'exact', head: true })
      .eq('parent_job_id', parentJobId).eq('status', 'completed'),
    supabase.from('generation_jobs').select('id', { count: 'exact', head: true })
      .eq('parent_job_id', parentJobId).eq('status', 'failed'),
  ]);

  const { data: parentJob } = await supabase
    .from('generation_jobs')
    .select('total, status')
    .eq('id', parentJobId)
    .single();

  if (!parentJob || parentJob.status === 'completed' || parentJob.status === 'cancelled') return;

  const doneCount = (completedCount || 0) + (failedCount || 0);

  await supabase.from('generation_jobs')
    .update({ progress: completedCount || 0 })
    .eq('id', parentJobId);

  log(`  Parent ${parentJobId.substring(0, 8)}... progress: ${completedCount} OK + ${failedCount} failed = ${doneCount}/${parentJob.total}`);

  if (doneCount >= parentJob.total) {
    log(`  Parent ${parentJobId.substring(0, 8)}... all children done. Marking completed.`);
    await supabase.from('generation_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', parentJobId);
  }
}

// ============================================================================
// STUCK PARENT CLEANUP (safety net for parents stuck in processing)
// ============================================================================

let lastStuckParentCheck = 0;
const STUCK_PARENT_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

async function cleanupStuckParents() {
  if (Date.now() - lastStuckParentCheck < STUCK_PARENT_CHECK_INTERVAL_MS) return;
  lastStuckParentCheck = Date.now();

  try {
    // Find parent jobs (prompts/images) stuck in processing for > 5 minutes
    const FIVE_MINUTES_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckParents } = await supabase
      .from('generation_jobs')
      .select('id, job_type, total, project_id')
      .in('job_type', ['prompts', 'images'])
      .eq('status', 'processing')
      .lt('updated_at', FIVE_MINUTES_AGO)
      .limit(10);

    if (!stuckParents || stuckParents.length === 0) return;

    for (const parent of stuckParents) {
      const [{ count: completedCount }, { count: failedCount }, { count: pendingCount }, { count: processingCount }] = await Promise.all([
        supabase.from('generation_jobs').select('id', { count: 'exact', head: true })
          .eq('parent_job_id', parent.id).eq('status', 'completed'),
        supabase.from('generation_jobs').select('id', { count: 'exact', head: true })
          .eq('parent_job_id', parent.id).eq('status', 'failed'),
        supabase.from('generation_jobs').select('id', { count: 'exact', head: true })
          .eq('parent_job_id', parent.id).eq('status', 'pending'),
        supabase.from('generation_jobs').select('id', { count: 'exact', head: true })
          .eq('parent_job_id', parent.id).eq('status', 'processing'),
      ]);

      const done = (completedCount || 0) + (failedCount || 0);
      const active = (pendingCount || 0) + (processingCount || 0);

      // If no active children and all are done, mark parent as completed
      if (active === 0 && done > 0) {
        log(`[CLEANUP] Stuck parent ${parent.id.substring(0, 8)}... (${parent.job_type}): ${completedCount} OK + ${failedCount} failed, 0 active. Marking completed.`);
        await supabase.from('generation_jobs')
          .update({ status: 'completed', progress: completedCount || 0, completed_at: new Date().toISOString() })
          .eq('id', parent.id);
      } else if (active === 0 && done === 0) {
        // Parent has no children at all - likely orphaned, mark as failed
        log(`[CLEANUP] Stuck parent ${parent.id.substring(0, 8)}... (${parent.job_type}): no children at all. Marking failed.`);
        await supabase.from('generation_jobs')
          .update({ status: 'failed', error_message: 'No child jobs found', completed_at: new Date().toISOString() })
          .eq('id', parent.id);
      }
    }
  } catch (e) {
    logError('Stuck parent cleanup error:', e.message);
  }
}

// ============================================================================
// DISK CHECK (safety net)
// ============================================================================

let lastDiskCheck = 0;
const DISK_CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function checkDiskUsage() {
  if (Date.now() - lastDiskCheck < DISK_CHECK_INTERVAL_MS) return;
  lastDiskCheck = Date.now();

  try {
    const { execSync } = require('child_process');
    const output = execSync("df / --output=pcent | tail -1").toString().trim();
    const usagePercent = parseInt(output.replace('%', ''));
    if (usagePercent > 85) {
      logError(`DISK WARNING: ${usagePercent}% used`);
    }
  } catch (_) {}
}

// ============================================================================
// TTS: TEXT CHUNKING (split by sentences, ~200-300 words per chunk)
// ============================================================================

function chunkTextBySentences(text, targetWordCount = 250) {
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];
  const chunks = [];
  let current = '';
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).length;
    if (currentWords + sentenceWords > targetWordCount && currentWords > 0) {
      chunks.push(current.trim());
      current = sentence;
      currentWords = sentenceWords;
    } else {
      current += sentence;
      currentWords += sentenceWords;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

// ============================================================================
// TTS: WAV HEADER (PCM 24kHz 16-bit mono -> WAV)
// ============================================================================

function createWavBuffer(pcmBuffer) {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// ============================================================================
// TTS: GEMINI TTS CHUNK GENERATION + SLIDING WINDOW RATE LIMITER (10 req/min)
// ============================================================================

const TTS_MAX_RPM = 10;
const TTS_WINDOW_MS = 60000;
const ttsRequestTimestamps = [];

async function acquireTTSRateToken() {
  while (true) {
    const now = Date.now();
    while (ttsRequestTimestamps.length > 0 && ttsRequestTimestamps[0] <= now - TTS_WINDOW_MS) {
      ttsRequestTimestamps.shift();
    }
    if (ttsRequestTimestamps.length < TTS_MAX_RPM) {
      ttsRequestTimestamps.push(now);
      return;
    }
    const waitMs = ttsRequestTimestamps[0] + TTS_WINDOW_MS - now + 200;
    log(`[TTS Rate Limit] 10 req/min reached, waiting ${(waitMs / 1000).toFixed(1)}s...`);
    await sleep(waitMs);
  }
}

async function generateTTSChunk(geminiKey, text, voice = 'Puck', styleInstruction = '') {
  const fullText = styleInstruction ? `${styleInstruction}\n${text}` : text;

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-tts:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      })
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini TTS API error ${response.status}: ${errBody.substring(0, 300)}`);
  }

  const json = await response.json();
  const audioData = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) {
    throw new Error('Gemini TTS returned no audio data');
  }

  return Buffer.from(audioData, 'base64');
}

// ============================================================================
// TTS: FULL PIPELINE
// ============================================================================

async function processAudioTTSPipeline(job) {
  const startTime = Date.now();
  const jobId = job.id;

  try {
    const meta = job.metadata || {};
    const text = meta.text;
    const voice = meta.voice || 'Puck';
    const styleInstruction = meta.styleInstruction || 'Lis pour une vidéo youtube sur des docus finances: ';
    const projectId = job.project_id;

    if (!text || text.trim().length < 10) {
      throw new Error('No text provided for TTS generation');
    }

    log(`[TTS ${jobId}] Starting audio generation (voice=${voice}, text=${text.length} chars)`);

    const geminiKey = await getUserApiKey(job.user_id, 'gemini');

    const chunks = chunkTextBySentences(text);
    log(`[TTS ${jobId}] Split into ${chunks.length} chunks`);

    await supabase
      .from('generation_jobs')
      .update({ total: chunks.length, progress: 0, metadata: { ...meta, totalChunks: chunks.length } })
      .eq('id', jobId);

    const TTS_CONCURRENCY = 5;
    const chunkUrls = new Array(chunks.length);
    let completedCount = 0;
    const chunkQueue = chunks.map((_, i) => i);

    async function processOneChunk(index) {
      const CHUNK_MAX_RETRIES = 3;
      let pcmBuffer;

      for (let attempt = 1; attempt <= CHUNK_MAX_RETRIES; attempt++) {
        try {
          log(`[TTS ${jobId}] Generating chunk ${index + 1}/${chunks.length} (${chunks[index].split(/\s+/).length} words)${attempt > 1 ? ` [retry ${attempt}]` : ''}...`);
          await acquireTTSRateToken();
          pcmBuffer = await generateTTSChunk(geminiKey, chunks[index], voice, styleInstruction);
          break;
        } catch (genErr) {
          logError(`[TTS ${jobId}] Chunk ${index + 1} attempt ${attempt}/${CHUNK_MAX_RETRIES} failed:`, genErr.message);
          if (attempt === CHUNK_MAX_RETRIES) throw genErr;
          await sleep(3000 * attempt);
        }
      }

      const wavBuffer = createWavBuffer(pcmBuffer);

      log(`[TTS ${jobId}] Chunk ${index + 1} generated: ${wavBuffer.length} bytes WAV`);

      const storagePath = `tts/${jobId}/chunk_${String(index).padStart(3, '0')}.wav`;
      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(storagePath, wavBuffer, { contentType: 'audio/wav', upsert: true });

      if (uploadError) {
        throw new Error(`Failed to upload chunk ${index}: ${uploadError.message}`);
      }

      const { data: urlData, error: urlError } = await supabase.storage
        .from('audio-files')
        .createSignedUrl(storagePath, 3600);
      if (urlError || !urlData?.signedUrl) {
        throw new Error(`Failed to get signed URL for chunk ${index}: ${urlError?.message || 'no URL'}`);
      }
      chunkUrls[index] = urlData.signedUrl;

      completedCount++;
      await supabase
        .from('generation_jobs')
        .update({ progress: completedCount, metadata: { ...meta, totalChunks: chunks.length, completedChunks: completedCount } })
        .eq('id', jobId);
    }

    const workers = [];
    for (let w = 0; w < Math.min(TTS_CONCURRENCY, chunks.length); w++) {
      workers.push((async () => {
        while (chunkQueue.length > 0) {
          const idx = chunkQueue.shift();
          if (idx === undefined) break;
          await processOneChunk(idx);
        }
      })());
    }
    await Promise.all(workers);

    log(`[TTS ${jobId}] All ${chunks.length} chunks generated. Merging via concat-audio...`);

    const CONCAT_MAX_RETRIES = 3;
    let concatResult;
    for (let attempt = 1; attempt <= CONCAT_MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);

        const concatResponse = await fetch('http://localhost:3000/concat-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioUrls: chunkUrls,
            userId: job.user_id,
            projectId: projectId
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!concatResponse.ok) {
          const errText = await concatResponse.text();
          throw new Error(`concat-audio HTTP ${concatResponse.status}: ${errText.substring(0, 300)}`);
        }

        concatResult = await concatResponse.json();
        break;
      } catch (concatErr) {
        logError(`[TTS ${jobId}] concat-audio attempt ${attempt}/${CONCAT_MAX_RETRIES} failed:`, concatErr.message);
        if (attempt === CONCAT_MAX_RETRIES) throw concatErr;
        await sleep(5000 * attempt);
      }
    }
    let finalAudioUrl = concatResult.audioUrl;
    if (finalAudioUrl && finalAudioUrl.includes('localhost')) {
      finalAudioUrl = finalAudioUrl
        .replace(/http:\/\/localhost:\d+/, 'https://purpleai.duckdns.org/api/render');
    }

    log(`[TTS ${jobId}] Merge complete: ${finalAudioUrl} (${concatResult.totalDuration?.toFixed(1)}s)`);

    if (projectId) {
      await supabase
        .from('projects')
        .update({ audio_url: finalAudioUrl })
        .eq('id', projectId);
    }

    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: chunks.length,
        completed_at: new Date().toISOString(),
        metadata: {
          ...meta,
          totalChunks: chunks.length,
          completedChunks: chunks.length,
          audioUrl: finalAudioUrl,
          totalDuration: concatResult.totalDuration,
          durationMs: Date.now() - startTime
        }
      })
      .eq('id', jobId);

    log(`[TTS ${jobId}] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  } catch (err) {
    logError(`[TTS ${jobId}] Pipeline failed:`, err.message);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function mainLoop() {
  log(`Image Worker started (MAX_CONCURRENT=${MAX_CONCURRENT}, POLL=${POLL_INTERVAL_MS}ms)`);
  log(`Supabase: ${SUPABASE_URL}`);
  log(`Job types: single_image, thumbnails, single_prompt, audio_generation`);

  while (true) {
    try {
      await checkDiskUsage();
      await cleanupStuckParents();
      const availableSlots = MAX_CONCURRENT - activeJobs;

      if (availableSlots > 0) {
        // Fair round-robin: fetch more jobs than needed, then pick evenly across projects
        const { data: pendingJobs, error } = await supabase
          .from('generation_jobs')
          .select('*')
          .eq('status', 'pending')
          .in('job_type', ['single_image', 'thumbnails', 'thumbnails_v2', 'single_prompt', 'audio_generation'])
          .order('created_at', { ascending: true })
          .limit(100);

        if (error) {
          logError('Failed to fetch pending jobs:', error.message);
        } else if (pendingJobs && pendingJobs.length > 0) {
          // Filter out jobs whose parent has been cancelled
          const parentIds = [...new Set(pendingJobs.map(j => j.parent_job_id).filter(Boolean))];
          const cancelledParents = new Set();
          if (parentIds.length > 0) {
            const { data: parents } = await supabase
              .from('generation_jobs')
              .select('id, status')
              .in('id', parentIds)
              .eq('status', 'cancelled');
            if (parents) parents.forEach(p => cancelledParents.add(p.id));
          }
          const validJobs = cancelledParents.size > 0
            ? pendingJobs.filter(j => !j.parent_job_id || !cancelledParents.has(j.parent_job_id))
            : pendingJobs;

          // Auto-cancel orphaned jobs
          if (cancelledParents.size > 0) {
            const orphaned = pendingJobs.filter(j => j.parent_job_id && cancelledParents.has(j.parent_job_id));
            if (orphaned.length > 0) {
              log(`Skipping ${orphaned.length} jobs with cancelled parent, marking them cancelled`);
              await supabase
                .from('generation_jobs')
                .update({ status: 'cancelled' })
                .in('id', orphaned.map(j => j.id));
            }
          }

          // Group by project_id for fair distribution
          const byProject = new Map();
          for (const job of validJobs) {
            const pid = job.project_id || 'none';
            if (!byProject.has(pid)) byProject.set(pid, []);
            byProject.get(pid).push(job);
          }

          // Round-robin pick across projects
          const fairJobs = [];
          const projectQueues = [...byProject.values()];
          let idx = 0;
          while (fairJobs.length < availableSlots && projectQueues.some(q => q.length > 0)) {
            const queue = projectQueues[idx % projectQueues.length];
            if (queue.length > 0) {
              fairJobs.push(queue.shift());
            }
            idx++;
          }

          log(`Found ${validJobs.length} pending jobs from ${byProject.size} project(s), picking ${fairJobs.length} (active: ${activeJobs}/${MAX_CONCURRENT})`);

          for (const job of fairJobs) {
            // Atomically claim by setting to processing
            const { data: claimed, error: claimError } = await supabase
              .from('generation_jobs')
              .update({ status: 'processing', updated_at: new Date().toISOString() })
              .eq('id', job.id)
              .eq('status', 'pending')
              .select('id')
              .single();

            if (claimError || !claimed) {
              continue; // Another worker/process claimed it
            }

            activeJobs++;

            // Route to the correct pipeline
            let pipeline;
            if (job.job_type === 'single_image') {
              pipeline = processImagePipeline(job);
            } else if (job.job_type === 'thumbnails') {
              pipeline = processThumbnailsPipeline(job);
            } else if (job.job_type === 'thumbnails_v2') {
              pipeline = processThumbnailsV2Pipeline(job);
            } else if (job.job_type === 'single_prompt') {
              pipeline = processPromptJob(job);
            } else if (job.job_type === 'audio_generation') {
              pipeline = processAudioTTSPipeline(job);
            }

            pipeline.finally(() => { activeJobs--; });
          }
        }
      }
    } catch (loopError) {
      logError('Main loop error:', loopError.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

function gracefulShutdown(signal) {
  log(`Received ${signal}, waiting for ${activeJobs} active jobs to finish...`);
  const checkInterval = setInterval(() => {
    if (activeJobs === 0) {
      clearInterval(checkInterval);
      log('All jobs finished, exiting.');
      process.exit(0);
    }
    log(`Still waiting for ${activeJobs} active jobs...`);
  }, 2000);

  // Force exit after 2 minutes
  setTimeout(() => {
    logError(`Force exit after timeout (${activeJobs} jobs still active)`);
    process.exit(1);
  }, 2 * 60 * 1000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// START
// ============================================================================

mainLoop().catch(err => {
  logError('Fatal error:', err);
  process.exit(1);
});
