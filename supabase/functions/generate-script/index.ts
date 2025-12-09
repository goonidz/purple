import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Replicate from "https://esm.sh/replicate@0.25.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error("No authorization header");
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create admin client to verify user
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log("User authenticated:", user.id);

    const { customPrompt, jobId, useWebhook } = await req.json();

    if (!customPrompt) {
      throw new Error("Custom prompt is required");
    }

    console.log("Generating script with custom prompt, useWebhook:", useWebhook);

    // Get user's Replicate API key from Vault
    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin.rpc(
      'get_user_api_key_for_service',
      { target_user_id: user.id, key_name: 'replicate' }
    );

    if (apiKeyError || !apiKeyData) {
      console.error("Error fetching Replicate API key:", apiKeyError);
      return new Response(
        JSON.stringify({ error: "Replicate API key not configured. Please add it in your profile." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const replicate = new Replicate({ auth: apiKeyData });

    // Use the custom prompt directly as the user prompt
    const systemPrompt = `Tu es un assistant d'écriture professionnel. Tu génères exactement ce que l'utilisateur demande, sans commentaires ni explications supplémentaires. Réponds uniquement avec le contenu demandé.`;

    const userPrompt = customPrompt;

    console.log("Calling Claude via Replicate...");

    // If using webhook mode, create async prediction
    if (useWebhook && jobId) {
      const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;
      
      console.log("Creating async prediction with webhook:", webhookUrl);
      
      const prediction = await replicate.predictions.create({
        model: "anthropic/claude-4.5-sonnet",
        input: {
          prompt: userPrompt,
          system_prompt: systemPrompt,
          max_tokens: 16384,
          temperature: 0.7,
        },
        webhook: webhookUrl,
        webhook_events_filter: ["completed"],
      });

      console.log("Prediction created:", prediction.id);

      // Store prediction in pending_predictions
      const { error: insertError } = await supabaseAdmin
        .from('pending_predictions')
        .insert({
          prediction_id: prediction.id,
          prediction_type: 'script',
          user_id: user.id,
          job_id: jobId,
          status: 'pending',
          metadata: {
            customPrompt,
          }
        });

      if (insertError) {
        console.error("Error storing prediction:", insertError);
      }

      return new Response(
        JSON.stringify({ 
          status: 'processing',
          predictionId: prediction.id,
          message: 'Script generation started'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Synchronous mode (fallback)
    const output = await replicate.run(
      "anthropic/claude-4.5-sonnet",
      {
        input: {
          prompt: userPrompt,
          system_prompt: systemPrompt,
          max_tokens: 16384,
          temperature: 0.7,
        }
      }
    );

    // Handle output - it might be an array or string
    let script = "";
    if (Array.isArray(output)) {
      script = output.join("");
    } else if (typeof output === "string") {
      script = output;
    } else {
      script = String(output);
    }

    console.log("Script generated, length:", script.length);

    return new Response(
      JSON.stringify({ 
        script,
        wordCount: script.split(/\s+/).length,
        estimatedDuration: Math.round(script.split(/\s+/).length / 2.5) // ~150 words per minute
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Script generation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
