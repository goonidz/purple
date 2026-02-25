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
    const isAI33Thumb = (imageModel || 'seedream-4.5') === 'ai33-gemini-image';
    let replicateClient = null;
    let ai33ThumbKey = null;
    if (isAI33Thumb) {
      ai33ThumbKey = await getUserApiKey(userId, 'ai33');
    } else {
      const replicateKey = await getUserApiKey(userId, 'replicate');
      replicateClient = new Replicate({ auth: replicateKey });
    }

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

    // ---- STEP 3: Generate 3 images ----
    const model = imageModel || 'seedream-4.5';
    const generatedThumbnails = [];

    // Mutex to serialize DB updates and prevent race conditions
    let dbUpdateLock = Promise.resolve();

    // Combine style refs + resolve YouTube thumbnail URLs
    const rawRefs = [];
    if (exampleUrls && Array.isArray(exampleUrls)) rawRefs.push(...exampleUrls);
    if (characterRefUrl) rawRefs.push(characterRefUrl);
    const allImageRefs = await resolveImageUrls(rawRefs);

    // Generate all 3 thumbnails in parallel, update DB as each finishes
    const thumbPromises = creativePrompts.map(async (prompt, i) => {
      try {
        log(`  Thumbnail ${i + 1}/3: generating with ${model}...`);

        const timestamp = Date.now();
        const effectiveProjectId = standalone ? (thumbnailProjectId || 'standalone') : projectId;
        let publicUrl;

        if (isAI33Thumb) {
          // Keep-alive so stale checker doesn't kill a slow AI33 job
          await supabase.from('generation_jobs').update({ updated_at: new Date().toISOString() }).eq('id', jobId);
          let imageBuffer;
          for (let attempt = 1; attempt <= 3; attempt++) {
            const keepAliveTimer = setInterval(async () => {
              await supabase.from('generation_jobs').update({ updated_at: new Date().toISOString() }).eq('id', jobId);
            }, 60000);
            try {
              imageBuffer = await generateWithAI33(ai33ThumbKey, prompt, allImageRefs, '16:9');
              clearInterval(keepAliveTimer);
              break;
            } catch (retryErr) {
              clearInterval(keepAliveTimer);
              if (attempt === 3) throw retryErr;
              log(`  Thumbnail ${i + 1}: AI33 attempt ${attempt} failed (${retryErr.message?.substring(0, 80)}), retrying in ${attempt * 5}s...`);
              await sleep(attempt * 5000);
            }
          }
          const filename = `thumb_v${i + 1}_${timestamp}.png`;
          publicUrl = await uploadBufferToStorage(imageBuffer, effectiveProjectId, filename, 'image/png');
        } else {
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

          const filename = `thumb_v${i + 1}_${timestamp}.jpg`;
          publicUrl = await uploadImageToStorage(imageOutput, effectiveProjectId, filename);
        }
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

// Resolve a YouTube thumbnail URL to the best available resolution
async function resolveYouTubeThumbnailUrl(url) {
  const ytMatch = url.match(/img\.youtube\.com\/vi\/([^/]+)\/(maxresdefault|sddefault|hqdefault|mqdefault|default)/);
  if (!ytMatch) return url;
  const videoId = ytMatch[1];
  const fallbacks = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];
  for (const res of fallbacks) {
    const tryUrl = `https://img.youtube.com/vi/${videoId}/${res}.jpg`;
    const resp = await fetch(tryUrl, { method: 'HEAD' });
    if (resp.ok && parseInt(resp.headers.get('content-length') || '0') > 1000) {
      return tryUrl;
    }
  }
  return url;
}

// Resolve all URLs in an array, fixing YouTube thumbnails
async function resolveImageUrls(urls) {
  return Promise.all(urls.map(u => resolveYouTubeThumbnailUrl(u)));
}

// Fetch an image URL and return its base64-encoded content
async function fetchImageAsBase64(url) {
  const resolved = await resolveYouTubeThumbnailUrl(url);
  const res = await fetch(resolved);
  if (!res.ok) throw new Error(`Failed to fetch image ${resolved}: ${res.status}`);
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

// ============================================================================
// AI33 PRO: Image generation via ai33.pro API (SeedDream 4.5)
// Flow: POST generate-image → poll task status → download result
// ============================================================================

const AI33_BASE = 'https://api.ai33.pro';
const AI33_POLL_INTERVAL_MS = 4000;
const AI33_MAX_POLL_ATTEMPTS = 180; // ~12min max

async function generateWithAI33(ai33Key, prompt, imageUrls, aspectRatio = '16:9') {
  const FormData = (await import('form-data')).default;

  // Download reference images first (if any)
  const assetBuffers = [];
  if (imageUrls && imageUrls.length > 0) {
    for (let i = 0; i < imageUrls.length; i++) {
      const resolved = await resolveYouTubeThumbnailUrl(imageUrls[i]);
      const res = await fetch(resolved);
      if (res.ok) {
        assetBuffers.push(Buffer.from(await res.arrayBuffer()));
      } else {
        log(`  AI33: Failed to fetch reference image ${i + 1}: ${res.status}`);
      }
    }
  }

  // AI33 gemini-3-pro-image-preview supports max 10 assets
  if (assetBuffers.length > 6) {
    log(`  AI33: Trimming assets from ${assetBuffers.length} to 6 (5 examples + character)`);
    assetBuffers.length = 6;
  }

  // Prompt is already built with @img references by the caller — use as-is
  const finalPrompt = prompt;

  // Build multipart form
  const form = new FormData();
  form.append('prompt', finalPrompt);
  form.append('model_id', 'gemini-3-pro-image-preview');
  form.append('generations_count', '1');
  form.append('model_parameters', JSON.stringify({ aspect_ratio: aspectRatio, resolution: '1K' }));
  for (let i = 0; i < assetBuffers.length; i++) {
    form.append('assets', assetBuffers[i], { filename: `ref_${i + 1}.png`, contentType: 'image/png' });
  }

  return await _ai33Generate(ai33Key, form);
}

async function _ai33Generate(ai33Key, form) {
  // Step 1: Submit generation task
  const createRes = await fetch(`${AI33_BASE}/v1i/task/generate-image`, {
    method: 'POST',
    headers: {
      'xi-api-key': ai33Key,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new Error(`AI33 generate-image error (${createRes.status}): ${errBody.substring(0, 300)}`);
  }

  const createData = await createRes.json();
  if (!createData.success || !createData.task_id) {
    throw new Error(`AI33 no task_id: ${JSON.stringify(createData).substring(0, 300)}`);
  }

  const taskId = createData.task_id;
  log(`  AI33: Task created: ${taskId} (est. credits: ${createData.estimated_credits})`);

  // Step 2: Poll for completion — with exponential backoff on 429
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < AI33_MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(AI33_POLL_INTERVAL_MS);

    const pollRes = await fetch(`${AI33_BASE}/v1/task/${taskId}`, {
      headers: { 'xi-api-key': ai33Key, 'Content-Type': 'application/json' },
    });

    if (!pollRes.ok) {
      consecutiveErrors++;
      if (pollRes.status === 429) {
        // Exponential backoff: 5s, 10s, 20s, 40s... max 60s — don't burn poll attempts
        const backoffMs = Math.min(60000, 5000 * Math.pow(2, consecutiveErrors - 1));
        log(`  AI33: Rate limited (429), backoff ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
        attempt--; // don't count this as a poll attempt
      } else {
        log(`  AI33: Poll error (${pollRes.status}), retrying...`);
      }
      continue;
    }

    consecutiveErrors = 0;

    const taskData = await pollRes.json();

    if (taskData.status === 'done') {
      const resultImages = taskData.metadata?.result_images;
      if (!resultImages || resultImages.length === 0) {
        throw new Error('AI33 task done but no result_images');
      }
      const imageUrl = resultImages[0].imageUrl;
      log(`  AI33: Task completed, downloading image...`);

      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`AI33: Failed to download result image (${imgRes.status})`);
      return Buffer.from(await imgRes.arrayBuffer());
    }

    if (taskData.status === 'error') {
      throw new Error(`AI33 task failed: ${taskData.error_message || 'Unknown error'}`);
    }

    if (attempt % 5 === 0) {
      log(`  AI33: Polling ${attempt + 1}/${AI33_MAX_POLL_ATTEMPTS} (status: ${taskData.status}, progress: ${taskData.progress || 0}%)`);
    }
  }

  throw new Error('AI33 task timed out after polling');
}

async function processThumbnailsV2Pipeline(job) {
  const { id: jobId, project_id: projectId, user_id: userId, metadata } = job;
  const {
    videoTitle, exampleUrls, characterRefUrl, imageModel,
    thumbnailProjectId, standalone, numThumbnails, userDirectives, systemPrompt,
  } = metadata || {};

  const count = numThumbnails || 3;
  const model = imageModel || 'seedream-4.5';
  const isGemini = model.startsWith('gemini-');
  const isAI33 = model === 'ai33-gemini-image';
  log(`Processing thumbnails V2 (job ${jobId.substring(0, 8)}...) - ${count} thumbnails, model: ${model}${systemPrompt ? ' [custom prompt]' : ''}`);

  try {
    // Use custom system prompt if provided, otherwise fall back to the default template
    let prompt;
    if (systemPrompt && systemPrompt.trim()) {
      prompt = systemPrompt.trim().replace('{videoTitle}', videoTitle || 'Untitled');
      log('  Using custom system prompt from preset');
    } else {
      prompt = THUMBNAIL_V2_PROMPT_TEMPLATE.replace('{videoTitle}', videoTitle || 'Untitled');
    }
    if (userDirectives) {
      prompt += `\n\nAdditional user input:\n${userDirectives}`;
    }

    // Character reference first, then example thumbnails
    // Resolve YouTube thumbnail URLs to working resolutions before passing to external APIs
    const rawImageRefs = [];
    if (characterRefUrl) rawImageRefs.push(characterRefUrl);
    if (exampleUrls && Array.isArray(exampleUrls)) {
      rawImageRefs.push(...exampleUrls);
    }
    const allImageRefs = await resolveImageUrls(rawImageRefs);

    // Get the right API key
    let replicateClient = null;
    let geminiKey = null;
    let ai33Key = null;
    if (isAI33) {
      ai33Key = await getUserApiKey(userId, 'ai33');
    } else if (isGemini) {
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

        // Keep-alive: refresh updated_at so the stale detector (5min threshold) doesn't mark this job as failed
        await supabase
          .from('generation_jobs')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', jobId);

        // Stagger parallel AI33 polls: each thumbnail waits i*8s before its first request
        // to avoid all thumbnails hitting the rate limit simultaneously
        if (isAI33 && i > 0) {
          await sleep(i * 8000);
        }

        if (isAI33) {
          // AI33 Pro (Gemini Pro Image): rebuild prompt with explicit @img references
          // allImageRefs[0] = character ref (if present), rest = example thumbnails
          // Cap to 10 to match the API asset limit enforced inside generateWithAI33
          const AI33_MAX_ASSETS = 6; // 1 character + 5 examples
          const effectiveRefCount = Math.min(allImageRefs.length, AI33_MAX_ASSETS);
          const hasCharacter = !!characterRefUrl;
          const numExamples = effectiveRefCount - (hasCharacter ? 1 : 0);
          let imageRefDescription = '';
          if (hasCharacter) {
            imageRefDescription += `@img1 is the character that MUST be used in the thumbnail.\n`;
          }
          if (numExamples > 0) {
            const exampleRefs = Array.from({ length: numExamples }, (_, k) => `@img${(hasCharacter ? 2 : 1) + k}`).join(', ');
            imageRefDescription += `${exampleRefs} are example thumbnails from the channel — study their composition, typography, color palette, and style.\n`;
          }

          // Replace generic "Image 1" / "following images" references in the template with @img syntax
          let ai33Prompt = prompt
            .replace('Image 1 will always contain the character that must be used in the thumbnail.', imageRefDescription.trim())
            .replace('The following images are examples', `${hasCharacter && numExamples > 0 ? Array.from({ length: numExamples }, (_, k) => `@img${2 + k}`).join(', ') : 'The attached images'} are examples`)
            .replace('Using the user\'s character from Image 1', `Using the character from @img1`);

          const variationPrompt = ai33Prompt;

          let imageBuffer;
          for (let attempt = 1; attempt <= 3; attempt++) {
            // Keep-alive timer: refresh updated_at every 60s so the stale checker (5min threshold) doesn't kill a slow AI33 job
            const keepAliveTimer = setInterval(async () => {
              await supabase.from('generation_jobs').update({ updated_at: new Date().toISOString() }).eq('id', jobId);
            }, 60000);
            try {
              imageBuffer = await generateWithAI33(ai33Key, variationPrompt, allImageRefs, '16:9');
              clearInterval(keepAliveTimer);
              break;
            } catch (retryErr) {
              clearInterval(keepAliveTimer);
              if (attempt === 3) throw retryErr;
              log(`  Thumbnail V2 ${i + 1}: AI33 attempt ${attempt} failed (${retryErr.message?.substring(0, 80)}), retrying in ${attempt * 5}s...`);
              await sleep(attempt * 5000);
            }
          }
          const filename = `thumb_v2_${i + 1}_${timestamp}.png`;
          publicUrl = await uploadBufferToStorage(imageBuffer, effectiveProjectId, filename, 'image/png');
          usedPrompt = variationPrompt;
        } else if (isGemini) {
          const variationPrompt = prompt;
          let imageBuffer;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              imageBuffer = await generateWithGemini(geminiKey, variationPrompt, allImageRefs, model, exampleUrls);
              break;
            } catch (retryErr) {
              if (attempt === 3) throw retryErr;
              log(`  Thumbnail V2 ${i + 1}: attempt ${attempt} failed (${retryErr.message?.substring(0, 80)}), retrying in ${attempt * 5}s...`);
              await sleep(attempt * 5000);
            }
          }
          const filename = `thumb_v2_${i + 1}_${timestamp}.png`;
          publicUrl = await uploadBufferToStorage(imageBuffer, effectiveProjectId, filename, 'image/png');
          usedPrompt = variationPrompt;
        } else {
          // SeedDream via Replicate: use Gemini Flash to generate a detailed visual description
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
    const styleInstruction = meta.styleInstruction || 'energetic YouTube narrator. Natural and conversational, confident and slightly playful. Medium-fast pace. Strong emphasis on key words. Vary pitch and intonation to avoid monotone. Short pauses after punchlines and before important numbers. Sound curious, occasionally skeptical. Smile in the voice. Avoid robotic cadence.';
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
// GENAIPRO TTS PIPELINE (ElevenLabs-compatible via GenAIPro.vn)
// ============================================================================

const GENAIPRO_BASE = 'https://genaipro.vn/api/v1';
const GENAIPRO_POLL_INTERVAL_MS = 5000;
const GENAIPRO_MAX_POLL_ATTEMPTS = 120; // 10 min

async function processGenaiproAudioPipeline(job) {
  const startTime = Date.now();
  const { id: jobId, project_id: projectId, user_id: userId, metadata: meta } = job;

  try {
    const script = meta.script;
    const voice = meta.voice || 'uju3wxzG5OhpWcoi3SMy';
    const model = meta.model || 'eleven_multilingual_v2';
    const speed = meta.speed ?? 1.0;
    const stability = meta.stability ?? 0.5;
    const similarity = meta.similarity ?? 0.75;
    const style = meta.style ?? 0.0;
    const useSpeakerBoost = meta.useSpeakerBoost ?? false;

    if (!script || script.trim().length < 5) {
      throw new Error('No script provided for GenAIPro TTS');
    }

    log(`[GenAIPro ${jobId}] Starting TTS (voice=${voice}, model=${model}, script=${script.length} chars)`);

    const apiKey = await getUserApiKey(userId, 'genaipro');

    // Step 1: Create task
    log(`[GenAIPro ${jobId}] Creating task...`);
    const createRes = await fetch(`${GENAIPRO_BASE}/labs/task`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: script,
        voice_id: voice,
        model_id: model,
        speed,
        stability,
        similarity,
        style,
        use_speaker_boost: useSpeakerBoost,
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(`GenAIPro API error ${createRes.status}: ${errBody}`);
    }

    const { task_id } = await createRes.json();
    if (!task_id) {
      throw new Error('No task_id in GenAIPro response');
    }

    log(`[GenAIPro ${jobId}] Task created: ${task_id}`);

    await supabase
      .from('generation_jobs')
      .update({ metadata: { ...meta, genaipro_task_id: task_id } })
      .eq('id', jobId);

    // Step 2: Poll until completed
    let audioBytes = null;
    for (let attempt = 0; attempt < GENAIPRO_MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(GENAIPRO_POLL_INTERVAL_MS);

      if (attempt % 6 === 0) {
        log(`[GenAIPro ${jobId}] Polling (${attempt + 1}/${GENAIPRO_MAX_POLL_ATTEMPTS})...`);
      }

      const pollRes = await fetch(`${GENAIPRO_BASE}/labs/task/${task_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) {
        logError(`[GenAIPro ${jobId}] Poll error: ${pollRes.status}`);
        continue;
      }

      const taskData = await pollRes.json();

      if (taskData.status === 'completed') {
        const audioUrl = taskData.result;
        if (!audioUrl) {
          throw new Error('No result URL in completed GenAIPro task');
        }

        log(`[GenAIPro ${jobId}] Task completed, downloading audio...`);
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) {
          throw new Error(`Failed to download audio: ${audioRes.status}`);
        }

        audioBytes = Buffer.from(await audioRes.arrayBuffer());
        break;
      }

      if (taskData.status === 'failed') {
        throw new Error(`GenAIPro task failed: ${taskData.error || 'Unknown error'}`);
      }
    }

    if (!audioBytes) {
      throw new Error('GenAIPro task timed out after 10 minutes');
    }

    // Step 3: Upload to Supabase Storage
    const timestamp = Date.now();
    const filename = `${userId}/${projectId || 'temp'}/${timestamp}_genaipro_generated.mp3`;

    const { error: uploadError } = await supabase.storage
      .from('audio-files')
      .upload(filename, audioBytes, { contentType: 'audio/mpeg', upsert: true });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('audio-files')
      .getPublicUrl(filename);

    log(`[GenAIPro ${jobId}] Audio uploaded: ${publicUrl.substring(0, 80)}...`);

    const estimatedDuration = Math.round(script.split(/\s+/).length / 2.5);

    // Step 4: Update project
    if (projectId) {
      await supabase
        .from('projects')
        .update({ audio_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', projectId);
    }

    // Step 5: Mark job completed
    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: 1,
        completed_at: new Date().toISOString(),
        metadata: {
          ...meta,
          genaipro_task_id: task_id,
          audioUrl: publicUrl,
          duration: estimatedDuration,
          durationMs: Date.now() - startTime,
        },
      })
      .eq('id', jobId);

    log(`[GenAIPro ${jobId}] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  } catch (err) {
    logError(`[GenAIPro ${jobId}] Pipeline failed:`, err.message);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }
}

// ============================================================================
// EDGETTS + RVC PIPELINE
// ============================================================================

// Split text into chunks of ~targetChars characters without cutting mid-sentence
function chunkTextByChars(text, targetChars = 2000) {
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Generate one EdgeTTS chunk via Python CLI, returns Buffer
async function generateEdgeTTSChunk(text, voice, rate) {
  const { execFile } = require('child_process');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  const tmpFile = path.join(os.tmpdir(), `edgetts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

  await new Promise((resolve, reject) => {
    const edgeTTSBin = process.env.EDGE_TTS_BIN || 'edge-tts';
    const args = ['--text', text, '--voice', voice, '--write-media', tmpFile];
    if (rate && rate !== 1.0) {
      const pct = Math.round((rate - 1) * 100);
      args.push('--rate', `${pct >= 0 ? '+' : ''}${pct}%`);
    }
    execFile(edgeTTSBin, args, { timeout: 120000 }, (err) => {
      if (err) return reject(new Error(`edge-tts failed: ${err.message}`));
      resolve();
    });
  });

  const buffer = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return buffer;
}

async function processEdgeTTSRVCPipeline(job) {
  const startTime = Date.now();
  const { id: jobId, project_id: projectId, user_id: userId, metadata: meta } = job;

  try {
    const text = meta.script || meta.text;
    const voice = meta.voice || 'en-US-AndrewMultilingualNeural';
    const rvcModelUrl = meta.rvcModelUrl;
    const rvcIndexUrl = meta.rvcIndexUrl || '';
    const rvcPitch = typeof meta.rvcPitch === 'number' ? meta.rvcPitch : 0;
    const rvcIndexRate = typeof meta.rvcIndexRate === 'number' ? meta.rvcIndexRate : 0.75;
    const rvcFilterRadius = typeof meta.rvcFilterRadius === 'number' ? meta.rvcFilterRadius : 3;
    const ttsSpeed = typeof meta.speed === 'number' ? meta.speed : 1.0;

    if (!text || text.trim().length < 5) throw new Error('No text provided for EdgeTTS+RVC');
    if (!rvcModelUrl) throw new Error('rvcModelUrl is required for EdgeTTS+RVC');

    const runpodRvcEndpointId = process.env.RUNPOD_RVC_ENDPOINT_ID;
    const runpodApiKey = process.env.RUNPOD_API_KEY;
    if (!runpodRvcEndpointId || !runpodApiKey) throw new Error('RUNPOD_RVC_ENDPOINT_ID and RUNPOD_API_KEY must be set');

    log(`[EdgeTTS+RVC ${jobId}] Starting (voice=${voice}, speed=${ttsSpeed}x, text=${text.length} chars)`);

    // Step 1: Chunk text
    const chunks = chunkTextByChars(text, 2000);
    log(`[EdgeTTS+RVC ${jobId}] Split into ${chunks.length} chunks`);

    await supabase
      .from('generation_jobs')
      .update({ total: chunks.length + 1, progress: 0, metadata: { ...meta, totalChunks: chunks.length } })
      .eq('id', jobId);

    // Step 2: Generate EdgeTTS chunks in parallel (max 3 workers)
    const EDGETTS_CONCURRENCY = 3;
    const chunkUrls = new Array(chunks.length);
    let completedCount = 0;
    const chunkQueue = chunks.map((_, i) => i);

    async function processOneEdgeTTSChunk(index) {
      const MAX_RETRIES = 3;
      let audioBuffer;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          log(`[EdgeTTS+RVC ${jobId}] Chunk ${index + 1}/${chunks.length}${attempt > 1 ? ` [retry ${attempt}]` : ''}...`);
          audioBuffer = await generateEdgeTTSChunk(chunks[index], voice, ttsSpeed);
          break;
        } catch (err) {
          logError(`[EdgeTTS+RVC ${jobId}] Chunk ${index + 1} attempt ${attempt} failed:`, err.message);
          if (attempt === MAX_RETRIES) throw err;
          await sleep(3000 * attempt);
        }
      }

      const storagePath = `tts/${jobId}/chunk_${String(index).padStart(3, '0')}.mp3`;
      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });
      if (uploadError) throw new Error(`Failed to upload chunk ${index}: ${uploadError.message}`);

      const { data: urlData, error: urlError } = await supabase.storage
        .from('audio-files')
        .createSignedUrl(storagePath, 3600);
      if (urlError || !urlData?.signedUrl) throw new Error(`Failed to get signed URL for chunk ${index}`);

      chunkUrls[index] = urlData.signedUrl;
      completedCount++;
      await supabase
        .from('generation_jobs')
        .update({ progress: completedCount, metadata: { ...meta, totalChunks: chunks.length, completedChunks: completedCount } })
        .eq('id', jobId);
    }

    const workers = [];
    for (let w = 0; w < Math.min(EDGETTS_CONCURRENCY, chunks.length); w++) {
      workers.push((async () => {
        while (chunkQueue.length > 0) {
          const idx = chunkQueue.shift();
          if (idx === undefined) break;
          await processOneEdgeTTSChunk(idx);
        }
      })());
    }
    await Promise.all(workers);

    log(`[EdgeTTS+RVC ${jobId}] All ${chunks.length} chunks done. Concatenating...`);

    // Step 3: Concat chunks
    const CONCAT_MAX_RETRIES = 3;
    let concatResult;
    for (let attempt = 1; attempt <= CONCAT_MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        const concatResponse = await fetch('http://localhost:3000/concat-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrls: chunkUrls, userId, projectId }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!concatResponse.ok) {
          const errText = await concatResponse.text();
          throw new Error(`concat-audio HTTP ${concatResponse.status}: ${errText.substring(0, 300)}`);
        }
        concatResult = await concatResponse.json();
        break;
      } catch (concatErr) {
        logError(`[EdgeTTS+RVC ${jobId}] concat attempt ${attempt}/${CONCAT_MAX_RETRIES} failed:`, concatErr.message);
        if (attempt === CONCAT_MAX_RETRIES) throw concatErr;
        await sleep(5000 * attempt);
      }
    }

    let concatenatedUrl = concatResult.audioUrl;
    if (concatenatedUrl && concatenatedUrl.includes('localhost')) {
      concatenatedUrl = concatenatedUrl.replace(/http:\/\/localhost:\d+/, 'https://purpleai.duckdns.org/api/render');
    }
    log(`[EdgeTTS+RVC ${jobId}] Concat done: ${concatenatedUrl} (${concatResult.totalDuration?.toFixed(1)}s)`);

    // Step 4: Send to RunPod RVC Serverless
    log(`[EdgeTTS+RVC ${jobId}] Sending to RunPod RVC (endpoint: ${runpodRvcEndpointId})...`);
    const runpodRes = await fetch(`https://api.runpod.ai/v2/${runpodRvcEndpointId}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${runpodApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          audioUrl: concatenatedUrl,
          rvcModelUrl,
          rvcIndexUrl,
          pitch: rvcPitch,
          indexRate: rvcIndexRate,
          filterRadius: rvcFilterRadius,
          jobId,
          userId,
          projectId,
        },
      }),
    });

    if (!runpodRes.ok) {
      const errText = await runpodRes.text();
      throw new Error(`RunPod RVC submit failed (${runpodRes.status}): ${errText.substring(0, 300)}`);
    }

    const runpodData = await runpodRes.json();
    const runpodJobId = runpodData.id;
    log(`[EdgeTTS+RVC ${jobId}] RunPod job submitted: ${runpodJobId}`);

    await supabase
      .from('generation_jobs')
      .update({ metadata: { ...meta, totalChunks: chunks.length, runpodJobId, step: 'rvc_processing' } })
      .eq('id', jobId);

    // Step 5: Poll RunPod for result (max 10 min)
    const RUNPOD_POLL_INTERVAL_MS = 5000;
    const RUNPOD_MAX_ATTEMPTS = 120;
    let finalAudioUrl = null;

    for (let attempt = 0; attempt < RUNPOD_MAX_ATTEMPTS; attempt++) {
      await sleep(RUNPOD_POLL_INTERVAL_MS);

      const statusRes = await fetch(`https://api.runpod.ai/v2/${runpodRvcEndpointId}/status/${runpodJobId}`, {
        headers: { 'Authorization': `Bearer ${runpodApiKey}` },
      });

      if (!statusRes.ok) {
        logError(`[EdgeTTS+RVC ${jobId}] RunPod status poll error: ${statusRes.status}`);
        continue;
      }

      const statusData = await statusRes.json();
      if (attempt % 6 === 0) {
        log(`[EdgeTTS+RVC ${jobId}] RunPod status: ${statusData.status} (${attempt + 1}/${RUNPOD_MAX_ATTEMPTS})`);
      }

      if (statusData.status === 'COMPLETED') {
        finalAudioUrl = statusData.output?.audioUrl;
        if (!finalAudioUrl) throw new Error('RunPod RVC completed but no audioUrl in output');
        break;
      }

      if (statusData.status === 'FAILED') {
        throw new Error(`RunPod RVC failed: ${statusData.error || JSON.stringify(statusData.output || {})}`);
      }
    }

    if (!finalAudioUrl) throw new Error('RunPod RVC timed out after 10 minutes');

    log(`[EdgeTTS+RVC ${jobId}] RVC done: ${finalAudioUrl}`);

    // Step 6: Update project
    if (projectId) {
      await supabase
        .from('projects')
        .update({ audio_url: finalAudioUrl, updated_at: new Date().toISOString() })
        .eq('id', projectId);
    }

    await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: chunks.length + 1,
        completed_at: new Date().toISOString(),
        metadata: {
          ...meta,
          totalChunks: chunks.length,
          audioUrl: finalAudioUrl,
          totalDuration: concatResult.totalDuration,
          durationMs: Date.now() - startTime,
        },
      })
      .eq('id', jobId);

    log(`[EdgeTTS+RVC ${jobId}] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  } catch (err) {
    logError(`[EdgeTTS+RVC ${jobId}] Pipeline failed:`, err.message);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }
}

// ============================================================================
// IDEA GENERATION PIPELINE (YouTube scraping + Anthropic)
// ============================================================================

function parseYouTubeDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 3600) + (parseInt(match[2] || '0') * 60) + parseInt(match[3] || '0');
}

async function fetchYouTubeChannelVideos(channelHandle, youtubeApiKey) {

  const handle = channelHandle.replace(/^@/, '');
  log(`[IDEAS] Resolving channel handle: @${handle}`);

  const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&forHandle=${encodeURIComponent(handle)}&key=${youtubeApiKey}`;
  const channelRes = await fetch(channelUrl);
  const channelData = await channelRes.json();

  if (!channelRes.ok) {
    if (channelRes.status === 429 || channelData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
      throw new Error('YouTube API quota exceeded. Try again tomorrow.');
    }
    throw new Error(channelData?.error?.message || 'Failed to resolve channel');
  }

  if (!channelData.items || channelData.items.length === 0) {
    throw new Error(`Channel "@${handle}" not found`);
  }

  const channel = channelData.items[0];
  const channelId = channel.id;
  const channelTitle = channel.snippet?.title || handle;
  const subscriberCount = parseInt(channel.statistics?.subscriberCount || '0');

  const uploadsPlaylistId = 'UU' + channelId.substring(2);
  log(`[IDEAS] Channel: ${channelTitle} (${channelId}), fetching uploads...`);

  const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=20&key=${youtubeApiKey}`;
  const playlistRes = await fetch(playlistUrl);
  const playlistData = await playlistRes.json();

  if (!playlistRes.ok) {
    throw new Error(playlistData?.error?.message || 'Failed to fetch channel videos');
  }

  const items = playlistData.items || [];
  if (items.length === 0) throw new Error('No videos found on this channel');

  const videoIds = items.map(i => i.contentDetails?.videoId).filter(Boolean);

  const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds.join(',')}&key=${youtubeApiKey}`;
  const statsRes = await fetch(statsUrl);
  const statsData = await statsRes.json();

  if (!statsRes.ok) {
    throw new Error(statsData?.error?.message || 'Failed to fetch video stats');
  }

  const videos = (statsData.items || [])
    .filter(v => {
      const dur = parseYouTubeDuration(v.contentDetails?.duration || 'PT0S');
      return dur >= 60;
    })
    .map(v => {
      const publishedAt = new Date(v.snippet.publishedAt);
      const daysSincePublish = Math.max(1, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24));
      const views = parseInt(v.statistics.viewCount || '0');
      const likes = parseInt(v.statistics.likeCount || '0');
      const comments = parseInt(v.statistics.commentCount || '0');

      return {
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        views,
        likes,
        comments,
        durationSeconds: parseYouTubeDuration(v.contentDetails?.duration || 'PT0S'),
        viewsPerDay: Math.round(views / daysSincePublish),
        engagementRate: views > 0 ? ((likes + comments) / views * 100).toFixed(2) : '0',
      };
    });

  log(`[IDEAS] Fetched ${videos.length} videos (filtered shorts) for ${channelTitle}`);
  return { channelTitle, subscriberCount, videos };
}

