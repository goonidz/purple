import Replicate from "https://esm.sh/replicate@0.25.2"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's API key from Supabase Vault using service role
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKey, error: apiKeyError } = await supabaseService
      .rpc('get_user_api_key_for_service', {
        target_user_id: user.id,
        key_name: 'replicate'
      });

    if (apiKeyError || !apiKey) {
      console.error('Error retrieving API key:', apiKeyError);
      return new Response(JSON.stringify({ 
        error: 'Replicate API key not configured. Please add your API key in your profile.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const REPLICATE_API_KEY = apiKey;

    const replicate = new Replicate({
      auth: REPLICATE_API_KEY,
    })

    const body = await req.json()

    // If it's a status check request
    if (body.predictionId) {
      console.log("Checking status for prediction:", body.predictionId)
      const prediction = await replicate.predictions.get(body.predictionId)
      console.log("Status check response:", prediction.status)
      return new Response(JSON.stringify(prediction), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If it's a generation request
    if (!body.prompt) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required field: prompt is required" 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    console.log("Generating image with SeedDream 4, prompt:", body.prompt)
    
    const input: any = {
      prompt: body.prompt,
      size: "custom",
      width: body.width || 2048,
      height: body.height || 2048,
    }

    // Add image reference if provided
    if (body.image_urls && body.image_urls.length > 0) {
      input.image_input = body.image_urls
    }

    // Add optional parameters if provided
    if (body.seed) input.seed = body.seed
    if (body.guidance_scale) input.guidance_scale = body.guidance_scale
    if (body.num_inference_steps) input.num_inference_steps = body.num_inference_steps

    console.log("SeedDream 4 input parameters:", input)

    let output;
    let lastError;
    const MAX_RETRIES = 4;

    // Try up to MAX_RETRIES times with exponential backoff
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Generation attempt ${attempt}/${MAX_RETRIES}`)
        output = await replicate.run(
          "bytedance/seedream-4",
          { input }
        )
        console.log("SeedDream 4 generation complete")
        break; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message)
        
        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 3s, 6s, 12s
          const delayMs = 3000 * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delayMs / 1000} seconds...`)
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // If all retries failed, throw the last error
    if (!output) {
      throw lastError || new Error("Image generation failed after all retries");
    }

    return new Response(JSON.stringify({ output }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error("Error in generate-image-seedream function:", error)
    return new Response(JSON.stringify({ 
      error: error.message || 'An unexpected error occurred' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
