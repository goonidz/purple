import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MANUAL_RETRIES = 5;

const REWIND_MAP: Record<string, { step: string; clearKey: string }> = {
  wait_script: { step: "generate_script", clearKey: "scriptJobId" },
  wait_audio: { step: "generate_audio", clearKey: "audioJobId" },
  wait_transcription: { step: "transcribe", clearKey: "transcriptionJobId" },
  wait_prompts: { step: "generate_prompts", clearKey: "promptsJobId" },
  wait_images: { step: "generate_images", clearKey: "imagesJobId" },
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
    const rewind = REWIND_MAP[currentStep];

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
