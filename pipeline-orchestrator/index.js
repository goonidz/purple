require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { parseTranscriptToScenes, DEFAULT_DURATION_RANGES } = require('./sceneParser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VPS_URL = process.env.VPS_URL || 'http://localhost:3001';
const POLL_INTERVAL = 30_000;
const MAX_RETRIES = 3;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[orchestrator] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================================
// HELPERS
// ============================================================================

async function getUserApiKey(userId, keyName) {
  const { data, error } = await supabase.rpc('get_user_api_key_for_service', {
    target_user_id: userId,
    key_name: keyName,
  });
  if (error || !data) throw new Error(`API key '${keyName}' not configured for user ${userId}`);
  return data;
}

async function advancePipeline(pipelineId, nextStep, extraUpdates = {}) {
  await supabase.from('auto_pipelines').update({
    current_step: nextStep,
    step_status: 'pending',
    retry_count: 0,
    error: null,
    updated_at: new Date().toISOString(),
    ...extraUpdates,
  }).eq('id', pipelineId);
}

async function failPipeline(pipelineId, error) {
  console.error(`[orchestrator] Pipeline ${pipelineId} FAILED: ${error}`);
  await supabase.from('auto_pipelines').update({
    current_step: 'failed',
    step_status: 'failed',
    error: String(error).slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq('id', pipelineId);
}

async function updateCalendarStatus(calendarEntryId, status) {
  await supabase.from('content_calendar').update({ status, updated_at: new Date().toISOString() }).eq('id', calendarEntryId);
}

async function updatePipelineMetadata(pipelineId, metadata) {
  const { data } = await supabase.from('auto_pipelines').select('metadata').eq('id', pipelineId).single();
  const merged = { ...(data?.metadata || {}), ...metadata };
  await supabase.from('auto_pipelines').update({ metadata: merged, updated_at: new Date().toISOString() }).eq('id', pipelineId);
}

function getRequiredKeyName(model) {
  if (/glm.*openrouter|qwen/i.test(model)) return 'openrouter';
  if (/glm-?5$/i.test(model)) return 'zai';
  return 'anthropic';
}

function getProvider(model) {
  if (/glm.*openrouter/i.test(model)) return 'openrouter';
  if (/qwen/i.test(model)) return 'openrouter';
  if (/glm-?5$/i.test(model)) return 'zai';
  return undefined;
}

// ============================================================================
// STEP HANDLERS
// ============================================================================

async function stepCreateProject(pipeline) {
  const { id, calendar_entry_id, user_id, config } = pipeline;

  // Check if project already created (idempotent)
  if (pipeline.project_id) {
    console.log(`[orchestrator] [${id}] Project already exists: ${pipeline.project_id}`);
    await advancePipeline(id, 'generate_script');
    return;
  }

  // Get card title
  const { data: card } = await supabase.from('content_calendar').select('title').eq('id', calendar_entry_id).single();
  if (!card) throw new Error('Calendar entry not found');

  // Create project
  const { data: project, error } = await supabase.from('projects').insert({
    user_id,
    name: card.title,
  }).select('id').single();
  if (error) throw new Error(`Failed to create project: ${error.message}`);

  // Link to calendar card
  await supabase.from('content_calendar').update({ project_id: project.id }).eq('id', calendar_entry_id);

  console.log(`[orchestrator] [${id}] Created project ${project.id} for "${card.title}"`);
  await advancePipeline(id, 'generate_script', { project_id: project.id });
}

async function stepGenerateScript(pipeline) {
  const { id, project_id, user_id, config, metadata } = pipeline;

  // Already launched? (resume scenario)
  if (metadata?.scriptJobId) {
    console.log(`[orchestrator] [${id}] Script job already launched: ${metadata.scriptJobId}`);
    await advancePipeline(id, 'wait_script');
    return;
  }

  const scriptConfig = config.script || {};
  const rawModel = scriptConfig.model || 'glm5-openrouter';

  // Map frontend short names to actual API model IDs (same mapping as CreateFromScratch.tsx)
  const MODEL_MAP = {
    'claude': 'claude-sonnet-4-6',
    'claude-thinking': 'claude-opus-4-5-20251101',
  };
  const model = MODEL_MAP[rawModel] || rawModel;
  const effort = rawModel === 'claude' ? 'high' : undefined;

  const keyName = getRequiredKeyName(rawModel);
  const apiKey = await getUserApiKey(user_id, keyName);

  // Get card title + source transcript for prompt variable replacement
  const { data: card } = await supabase.from('content_calendar').select('title, source_transcript').eq('id', pipeline.calendar_entry_id).single();

  let prompt = (scriptConfig.custom_prompt || '');
  prompt = prompt.replace(/\{\{projectName\}\}/gi, card?.title || '');
  prompt = prompt.replace(/\{\{sourceTranscript\}\}/gi, card?.source_transcript || '');

  const body = {
    customPrompt: prompt,
    model,
    projectId: project_id,
    userId: user_id,
    asyncMode: true,
    batch: scriptConfig.use_batch || false,
  };
  if (effort) body.effort = effort;

  // Set the right API key field
  const provider = getProvider(model);
  if (provider === 'openrouter') body.openrouterApiKey = apiKey;
  else if (provider === 'zai') body.zaiApiKey = apiKey;
  else body.anthropicApiKey = apiKey;
  if (provider) body.provider = provider;

  const resp = await fetch(`${VPS_URL}/generate-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`VPS /generate-script failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  if (!result.jobId) throw new Error('No jobId returned from VPS');

  await updatePipelineMetadata(id, { scriptJobId: result.jobId });
  await updateCalendarStatus(pipeline.calendar_entry_id, 'auto_script');

  console.log(`[orchestrator] [${id}] Script job launched: ${result.jobId}`);
  await advancePipeline(id, 'wait_script');
}

async function stepWaitScript(pipeline) {
  const { id, metadata, project_id } = pipeline;
  const jobId = metadata?.scriptJobId;
  if (!jobId) throw new Error('No scriptJobId in metadata');

  // Check if script is already saved in project (idempotent)
  const { data: project } = await supabase.from('projects').select('script').eq('id', project_id).single();
  if (project?.script && project.script.length > 50) {
    console.log(`[orchestrator] [${id}] Script already in DB, advancing`);
    await advancePipeline(id, 'generate_audio');
    return;
  }

  // Poll VPS for job status
  const resp = await fetch(`${VPS_URL}/generate-script/status/${jobId}`);
  if (resp.status === 404) {
    // Job lost after VPS restart -- check if script landed in DB
    const { data: p2 } = await supabase.from('projects').select('script').eq('id', project_id).single();
    if (p2?.script && p2.script.length > 50) {
      console.log(`[orchestrator] [${id}] Job 404 but script found in DB`);
      await advancePipeline(id, 'generate_audio');
      return;
    }
    throw new Error('Script job lost (404) and no script in DB');
  }
  if (!resp.ok) return; // transient error, try again next loop

  const data = await resp.json();
  if (!data.success) return;

  if (data.status === 'completed') {
    console.log(`[orchestrator] [${id}] Script completed`);
    await advancePipeline(id, 'generate_audio');
  } else if (data.status === 'failed') {
    throw new Error(`Script generation failed: ${data.error || 'unknown'}`);
  }
  // else still processing -- do nothing, check next loop
}

async function stepGenerateAudio(pipeline) {
  const { id, project_id, user_id, config, metadata, calendar_entry_id } = pipeline;

  if (metadata?.audioJobId) {
    console.log(`[orchestrator] [${id}] Audio job already launched: ${metadata.audioJobId}`);
    await advancePipeline(id, 'wait_audio');
    return;
  }

  // Get script from project
  const { data: project } = await supabase.from('projects').select('script').eq('id', project_id).single();
  if (!project?.script) throw new Error('No script found in project');

  const ttsConfig = config.tts || {};

  // Build audioMetadata matching what the frontend sends
  const audioMetadata = {
    script: project.script,
    provider: ttsConfig.provider || 'edgetts',
    voice: ttsConfig.voice_id,
    model: ttsConfig.model,
    speed: ttsConfig.speed,
    stability: ttsConfig.stability,
    similarity: ttsConfig.similarity,
    style: ttsConfig.style,
    useSpeakerBoost: ttsConfig.useSpeakerBoost,
    pitch: ttsConfig.pitch,
    volume: ttsConfig.volume,
    languageBoost: ttsConfig.languageBoost,
    englishNormalization: ttsConfig.englishNormalization,
    emotion: ttsConfig.emotion,
  };

  if (ttsConfig.rvcEnabled) {
    audioMetadata.rvcEnabled = true;
    audioMetadata.rvcModelUrl = ttsConfig.rvcModelUrl;
    audioMetadata.rvcIndexUrl = ttsConfig.rvcIndexUrl;
    audioMetadata.rvcPitch = ttsConfig.rvcPitch;
    audioMetadata.rvcIndexRate = ttsConfig.rvcIndexRate;
  }

  if (ttsConfig.audioTagsEnabled && ttsConfig.audioTagsText) {
    audioMetadata.audioTagsEnabled = true;
    audioMetadata.audioTagsText = ttsConfig.audioTagsText;
  }

  // Call Edge Function via HTTP (same pattern as image-worker)
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: project_id,
      jobType: 'audio_generation',
      metadata: audioMetadata,
      userId: user_id,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`start-generation-job audio failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  const audioJobId = result.jobId;
  if (!audioJobId) throw new Error('No jobId returned for audio');

  await updatePipelineMetadata(id, { audioJobId });
  await updateCalendarStatus(calendar_entry_id, 'auto_audio');

  console.log(`[orchestrator] [${id}] Audio job launched: ${audioJobId}`);
  await advancePipeline(id, 'wait_audio');
}

async function stepWaitAudio(pipeline) {
  const { id, metadata, project_id } = pipeline;
  const jobId = metadata?.audioJobId;
  if (!jobId) throw new Error('No audioJobId in metadata');

  const { data: job } = await supabase.from('generation_jobs').select('status, metadata').eq('id', jobId).single();
  if (!job) return; // transient, retry

  if (job.status === 'completed') {
    const audioUrl = job.metadata?.audioUrl;
    if (audioUrl) {
      await supabase.from('projects').update({ audio_url: audioUrl }).eq('id', project_id);
      await updatePipelineMetadata(id, { audioUrl });
    }
    console.log(`[orchestrator] [${id}] Audio completed: ${audioUrl}`);
    await advancePipeline(id, 'transcribe');
  } else if (job.status === 'failed') {
    throw new Error(`Audio generation failed: ${job.metadata?.error || 'unknown'}`);
  }
}

async function stepTranscribe(pipeline) {
  const { id, project_id, user_id, metadata, calendar_entry_id } = pipeline;

  if (metadata?.transcriptionJobId) {
    console.log(`[orchestrator] [${id}] Transcription job already launched: ${metadata.transcriptionJobId}`);
    await advancePipeline(id, 'wait_transcription');
    return;
  }

  // Check if already transcribed (idempotent)
  const { data: project } = await supabase.from('projects').select('transcript_json').eq('id', project_id).single();
  if (project?.transcript_json && project.transcript_json.segments?.length > 0) {
    console.log(`[orchestrator] [${id}] Already transcribed, advancing`);
    await advancePipeline(id, 'create_scenes');
    return;
  }

  const audioUrl = metadata?.audioUrl;
  if (!audioUrl) throw new Error('No audioUrl in metadata');

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: project_id,
      jobType: 'transcription',
      metadata: { audioUrl },
      userId: user_id,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`start-generation-job transcription failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  const transcriptionJobId = result.jobId;
  if (!transcriptionJobId) throw new Error('No jobId returned for transcription');

  await updatePipelineMetadata(id, { transcriptionJobId });
  await updateCalendarStatus(calendar_entry_id, 'auto_transcribe');

  console.log(`[orchestrator] [${id}] Transcription job launched: ${transcriptionJobId}`);
  await advancePipeline(id, 'wait_transcription');
}

async function stepWaitTranscription(pipeline) {
  const { id, metadata, project_id } = pipeline;
  const jobId = metadata?.transcriptionJobId;
  if (!jobId) throw new Error('No transcriptionJobId in metadata');

  // Check if transcript already in project (idempotent)
  const { data: project } = await supabase.from('projects').select('transcript_json').eq('id', project_id).single();
  if (project?.transcript_json && project.transcript_json.segments?.length > 0) {
    console.log(`[orchestrator] [${id}] Transcript already in DB, advancing`);
    await advancePipeline(id, 'create_scenes');
    return;
  }

  const { data: job } = await supabase.from('generation_jobs').select('status, metadata').eq('id', jobId).single();
  if (!job) return;

  if (job.status === 'completed') {
    console.log(`[orchestrator] [${id}] Transcription completed`);
    await advancePipeline(id, 'create_scenes');
  } else if (job.status === 'failed') {
    throw new Error(`Transcription failed: ${job.metadata?.error || 'unknown'}`);
  }
}

async function stepCreateScenes(pipeline) {
  const { id, project_id, config, calendar_entry_id } = pipeline;

  // Get transcript
  const { data: project } = await supabase.from('projects').select('transcript_json, scenes').eq('id', project_id).single();
  if (!project?.transcript_json) throw new Error('No transcript_json in project');

  // Check if scenes already exist (idempotent)
  if (project.scenes && Array.isArray(project.scenes) && project.scenes.length > 0) {
    console.log(`[orchestrator] [${id}] Scenes already exist (${project.scenes.length}), advancing to prompts`);
    await advancePipeline(id, 'generate_prompts');
    return;
  }

  const projectConfig = config.project || {};
  const durationRanges = projectConfig.duration_ranges || DEFAULT_DURATION_RANGES;

  const scenes = parseTranscriptToScenes(project.transcript_json, durationRanges, true);
  console.log(`[orchestrator] [${id}] Generated ${scenes.length} scenes`);

  // Apply project preset + scenes
  const updatePayload = {
    scenes,
    image_model: projectConfig.image_model || 'seedream-4.5',
    image_width: projectConfig.image_width || 1920,
    image_height: projectConfig.image_height || 1080,
    aspect_ratio: projectConfig.aspect_ratio || '16:9',
    duration_ranges: durationRanges,
  };
  if (projectConfig.lora_url) updatePayload.lora_url = projectConfig.lora_url;
  if (projectConfig.lora_steps) updatePayload.lora_steps = projectConfig.lora_steps;
  if (projectConfig.example_prompts) updatePayload.example_prompts = projectConfig.example_prompts;
  if (projectConfig.prompt_system_message) updatePayload.prompt_system_message = projectConfig.prompt_system_message;
  if (projectConfig.style_reference_url) updatePayload.style_reference_url = projectConfig.style_reference_url;

  const { error } = await supabase.from('projects').update(updatePayload).eq('id', project_id);
  if (error) throw new Error(`Failed to save scenes: ${error.message}`);

  console.log(`[orchestrator] [${id}] Created ${scenes.length} scenes, advancing to prompts`);
  await advancePipeline(id, 'generate_prompts');
}

// ---------- PROMPTS ----------

async function stepGeneratePrompts(pipeline) {
  const { id, project_id, user_id, metadata, calendar_entry_id } = pipeline;

  if (metadata?.promptsJobId) {
    console.log(`[orchestrator] [${id}] Prompts job already launched: ${metadata.promptsJobId}`);
    await advancePipeline(id, 'wait_prompts');
    return;
  }

  // Idempotent: check if all scenes already have prompts
  const { data: project } = await supabase.from('projects').select('scenes, prompts').eq('id', project_id).single();
  const scenes = project?.scenes || [];
  const prompts = project?.prompts || [];
  if (scenes.length > 0 && prompts.length >= scenes.length && prompts.every(p => p?.text)) {
    console.log(`[orchestrator] [${id}] All ${prompts.length} prompts already exist, advancing to images`);
    await advancePipeline(id, 'generate_images');
    return;
  }

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: project_id,
      jobType: 'prompts',
      metadata: { skipExisting: true },
      userId: user_id,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`start-generation-job prompts failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  const promptsJobId = result.jobId;
  if (!promptsJobId) throw new Error('No jobId returned for prompts');

  await updatePipelineMetadata(id, { promptsJobId });
  await updateCalendarStatus(calendar_entry_id, 'auto_prompts');

  console.log(`[orchestrator] [${id}] Prompts job launched: ${promptsJobId}`);
  await advancePipeline(id, 'wait_prompts');
}

async function stepWaitPrompts(pipeline) {
  const { id, project_id } = pipeline;

  // Check if all scenes have prompts (works regardless of chunking/job IDs)
  const { data: project } = await supabase.from('projects').select('scenes, prompts').eq('id', project_id).single();
  const scenes = project?.scenes || [];
  const prompts = project?.prompts || [];

  if (scenes.length > 0 && prompts.length >= scenes.length && prompts.every(p => p?.text)) {
    console.log(`[orchestrator] [${id}] All ${prompts.length} prompts completed`);
    await advancePipeline(id, 'generate_images');
    return;
  }

  // Check if any prompt/single_prompt jobs are still active for this project
  const { data: activeJobs } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('project_id', project_id)
    .in('job_type', ['prompts', 'single_prompt'])
    .in('status', ['pending', 'processing'])
    .limit(1);

  if (activeJobs && activeJobs.length > 0) return; // still running

  // No active jobs and prompts incomplete — check if any failed
  const { data: failedJobs } = await supabase
    .from('generation_jobs')
    .select('id, error_message')
    .eq('project_id', project_id)
    .in('job_type', ['prompts', 'single_prompt'])
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(1);

  if (failedJobs && failedJobs.length > 0) {
    throw new Error(`Prompt generation failed: ${failedJobs[0].error_message || 'unknown'}`);
  }

  // Edge case: no active jobs, no failures, but prompts not complete — re-launch
  const completedPrompts = prompts.filter(p => p?.text).length;
  if (prompts.length < scenes.length || completedPrompts < scenes.length) {
    console.log(`[orchestrator] [${id}] Prompts incomplete (${completedPrompts}/${scenes.length} with text), no active jobs — re-launching`);
    await updatePipelineMetadata(id, { promptsJobId: null });
    await advancePipeline(id, 'generate_prompts');
  }
}

// ---------- IMAGES ----------

async function stepGenerateImages(pipeline) {
  const { id, project_id, user_id, metadata, calendar_entry_id } = pipeline;

  if (metadata?.imagesJobId) {
    console.log(`[orchestrator] [${id}] Images job already launched: ${metadata.imagesJobId}`);
    await advancePipeline(id, 'wait_images');
    return;
  }

  // Idempotent: check if all scenes already have images
  const { data: sceneRows } = await supabase
    .from('project_scenes')
    .select('id, image_url')
    .eq('project_id', project_id);

  if (sceneRows && sceneRows.length > 0 && sceneRows.every(s => s.image_url)) {
    console.log(`[orchestrator] [${id}] All ${sceneRows.length} images already exist, completing`);
    await updateCalendarStatus(calendar_entry_id, 'generating');
    await advancePipeline(id, 'completed', { step_status: 'completed' });
    return;
  }

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: project_id,
      jobType: 'images',
      metadata: { skipExisting: true },
      userId: user_id,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`start-generation-job images failed (${resp.status}): ${text}`);
  }

  const result = await resp.json();
  const imagesJobId = result.jobId;
  if (!imagesJobId) throw new Error('No jobId returned for images');

  await updatePipelineMetadata(id, { imagesJobId });
  await updateCalendarStatus(calendar_entry_id, 'auto_images');

  console.log(`[orchestrator] [${id}] Images job launched: ${imagesJobId}`);
  await advancePipeline(id, 'wait_images');
}

async function stepWaitImages(pipeline) {
  const { id, metadata, project_id, calendar_entry_id } = pipeline;
  const jobId = metadata?.imagesJobId;
  if (!jobId) throw new Error('No imagesJobId in metadata');

  const { data: job } = await supabase.from('generation_jobs').select('status, metadata, error_message').eq('id', jobId).single();
  if (!job) return;

  if (job.status === 'completed') {
    console.log(`[orchestrator] [${id}] All images completed`);
    await updateCalendarStatus(calendar_entry_id, 'generating');
    await advancePipeline(id, 'completed', { step_status: 'completed' });
    console.log(`[orchestrator] [${id}] Pipeline COMPLETED - project fully ready`);
  } else if (job.status === 'failed') {
    throw new Error(`Image generation failed: ${job.error_message || 'unknown'}`);
  }
}

// ============================================================================
// STEP DISPATCH
// ============================================================================

const STEP_HANDLERS = {
  create_project: stepCreateProject,
  generate_script: stepGenerateScript,
  wait_script: stepWaitScript,
  generate_audio: stepGenerateAudio,
  wait_audio: stepWaitAudio,
  transcribe: stepTranscribe,
  wait_transcription: stepWaitTranscription,
  create_scenes: stepCreateScenes,
  generate_prompts: stepGeneratePrompts,
  wait_prompts: stepWaitPrompts,
  generate_images: stepGenerateImages,
  wait_images: stepWaitImages,
};

// ============================================================================
// MAIN LOOP
// ============================================================================

async function processPipeline(pipeline) {
  const handler = STEP_HANDLERS[pipeline.current_step];
  if (!handler) {
    console.warn(`[orchestrator] Unknown step: ${pipeline.current_step}`);
    return;
  }

  try {
    await handler(pipeline);
  } catch (err) {
    const newRetry = (pipeline.retry_count || 0) + 1;
    console.error(`[orchestrator] [${pipeline.id}] Step "${pipeline.current_step}" error (retry ${newRetry}/${MAX_RETRIES}):`, err.message);

    if (newRetry >= MAX_RETRIES) {
      await failPipeline(pipeline.id, err.message);
      await updateCalendarStatus(pipeline.calendar_entry_id, 'planned');
    } else {
      await supabase.from('auto_pipelines').update({
        step_status: 'pending',
        retry_count: newRetry,
        error: String(err.message).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', pipeline.id);
    }
  }
}

async function pollLoop() {
  try {
    // Fetch active pipelines
    const { data: pipelines, error } = await supabase
      .from('auto_pipelines')
      .select('*')
      .in('step_status', ['pending', 'running'])
      .not('current_step', 'in', '("completed","failed")')
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('[orchestrator] Poll query error:', error.message);
      return;
    }

    if (!pipelines || pipelines.length === 0) return;

    console.log(`[orchestrator] Found ${pipelines.length} active pipeline(s)`);

    for (const pipeline of pipelines) {
      // Atomic claim for pending pipelines
      if (pipeline.step_status === 'pending') {
        const { data: claimed, error: claimErr } = await supabase
          .from('auto_pipelines')
          .update({ step_status: 'running', updated_at: new Date().toISOString() })
          .eq('id', pipeline.id)
          .eq('step_status', 'pending')
          .select('id')
          .single();

        if (claimErr || !claimed) continue; // another process claimed it
      }

      await processPipeline(pipeline);
    }
  } catch (err) {
    console.error('[orchestrator] Poll loop error:', err.message);
  }
}

// ============================================================================
// STARTUP
// ============================================================================

console.log('[orchestrator] Pipeline Orchestrator v1.0 starting...');
console.log(`[orchestrator] VPS_URL: ${VPS_URL}`);
console.log(`[orchestrator] Poll interval: ${POLL_INTERVAL}ms`);

setInterval(pollLoop, POLL_INTERVAL);
pollLoop();
