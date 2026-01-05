import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
function getClosestDuration(duration: number): "4" | "8" | "12" {
  if (duration < 6) {
    return "4";
  } else if (duration < 10) {
    return "8";
  } else {
    return "12";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Authenticate user
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: AnimateSceneRequest = await req.json();
    const { projectId, sceneIndex, imageUrl, prompt, sceneDuration } = body;

    if (!projectId || sceneIndex === undefined || !imageUrl || !prompt) {
      return new Response(JSON.stringify({ 
        error: 'projectId, sceneIndex, imageUrl, and prompt are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's Kie.ai API key from Vault
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[animate-scene] Fetching Kie.ai API key for user: ${user.id}`);
    const { data: keiApiKey, error: keiKeyError } = await supabaseService
      .rpc('get_user_api_key_for_service', {
        target_user_id: user.id,
        key_name: 'kei'
      });

    if (keiKeyError || !keiApiKey || keiApiKey.trim() === '') {
      console.error("Error getting Kie.ai API key:", keiKeyError);
      return new Response(JSON.stringify({ 
        error: "Clé API Kie.ai non configurée. Ajoutez-la dans votre profil." 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[animate-scene] Kie.ai API key retrieved (length: ${keiApiKey.length})`);

    // Calculate duration
    const duration = getClosestDuration(sceneDuration);
    console.log(`[animate-scene] Scene duration: ${sceneDuration}s, using Kie.ai duration: ${duration}s`);

    // Prepare request for Kie.ai Seedance 1.5 Pro
    const kieApiUrl = "https://api.kie.ai/v1/predictions";
    
    const requestBody = {
      version: "seedance-1-5-pro", // Model identifier
      input: {
        prompt: prompt.substring(0, 2500), // Max 2500 chars
        input_urls: [imageUrl], // Image-to-Video
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: duration,
        fixed_lens: false,
        generate_audio: false
      }
    };

    console.log(`[animate-scene] Creating prediction for scene ${sceneIndex}...`);

    // Create prediction
    const createResponse = await fetch(kieApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

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
    const predictionId = prediction.id;

    if (!predictionId) {
      return new Response(JSON.stringify({ 
        error: 'Failed to create prediction - no ID returned' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[animate-scene] Prediction created: ${predictionId}, status: ${prediction.status}`);

    // Poll for completion (no timeout - can take several minutes)
    let finalStatus = prediction.status;
    let videoUrl: string | null = null;
    let attempts = 0;
    const maxAttempts = 300; // 300 * 5s = 25 minutes max (should be enough)

    while (finalStatus !== 'succeeded' && finalStatus !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;

      console.log(`[animate-scene] Polling attempt ${attempts}/${maxAttempts} for prediction ${predictionId}...`);

      const statusResponse = await fetch(`${kieApiUrl}/${predictionId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${keiApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!statusResponse.ok) {
        console.error(`[animate-scene] Error checking status: ${statusResponse.status}`);
        break;
      }

      const statusData = await statusResponse.json();
      finalStatus = statusData.status;
      
      console.log(`[animate-scene] Prediction ${predictionId} status: ${finalStatus}`);

      if (finalStatus === 'succeeded') {
        // Extract video URL from output
        if (statusData.output && typeof statusData.output === 'string') {
          videoUrl = statusData.output;
        } else if (statusData.output && Array.isArray(statusData.output) && statusData.output.length > 0) {
          videoUrl = statusData.output[0];
        } else if (statusData.output && statusData.output.video) {
          videoUrl = statusData.output.video;
        }
        break;
      } else if (finalStatus === 'failed') {
        const errorMsg = statusData.error || 'Unknown error';
        console.error(`[animate-scene] Prediction failed: ${errorMsg}`);
        return new Response(JSON.stringify({ 
          error: `Animation failed: ${errorMsg}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (finalStatus !== 'succeeded' || !videoUrl) {
      return new Response(JSON.stringify({ 
        error: `Animation timed out or failed. Final status: ${finalStatus}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[animate-scene] Animation completed! Video URL: ${videoUrl}`);

    // Update project prompts with videoUrl
    const { data: project } = await supabaseService
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompts = (project.prompts as any[]) || [];
    if (sceneIndex >= prompts.length) {
      return new Response(JSON.stringify({ error: 'Invalid scene index' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update the specific scene with videoUrl
    prompts[sceneIndex] = {
      ...prompts[sceneIndex],
      videoUrl: videoUrl
    };

    const { error: updateError } = await supabaseService
      .from('projects')
      .update({ prompts })
      .eq('id', projectId);

    if (updateError) {
      console.error(`[animate-scene] Error updating project:`, updateError);
      return new Response(JSON.stringify({ 
        error: `Failed to update project: ${updateError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[animate-scene] Project updated successfully with videoUrl for scene ${sceneIndex}`);

    return new Response(JSON.stringify({
      success: true,
      videoUrl,
      sceneIndex,
      duration: `${duration}s`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[animate-scene] Error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