async function callAnthropicForIdeas(anthropicKey, channelData) {
  const { channelTitle, subscriberCount, videos } = channelData;

  const videoSummary = videos.map((v, i) =>
    `${i + 1}. "${v.title}" — ${v.views.toLocaleString()} views, ${v.likes.toLocaleString()} likes, ${v.comments.toLocaleString()} comments, ${v.viewsPerDay.toLocaleString()} views/day, ${v.engagementRate}% engagement, published ${v.publishedAt}`
  ).join('\n');

  const systemPrompt = `You're a world class copywriter writing the best youtube titles. Analyze those topics and how they went viral or not, and find me some similar topics that I can do to go viral.`;

  const userMessage = `Here are the last ${videos.length} videos from the YouTube channel "${channelTitle}" (${subscriberCount.toLocaleString()} subscribers):

${videoSummary}

Based on this data, give me exactly 10 viral video ideas. For each idea, provide:
1. A catchy title
2. A brief explanation of why this topic could go viral (2-3 sentences)
3. An estimated viral potential score from 1-10

Format your response as a JSON array of objects with keys: "title", "reasoning", "viralScore". Return ONLY the JSON array, no other text.`;

  log(`[IDEAS] Calling Anthropic claude-sonnet-4-6-20250514...`);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errBody}`);
  }

  const result = await response.json();
  const textContent = result.content?.find(c => c.type === 'text')?.text;
  if (!textContent) throw new Error('Anthropic returned no text content');

  const jsonMatch = textContent.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not parse ideas JSON from Anthropic response');

  const ideas = JSON.parse(jsonMatch[0]);
  log(`[IDEAS] Got ${ideas.length} ideas from Anthropic`);
  return ideas;
}

async function processIdeaGenerationPipeline(job) {
  const { id: jobId, user_id: userId, metadata: meta } = job;
  const channelHandle = meta?.channelHandle;

  log(`[IDEAS ${jobId}] Starting idea generation for ${channelHandle}`);

  try {
    if (!channelHandle) throw new Error('No channel handle provided');

    await supabase.from('generation_jobs')
      .update({ progress: 0, total: 3, metadata: { ...meta, step: 'fetching_videos' } })
      .eq('id', jobId);

    const geminiKey = await getUserApiKey(userId, 'gemini');
    const channelData = await fetchYouTubeChannelVideos(channelHandle, geminiKey);

    await supabase.from('generation_jobs')
      .update({ progress: 1, metadata: { ...meta, step: 'calling_ai', channelTitle: channelData.channelTitle, videoCount: channelData.videos.length } })
      .eq('id', jobId);

    const anthropicKey = await getUserApiKey(userId, 'anthropic');
    const ideas = await callAnthropicForIdeas(anthropicKey, channelData);

    await supabase.from('generation_jobs')
      .update({ progress: 2, metadata: { ...meta, step: 'saving_results' } })
      .eq('id', jobId);

    await supabase.from('generation_jobs')
      .update({
        status: 'completed',
        progress: 3,
        total: 3,
        completed_at: new Date().toISOString(),
        metadata: {
          ...meta,
          step: 'done',
          channelTitle: channelData.channelTitle,
          subscriberCount: channelData.subscriberCount,
          videoCount: channelData.videos.length,
          videos: channelData.videos,
          ideas,
        },
      })
      .eq('id', jobId);

    log(`[IDEAS ${jobId}] Completed successfully with ${ideas.length} ideas`);

  } catch (err) {
    logError(`[IDEAS ${jobId}] Pipeline failed:`, err.message);
    await supabase.from('generation_jobs')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString(),
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
  log(`Job types: single_image, thumbnails, single_prompt, audio_generation (gemini/genaipro/edgetts_rvc), idea_generation`);

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
          .in('job_type', ['single_image', 'thumbnails', 'thumbnails_v2', 'single_prompt', 'audio_generation', 'idea_generation'])
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
              if (job.metadata?.provider === 'genaipro') pipeline = processGenaiproAudioPipeline(job);
              else if (job.metadata?.provider === 'edgetts_rvc') pipeline = processEdgeTTSRVCPipeline(job);
              else pipeline = processAudioTTSPipeline(job);
            } else if (job.job_type === 'idea_generation') {
              pipeline = processIdeaGenerationPipeline(job);
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
