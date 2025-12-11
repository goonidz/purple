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

    const { customPrompt, jobId, useWebhook, scriptModel } = await req.json();

    if (!customPrompt) {
      throw new Error("Custom prompt is required");
    }

    // Default to Claude if no model specified
    const selectedModel = scriptModel || "claude";
    console.log(`Generating script with model: ${selectedModel}, useWebhook: ${useWebhook}`);

    // Use the custom prompt directly as the user prompt
    const systemPrompt = `Tu es un assistant d'écriture professionnel. Tu génères exactement ce que l'utilisateur demande, sans commentaires ni explications supplémentaires. Réponds uniquement avec le contenu demandé.

RÈGLE CRITIQUE SUR LA LONGUEUR:
- Si l'utilisateur demande un certain nombre de mots, tu DOIS atteindre ce nombre MINIMUM
- Ne t'arrête JAMAIS avant d'avoir atteint le nombre de mots demandé
- Si l'utilisateur demande 5000 mots, ton script doit faire AU MOINS 5000 mots
- Développe chaque section en profondeur pour atteindre la longueur requise
- Ajoute des détails, des exemples, des transitions, des descriptions riches
- Compte tes mots mentalement et continue jusqu'à atteindre l'objectif`;

    const userPrompt = `${customPrompt}

RAPPEL IMPORTANT: Respecte STRICTEMENT le nombre de mots demandé. Si une longueur est spécifiée, atteins-la obligatoirement. Ne termine pas avant d'avoir atteint l'objectif de mots.`;

    // Handle Gemini 3 Pro Preview via Lovable AI
    if (selectedModel === "gemini") {
      console.log("Using Gemini 3 Pro Preview via Lovable AI...");
      
      const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
      if (!lovableApiKey) {
        throw new Error("LOVABLE_API_KEY is not configured");
      }

      const geminiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-pro-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 65536,
          temperature: 0.7,
        }),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Gemini API error:", geminiResponse.status, errorText);
        
        if (geminiResponse.status === 429) {
          throw new Error("Rate limit dépassé, veuillez réessayer dans quelques instants.");
        }
        if (geminiResponse.status === 402) {
          throw new Error("Crédits insuffisants. Veuillez ajouter des crédits à votre workspace Lovable.");
        }
        throw new Error(`Gemini API error: ${geminiResponse.status}`);
      }

      const geminiData = await geminiResponse.json();
      const script = geminiData.choices?.[0]?.message?.content || "";

      console.log("Script generated with Gemini, length:", script.length);

      // If using webhook mode, we need to update the job directly since Gemini doesn't use webhooks
      if (useWebhook && jobId) {
        // Update the job with the generated script
        const wordCount = script.split(/\s+/).length;
        const estimatedDuration = Math.round(wordCount / 2.5);

        await supabaseAdmin
          .from('generation_jobs')
          .update({
            status: 'completed',
            progress: 1,
            completed_at: new Date().toISOString(),
            metadata: {
              script,
              wordCount,
              estimatedDuration,
              model: 'gemini-3-pro-preview'
            }
          })
          .eq('id', jobId);

        // Also update the project with the script
        const { data: jobData } = await supabaseAdmin
          .from('generation_jobs')
          .select('project_id')
          .eq('id', jobId)
          .single();

        if (jobData?.project_id) {
          await supabaseAdmin
            .from('projects')
            .update({ summary: script })
            .eq('id', jobData.project_id);
        }

        console.log(`Job ${jobId} completed with Gemini script`);

        return new Response(
          JSON.stringify({ 
            status: 'completed',
            script,
            wordCount,
            estimatedDuration,
            message: 'Script generation completed'
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          script,
          wordCount: script.split(/\s+/).length,
          estimatedDuration: Math.round(script.split(/\s+/).length / 2.5),
          model: 'gemini-3-pro-preview'
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
          max_tokens: 65536,
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
          max_tokens: 65536,
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
