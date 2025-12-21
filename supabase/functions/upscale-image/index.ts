import Replicate from "https://esm.sh/replicate@0.25.2"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Real-ESRGAN model on Replicate
const REAL_ESRGAN_MODEL = "nightmareai/real-esrgan";

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

    const replicate = new Replicate({
      auth: apiKey,
    });

    const body = await req.json();

    // If it's a status check request
    if (body.predictionId) {
      console.log("Checking status for upscale prediction:", body.predictionId);
      const prediction = await replicate.predictions.get(body.predictionId);
      console.log("Status check response:", prediction.status);
      return new Response(JSON.stringify(prediction), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate required input
    if (!body.imageUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required field: imageUrl" }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const imageUrl = body.imageUrl;
    const scale = body.scale || 2; // Default to 2x upscale
    const faceEnhance = body.faceEnhance || false;

    console.log(`Upscaling image with Real-ESRGAN (scale: ${scale}x, face_enhance: ${faceEnhance})`);
    console.log(`Input image: ${imageUrl}`);

    const input = {
      image: imageUrl,
      scale: scale,
      face_enhance: faceEnhance,
    };

    // Check if async mode is requested (webhook-based)
    const asyncMode = body.async === true;
    const webhookUrl = body.webhook_url;

    if (asyncMode) {
      console.log("Starting async upscale", webhookUrl ? "with webhook" : "with polling mode");
      
      try {
        // Get latest version of the model
        const modelInfo = await replicate.models.get("nightmareai", "real-esrgan");
        const latestVersion = modelInfo.latest_version?.id;
        
        if (!latestVersion) {
          throw new Error("Could not find latest version for Real-ESRGAN model");
        }
        
        console.log("Found Real-ESRGAN version:", latestVersion);
        
        const createOptions: any = {
          version: latestVersion,
          input,
        };
        
        if (webhookUrl) {
          createOptions.webhook = webhookUrl;
          createOptions.webhook_events_filter = ["completed"];
          console.log("Webhook configured:", webhookUrl);
        }
        
        const prediction = await replicate.predictions.create(createOptions);
        
        console.log("Upscale prediction created:", prediction.id, "status:", prediction.status);
        
        return new Response(JSON.stringify({ 
          predictionId: prediction.id,
          status: prediction.status
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (error: any) {
        console.error("Error creating upscale prediction:", error.message);
        throw error;
      }
    }

    // Synchronous mode - wait for result
    let output;
    let lastError;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Upscale attempt ${attempt}/${MAX_RETRIES}`);
        output = await replicate.run(REAL_ESRGAN_MODEL, { input });
        console.log("Upscale complete");
        break;
      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt < MAX_RETRIES) {
          const delayMs = 2000 * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delayMs / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    if (!output) {
      throw lastError || new Error("Upscale failed after all retries");
    }

    // If uploadToStorage flag is set, download and upload to Supabase Storage
    if (body.uploadToStorage && output) {
      const upscaledUrl = typeof output === 'string' ? output : output;
      console.log("Downloading upscaled image for storage upload:", upscaledUrl);
      
      try {
        const imageResponse = await fetch(upscaledUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch upscaled image: ${imageResponse.status}`);
        }
        
        const imageBlob = await imageResponse.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const fileName = `${userId}/${body.storageFolder || 'upscaled'}/${Date.now()}_${body.filePrefix || 'upscaled'}.jpg`;
        
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

        console.log("Upscaled image uploaded to storage:", publicUrl);
        
        return new Response(JSON.stringify({ output: publicUrl, originalOutput: output }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (storageError: any) {
        console.error("Storage upload failed, returning original URL:", storageError.message);
      }
    }

    return new Response(JSON.stringify({ output }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error("Error in upscale-image function:", error);
    return new Response(JSON.stringify({ 
      error: error.message || 'An unexpected error occurred' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
