import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MANUAL_RETRIES = 5;

// REWIND_MAP: when a step fails, where do we send the pipeline back so the
// retry actually re-does the failed work (instead of getting stuck)?
//
// Two layers:
//   1. wait_* steps rewind to their generate_* counterpart (and clear the
//      stale JobId so a new job is launched).
//   2. generate_* steps rewind to themselves (identity) and clear their
//      JobId so the launch is re-attempted from scratch. Without this,
//      a pipeline that fails 3x at e.g. `generate_audio` stays at
//      `generate_audio` after retry but with no way to make progress —
//      the orchestrator just re-fails on the same root cause.
//
// The `requireScript` flag (only used by `generate_audio`) lets us rewind
// even further back to `generate_script` when the audio step failed
// because `projects.script` was empty in DB. This was the symptom of the
// May 2026 video-render-service dotenv bug — even after we fixed it, the
// already-failed pipelines needed `Réessayer` to re-trigger script gen,
// not just re-run audio gen on a still-empty script.
const REWIND_MAP: Record<
  string,
  { step: string; clearKey?: string; requireScript?: boolean }
> = {
  wait_script:        { step: "generate_script", clearKey: "scriptJobId" },
  generate_script:    { step: "generate_script", clearKey: "scriptJobId" },
  wait_audio:         { step: "generate_audio",  clearKey: "audioJobId" },
  generate_audio:     { step: "generate_audio",  clearKey: "audioJobId", requireScript: true },
  wait_transcription: { step: "transcribe",      clearKey: "transcriptionJobId" },
  transcribe:         { step: "transcribe",      clearKey: "transcriptionJobId" },
  wait_prompts:       { step: "generate_prompts", clearKey: "promptsJobId" },
  generate_prompts:   { step: "generate_prompts", clearKey: "promptsJobId" },
  wait_images:        { step: "generate_images",  clearKey: "imagesJobId" },
  generate_images:    { step: "generate_images",  clearKey: "imagesJobId" },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { pipelineId } = await req.json();
    if (!pipelineId) {
      return new Response(JSON.stringify({ error: 'pipelineId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify caller identity via user client
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch pipeline with admin to bypass RLS
    const { data: pipeline, error: fetchErr } = await supabaseAdmin
      .from('auto_pipelines')
      .select('*')
      .eq('id', pipelineId)
      .single();

    if (fetchErr || !pipeline) {
      return new Response(JSON.stringify({ error: 'Pipeline not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SAFETY: Only allow retry on actually failed pipelines
    if (pipeline.step_status !== 'failed') {
      return new Response(JSON.stringify({ error: `Cannot retry: pipeline is "${pipeline.step_status}", not "failed"` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SAFETY: Enforce lifetime manual retry limit
    const metadata = pipeline.metadata || {};
    const totalManualRetries = (metadata.totalManualRetries || 0) + 1;
    if (totalManualRetries > MAX_MANUAL_RETRIES) {
      return new Response(JSON.stringify({ 
        error: `Limite de ${MAX_MANUAL_RETRIES} réessais manuels atteinte. Créez un nouveau pipeline.` 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine the correct step to rewind to
    const currentStep = pipeline.current_step;
    let rewind = REWIND_MAP[currentStep];

    // Special case: if we failed at generate_audio but the project has no
    // script, rewind further back to generate_script so the retry actually
    // produces a script first. Otherwise the retry would just hit the same
    // "No script found in project" error 3 times in a row.
    if (rewind?.requireScript && pipeline.project_id) {
      const { data: project } = await supabaseAdmin
        .from('projects')
        .select('script')
        .eq('id', pipeline.project_id)
        .single();
      const hasScript =
        typeof project?.script === 'string' && project.script.trim().length > 50;
      if (!hasScript) {
        rewind = { step: 'generate_script', clearKey: 'scriptJobId' };
      }
    }

    const newMetadata = { ...metadata, totalManualRetries };
    if (rewind?.clearKey) {
      delete newMetadata[rewind.clearKey];
    }

    const updatePayload: Record<string, unknown> = {
      step_status: 'pending',
      error: null,
      retry_count: 0,
      metadata: newMetadata,
      updated_at: new Date().toISOString(),
    };
    if (rewind) {
      updatePayload.current_step = rewind.step;
    }

    // Atomic update: only if still failed (prevents double-click race)
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('auto_pipelines')
      .update(updatePayload)
      .eq('id', pipelineId)
      .eq('step_status', 'failed')
      .select('id')
      .single();

    if (updateErr || !updated) {
      return new Response(JSON.stringify({ error: 'Pipeline already retried or state changed' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[retry-pipeline] Pipeline ${pipelineId} retried (attempt ${totalManualRetries}/${MAX_MANUAL_RETRIES}, step ${currentStep} -> ${rewind?.step || currentStep})`);

    return new Response(JSON.stringify({ 
      success: true, 
      step: rewind?.step || currentStep,
      manualRetry: totalManualRetries,
      maxRetries: MAX_MANUAL_RETRIES,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
