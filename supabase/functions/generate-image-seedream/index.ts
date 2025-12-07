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

    const sanitizePrompt = (prompt: string): string =>
      typeof prompt === "string" ? prompt.replace(/dead/gi, "") : prompt;

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

    const sanitizedPrompt = sanitizePrompt(body.prompt)
    
    // Determine which model to use (default to seedream-4.5)
    const modelVersion = body.model || 'seedream-4.5';
    const modelName = modelVersion === 'seedream-4' ? 'bytedance/seedream-4' : 'bytedance/seedream-4.5';
    
    console.log(`Generating image with ${modelVersion}, prompt:`, sanitizedPrompt)
    
    let width = body.width || 2048;
    let height = body.height || 2048;
    const requestedWidth = width;
    const requestedHeight = height;
    
    // SeedDream 4.5 with image_input requires minimum 3,686,400 pixels which causes timeouts
    // For 4.5: skip image_input entirely to avoid upscaling and timeout issues
    // For 4.0: use image_input normally (no pixel constraint)
    const useImageInput = modelVersion === 'seedream-4' && body.image_urls && body.image_urls.length > 0;
    
    if (modelVersion === 'seedream-4.5' && body.image_urls && body.image_urls.length > 0) {
      console.log(`SeedDream 4.5: skipping image_input to avoid 3.6M pixel requirement and timeout. Style guidance via prompt only.`);
    }
    
    const input: any = {
      prompt: sanitizedPrompt,
      size: "custom",
      width,
      height,
    }

    // Add image reference only for SeedDream 4.0 (4.5 causes timeouts with image_input)
    if (useImageInput) {
      input.image_input = body.image_urls;
      console.log(`SeedDream 4.0: using ${body.image_urls.length} image references`);
    }

    // Add optional parameters if provided
    if (body.seed) input.seed = body.seed
    if (body.guidance_scale) input.guidance_scale = body.guidance_scale
    if (body.num_inference_steps) input.num_inference_steps = body.num_inference_steps

    console.log(`${modelVersion} input parameters:`, input)

    let output;
    let lastError;
    const MAX_RETRIES = 4;

    // Try up to MAX_RETRIES times with exponential backoff
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Generation attempt ${attempt}/${MAX_RETRIES}`)
        output = await replicate.run(
          modelName,
          { input }
        )
        console.log(`${modelVersion} generation complete`)
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

    // If uploadToStorage flag is set, download the image and upload to Supabase Storage
    if (body.uploadToStorage && Array.isArray(output) && output.length > 0) {
      const replicateUrl = output[0];
      console.log("Downloading image from Replicate for storage upload:", replicateUrl);
      
      try {
        const imageResponse = await fetch(replicateUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }
        
        const imageBlob = await imageResponse.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const fileName = `${user.id}/${body.storageFolder || 'generated'}/${Date.now()}_${body.filePrefix || 'image'}.jpg`;
        
        const { error: uploadError } = await supabaseService.storage
          .from("generated-images")
          .upload(fileName, uint8Array, {
            contentType: 'image/jpeg',
            upsert: false
          });

        if (uploadError) {
          console.error("Storage upload error:", uploadError);
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = supabaseService.storage
          .from("generated-images")
          .getPublicUrl(fileName);

        console.log("Image uploaded to storage:", publicUrl);
        
        return new Response(JSON.stringify({ output: [publicUrl], originalOutput: output }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (storageError: any) {
        console.error("Storage upload failed, returning original URL:", storageError.message);
        // Fall back to returning original Replicate URL
      }
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