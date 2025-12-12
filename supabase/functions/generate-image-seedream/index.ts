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
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if this is a service role key (internal call)
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isServiceRoleCall = authHeader === `Bearer ${serviceRoleKey}`;
    
    let userId: string;
    
    if (isServiceRoleCall) {
      // Internal call - get userId from request body
      const bodyClone = req.clone();
      const bodyData = await bodyClone.json();
      if (!bodyData.userId) {
        return new Response(JSON.stringify({ error: 'userId required for internal calls' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = bodyData.userId;
      console.log(`Internal call for user ${userId}`);
    } else {
      // Normal user call - verify user authentication
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    // Get user's API key from Supabase Vault using service role
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKey, error: apiKeyError } = await supabaseService
      .rpc('get_user_api_key_for_service', {
        target_user_id: userId,
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
    
    // Model name mapping
    let modelName: string;
    if (modelVersion === 'seedream-4') {
      modelName = 'bytedance/seedream-4';
    } else if (modelVersion === 'z-image-turbo') {
      modelName = 'prunaai/z-image-turbo';
    } else if (modelVersion === 'z-image-turbo-lora') {
      // Use latest version (no version hash) - the old hash lacked PEFT backend for LoRA loading
      modelName = 'prunaai/z-image-turbo-lora';
    } else {
      modelName = 'bytedance/seedream-4.5';
    }
    
    console.log(`Generating image with ${modelVersion}, prompt:`, sanitizedPrompt)
    
    let width = body.width || 2048;
    let height = body.height || 2048;
    const requestedWidth = width;
    const requestedHeight = height;
    
    // Z-Image Turbo and LoRA: max dimension is 1440
    if (modelVersion === 'z-image-turbo' || modelVersion === 'z-image-turbo-lora') {
      const MAX_DIM = 1440;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.floor(width * scale);
        height = Math.floor(height * scale);
        console.log(`${modelVersion}: scaled from ${requestedWidth}x${requestedHeight} to ${width}x${height} (max 1440px)`);
      }

      // All z-image turbo variants require width/height to be divisible by 16.
      // We start from the project configuration dimensions and then snap to the
      // nearest valid multiples of 16 to satisfy the API requirements.
      width = Math.round(width / 16) * 16;
      height = Math.round(height / 16) * 16;
      console.log(`${modelVersion}: dimensions rounded to multiples of 16: ${width}x${height}`);
    }
    
    // SeedDream 4.5 requires minimum 3,686,400 pixels when using image_input (style references)
    // SeedDream 4.0 does not have this constraint
    if (modelVersion === 'seedream-4.5' && body.image_urls && body.image_urls.length > 0) {
      const MIN_PIXELS = 3686400;
      const currentPixels = width * height;
      if (currentPixels < MIN_PIXELS) {
        const scaleFactor = Math.sqrt(MIN_PIXELS / currentPixels);
        width = Math.ceil(width * scaleFactor);
        height = Math.ceil(height * scaleFactor);
        console.log(`SeedDream 4.5 with image references: scaled from ${requestedWidth}x${requestedHeight} to ${width}x${height} to meet minimum pixel requirement`);
      }
    }
    
    const input: any = {
      prompt: sanitizedPrompt,
    }

    // Z-Image Turbo uses different input format
    if (modelVersion === 'z-image-turbo') {
      input.width = width;
      input.height = height;
      input.guidance_scale = 0; // Required for turbo models
      input.num_inference_steps = body.num_inference_steps || 8;
    } else if (modelVersion === 'z-image-turbo-lora') {
      input.width = width;
      input.height = height;
      input.guidance_scale = 0; // Required for turbo models
      input.num_inference_steps = body.lora_steps || body.num_inference_steps || 10;
      // Default output settings to match working manual JSON
      input.output_format = body.output_format || 'jpg';
      input.output_quality = body.output_quality || 80;
      // Add LoRA weights & scales if provided
      if (body.lora_url || body.lora_weights) {
        const weights = body.lora_weights || (Array.isArray(body.lora_url) ? body.lora_url : [body.lora_url]);
        input.lora_weights = weights;
        // If no explicit scales are provided, default to 1.0 so the LoRA actually influences the image
        const scales = body.lora_scales || new Array(weights.length).fill(1.0);
        input.lora_scales = scales;
        console.log('Z-Image Turbo LoRA: using lora_weights', weights, 'with lora_scales', scales);
      }
    } else {
      // SeedDream models
      input.size = "custom";
      input.width = width;
      input.height = height;
      
      // Add image reference if provided (only for SeedDream models)
      if (body.image_urls && body.image_urls.length > 0) {
        input.image_input = body.image_urls;
        console.log(`${modelVersion}: using ${body.image_urls.length} image references`);
      }
      
      // Add optional parameters if provided
      if (body.seed) input.seed = body.seed
      if (body.guidance_scale) input.guidance_scale = body.guidance_scale
      if (body.num_inference_steps) input.num_inference_steps = body.num_inference_steps
    }

    console.log(`${modelVersion} input parameters:`, input)

    // Check if async mode is requested (polling-based or webhook-based)
    const asyncMode = body.async === true;
    const webhookUrl = body.webhook_url;
    
    if (asyncMode) {
      // Async mode: create prediction and return immediately
      console.log("Starting async generation", webhookUrl ? "with webhook" : "with polling mode");
      try {
        // Replicate's predictions.create prefers explicit version instead of model path
        const [baseModel, modelVersionHash] = modelName.split(":");

        const createOptions: any = {
          input,
        };

        if (modelVersionHash) {
          // When a specific version hash is provided (e.g. "prunaai/z-image-turbo-lora:dfa1...")
          // ONLY use the version field - do NOT pass model alongside version
          createOptions.version = modelVersionHash;
        } else {
          // Fallback: let Replicate use the latest version for this model
          createOptions.model = modelName;
        }
        
        // Add webhook if provided
        if (webhookUrl) {
          createOptions.webhook = webhookUrl;
          createOptions.webhook_events_filter = ["completed"];
          console.log("Webhook configured:", webhookUrl);
        }
        
        const prediction = await replicate.predictions.create(createOptions);
        
        console.log("Prediction created:", prediction.id, "status:", prediction.status);
        
        return new Response(JSON.stringify({ 
          predictionId: prediction.id,
          status: prediction.status
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (error: any) {
        console.error("Error creating prediction:", error.message);
        throw error;
      }
    }
    
    // Synchronous mode (original behavior)
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
        
        const fileName = `${userId}/${body.storageFolder || 'generated'}/${Date.now()}_${body.filePrefix || 'image'}.jpg`;
        
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
