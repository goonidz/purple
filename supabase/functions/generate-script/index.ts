import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import Replicate from "https://esm.sh/replicate@0.25.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Extract target word count from prompt
function extractTargetWordCount(prompt: string): number | null {
  // Look for patterns like "5000 mots", "5000 words", "5k mots", etc.
  const patterns = [
    /(\d+)\s*000?\s*mots/i,
    /(\d+)\s*k\s*mots/i,
    /(\d+)\s*000?\s*words/i,
    /(\d+)\s*k\s*words/i,
    /(\d+)\s*mots/i,
    /(\d+)\s*words/i,
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      let count = parseInt(match[1]);
      // Handle "5k" format
      if (prompt.toLowerCase().includes('k mots') || prompt.toLowerCase().includes('k words')) {
        count *= 1000;
      }
      // Handle "5 000" format (already captured as 5000)
      return count;
    }
  }
  return null;
}

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

    const { customPrompt, jobId, useWebhook, scriptModel } = await req.json();

    if (!customPrompt) {
      throw new Error("Custom prompt is required");
    }

    // Default to Claude if no model specified
    const selectedModel = scriptModel || "claude";
    console.log(`Generating script with model: ${selectedModel}, useWebhook: ${useWebhook}`);

    // Extract target word count from prompt
    const targetWordCount = extractTargetWordCount(customPrompt);
    console.log(`Target word count detected: ${targetWordCount}`);

    // Use the custom prompt directly as the user prompt
    const systemPrompt = `Tu es un assistant d'écriture professionnel. Tu génères exactement ce que l'utilisateur demande, sans commentaires ni explications supplémentaires. Réponds uniquement avec le contenu demandé.

RÈGLE CRITIQUE SUR LA LONGUEUR:
- Si l'utilisateur demande un certain nombre de mots, tu DOIS atteindre ce nombre MINIMUM
- Ne t'arrête JAMAIS avant d'avoir atteint le nombre de mots demandé
- Développe chaque section en profondeur pour atteindre la longueur requise
- Ajoute des détails, des exemples, des transitions, des descriptions riches`;

    const userPrompt = customPrompt;

    // Handle GPT-5.1 via Replicate
    if (selectedModel === "gpt5") {
      console.log("Using GPT-5.1 via Replicate...");

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

      // If using webhook mode, create async prediction
      if (useWebhook && jobId) {
        const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;
        
        console.log("Creating async GPT-5.1 prediction with webhook:", webhookUrl);
        
        const prediction = await replicate.predictions.create({
          model: "openai/gpt-5.1",
          input: {
            prompt: userPrompt,
            system_prompt: systemPrompt,
            max_tokens: 64000,
          },
          webhook: webhookUrl,
          webhook_events_filter: ["completed"],
        });

        console.log("GPT-5.1 prediction created:", prediction.id);

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
              model: 'gpt-5.1'
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
        "openai/gpt-5.1",
        {
          input: {
            prompt: userPrompt,
            system_prompt: systemPrompt,
            max_tokens: 64000,
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

      const finalWordCount = script.split(/\s+/).filter(w => w.length > 0).length;
      console.log(`Script generated with GPT-5.1, word count: ${finalWordCount}`);

      return new Response(
        JSON.stringify({ 
          script,
          wordCount: finalWordCount,
          estimatedDuration: Math.round(finalWordCount / 2.5),
          model: 'gpt-5.1'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Claude via Replicate (default)
    console.log("Using Claude via Replicate...");

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

    // If using webhook mode, create async prediction
    if (useWebhook && jobId) {
      const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;
      
      console.log("Creating async prediction with webhook:", webhookUrl);
      
      const prediction = await replicate.predictions.create({
        model: "anthropic/claude-4.5-sonnet",
        input: {
          prompt: userPrompt,
          system_prompt: systemPrompt,
          max_tokens: 64000,
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
            model: 'claude-4.5-sonnet'
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
          max_tokens: 64000,
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
        estimatedDuration: Math.round(script.split(/\s+/).length / 2.5),
        model: 'claude-4.5-sonnet'
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
