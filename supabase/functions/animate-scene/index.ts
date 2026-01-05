import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnimateSceneRequest {
  projectId: string;
  sceneIndex: number;
  imageUrl: string;
  prompt: string;
  sceneDuration: number; // Duration in seconds
}

// Calculate closest duration (4s, 8s, or 12s)
function getClosestDuration(duration: number): number {
  if (duration < 6) {
    return 4;
  } else if (duration < 10) {
    return 8;
  } else {
    return 12;
  }
}

Deno.serve(async (req) => {
  console.log('[animate-scene] Function invoked, method:', req.method);
  
  if (req.method === "OPTIONS") {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('[animate-scene] Starting request processing...');
    
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('[animate-scene] No authorization header');
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[animate-scene] Auth header present, getting env vars...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    console.log('[animate-scene] Env vars - URL:', supabaseUrl ? supabaseUrl.substring(0, 30) : 'EMPTY', 'AnonKey:', supabaseAnonKey ? supabaseAnonKey.length : 0, 'ServiceKey:', supabaseServiceKey ? supabaseServiceKey.length : 0);
    
    if (!supabaseServiceKey) {
      console.error('[animate-scene] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is not set!');
      return new Response(JSON.stringify({ 
        error: 'Server configuration error: Service key not available' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authenticate user
    console.log('[animate-scene] Creating supabase client for auth...');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    console.log('[animate-scene] Getting user...');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      console.error('[animate-scene] User auth error:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized', details: userError.message }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (!user) {
      console.error('[animate-scene] No user returned');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('[animate-scene] User authenticated:', user.id);

    let body: AnimateSceneRequest;
    try {
      body = await req.json();
      console.log(`[animate-scene] Request body received:`, JSON.stringify({ 
        projectId: body.projectId, 
        sceneIndex: body.sceneIndex,
        hasImageUrl: !!body.imageUrl,
        hasPrompt: !!body.prompt,
        sceneDuration: body.sceneDuration
      }));
    } catch (parseError: any) {
      console.error(`[animate-scene] Error parsing request body:`, parseError);
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body',
        details: parseError.message 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const { projectId, sceneIndex, imageUrl, prompt, sceneDuration } = body;

    if (!projectId || sceneIndex === undefined || !imageUrl || !prompt) {
      console.error(`[animate-scene] Missing required fields:`, {
        hasProjectId: !!projectId,
        sceneIndex,
        hasImageUrl: !!imageUrl,
        hasPrompt: !!prompt
      });
      return new Response(JSON.stringify({ 
        error: 'projectId, sceneIndex, imageUrl, and prompt are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's Kie.ai API key from Vault
    console.log('[animate-scene] Creating service client...');
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    console.log('[animate-scene] Service client created');

    console.log(`[animate-scene] Fetching Kie.ai API key for user: ${user.id}`);
    let keiApiKey: string;
    try {
      const { data: keiApiKeyData, error: keiKeyError } = await supabaseService
        .rpc('get_user_api_key_for_service', {
          target_user_id: user.id,
          key_name: 'kei'
        });

      if (keiKeyError) {
        console.error("[animate-scene] Error calling get_user_api_key_for_service:", keiKeyError);
        return new Response(JSON.stringify({ 
          error: "Erreur lors de la récupération de la clé API Kie.ai",
          details: keiKeyError.message
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!keiApiKeyData || keiApiKeyData.trim() === '') {
        console.error("[animate-scene] Kie.ai API key is empty or null");
        return new Response(JSON.stringify({ 
          error: "Clé API Kie.ai non configurée. Ajoutez-la dans votre profil." 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      keiApiKey = keiApiKeyData;
      console.log(`[animate-scene] Kie.ai API key retrieved (length: ${keiApiKey.length})`);
    } catch (keyError: any) {
      console.error("[animate-scene] Exception getting API key:", keyError);
      return new Response(JSON.stringify({ 
        error: "Erreur lors de la récupération de la clé API",
        details: keyError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create generation job for tracking
    const { data: animationJob, error: jobError } = await supabaseService
      .from('generation_jobs')
      .insert({
        project_id: projectId,
        user_id: user.id,
        job_type: 'single_animation',
        status: 'processing',
        progress: 0,
        total: 1,
        metadata: {
          sceneIndex,
          sceneDuration,
          imageUrl,
          prompt: prompt.substring(0, 100) // Store first 100 chars for reference
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error(`[animate-scene] Error creating job:`, jobError);
      console.error(`[animate-scene] Job error details:`, JSON.stringify(jobError, null, 2));
      // Continue anyway - job tracking is optional, but log the error
    } else {
      console.log(`[animate-scene] Created tracking job: ${animationJob.id}`);
    }

    // Calculate duration
    const duration = getClosestDuration(sceneDuration);
    console.log(`[animate-scene] Scene duration: ${sceneDuration}s, using Kie.ai duration: ${duration}s`);

    // Prepare request for Kie.ai Seedance 1.5 Pro
    const kieApiUrl = "https://api.kie.ai/api/v1/jobs/createTask";
    
    const requestBody = {
      model: "bytedance/seedance-1.5-pro", // Model identifier
      input: {
        prompt: prompt.substring(0, 2500), // Max 2500 chars
        input_urls: [imageUrl], // Image-to-Video
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: String(duration), // Must be a string
        fixed_lens: false,
        generate_audio: false
      }
    };

    console.log(`[animate-scene] Creating prediction for scene ${sceneIndex}...`);
    console.log(`[animate-scene] Request URL: ${kieApiUrl}`);
    console.log(`[animate-scene] Request body:`, JSON.stringify(requestBody, null, 2));

    // Create prediction
    const createResponse = await fetch(kieApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    console.log(`[animate-scene] Response status: ${createResponse.status}`);

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(`[animate-scene] Kie.ai API error: ${errorText}`);
      return new Response(JSON.stringify({ 
        error: `Kie.ai API error: ${createResponse.status} - ${errorText}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prediction = await createResponse.json();
    
    // Kie.ai API returns { code, msg, data: { taskId, status } }
    if (prediction.code !== 200 || !prediction.data) {
      const errorMsg = prediction.msg || 'Failed to create task';
      console.error(`[animate-scene] Kie.ai API error: ${errorMsg}`, prediction);
      return new Response(JSON.stringify({ 
        error: `Kie.ai API error: ${errorMsg}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const predictionId = prediction.data.taskId;
    const taskStatus = prediction.data.status;

    if (!predictionId) {
      return new Response(JSON.stringify({ 
        error: 'Failed to create task - no taskId returned' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[animate-scene] Task created: ${predictionId}, status: ${taskStatus}`);

    // Update job with taskId - polling will be done separately
    if (animationJob) {
      await supabaseService
        .from('generation_jobs')
        .update({ 
          progress: 5,
          metadata: {
            ...animationJob.metadata,
            predictionId,
            kieApiStatus: taskStatus,
            kieApiTaskId: predictionId
          }
        })
        .eq('id', animationJob.id);
    }

    // Return immediately - polling will be handled by a separate function or frontend
    // Edge Functions have timeout limits, so we can't poll here for long-running tasks
    console.log(`[animate-scene] Task ${predictionId} created successfully, returning immediately for async processing`);

    const response = {
      success: true,
      taskId: predictionId,
      status: taskStatus,
      sceneIndex,
      duration: `${duration}s`,
      jobId: animationJob?.id || null,
      message: 'Animation task created. Polling will continue in background.'
    };
    
    console.log(`[animate-scene] Returning response:`, JSON.stringify(response, null, 2));
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[animate-scene] Unhandled error:', error);
    console.error('[animate-scene] Error stack:', error.stack);
    console.error('[animate-scene] Error name:', error.name);
    console.error('[animate-scene] Error message:', error.message);
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      details: error.stack ? error.stack.substring(0, 500) : 'No stack trace',
      type: error.name || 'UnknownError'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
