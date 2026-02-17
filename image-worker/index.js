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
// PROMPT PIPELINE: Dispatch single_prompt job to Edge Function
// ============================================================================

async function processPromptJob(job) {
  const { id: jobId, project_id: projectId, user_id: userId } = job;

  log(`Processing prompt (job ${jobId.substring(0, 8)}...)`);

  try {
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

  } catch (error) {
    logError(`Prompt (job ${jobId.substring(0, 8)}...) FAILED:`, error.message);
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
// MAIN LOOP
// ============================================================================

async function mainLoop() {
  log(`Image Worker started (MAX_CONCURRENT=${MAX_CONCURRENT}, POLL=${POLL_INTERVAL_MS}ms)`);
  log(`Supabase: ${SUPABASE_URL}`);
  log(`Job types: single_image, thumbnails, single_prompt`);

  while (true) {
    try {
      await checkDiskUsage();
      const availableSlots = MAX_CONCURRENT - activeJobs;

      if (availableSlots > 0) {
        // Fair round-robin: fetch more jobs than needed, then pick evenly across projects
        const { data: pendingJobs, error } = await supabase
          .from('generation_jobs')
          .select('*')
          .eq('status', 'pending')
          .in('job_type', ['single_image', 'thumbnails', 'single_prompt'])
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
            } else if (job.job_type === 'single_prompt') {
              pipeline = processPromptJob(job);
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
