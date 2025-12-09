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
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { topic, style, duration, language = 'fr', customPrompt } = await req.json();

    if (!topic) {
      throw new Error("Topic is required");
    }

    console.log("Generating script for topic:", topic);

    // Get user's Replicate API key from Vault
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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

    // Build the prompt for script generation
    const durationGuide = duration === 'short' 
      ? "30-60 secondes (environ 100-150 mots)" 
      : duration === 'medium' 
        ? "2-3 minutes (environ 300-450 mots)"
        : "5-7 minutes (environ 750-1000 mots)";

    const styleGuide = style === 'educational' 
      ? "éducatif et informatif, avec des explications claires"
      : style === 'entertaining'
        ? "divertissant et engageant, avec de l'humour"
        : style === 'dramatic'
          ? "dramatique et captivant, avec du suspense"
          : "naturel et conversationnel";

    // Use custom prompt if provided, otherwise use default
    const basePrompt = customPrompt || `Tu es un scénariste professionnel pour vidéos YouTube. Tu écris des scripts captivants et optimisés pour la narration vocale.

RÈGLES IMPORTANTES:
- Écris UNIQUEMENT le texte qui sera lu à voix haute
- PAS de directions de scène, PAS de [crochets], PAS d'annotations
- Utilise un langage naturel et fluide pour la narration
- Inclus des pauses naturelles avec des phrases courtes
- Commence par un hook accrocheur
- Termine par un appel à l'action ou une conclusion mémorable`;

    const systemPrompt = `${basePrompt}

PARAMÈTRES DE GÉNÉRATION:
- Durée cible: ${durationGuide}
- Style: ${styleGuide}
- Langue: ${language === 'fr' ? 'Français' : 'English'}`;

    const userPrompt = `Écris un script vidéo sur le sujet suivant: "${topic}"

Le script doit être prêt à être lu directement par une voix de synthèse, sans aucune annotation ou direction.`;

    console.log("Calling Claude via Replicate...");

    // Use Claude Sonnet 4 via Replicate
    const output = await replicate.run(
      "anthropic/claude-sonnet-4",
      {
        input: {
          prompt: userPrompt,
          system_prompt: systemPrompt,
          max_tokens: 4096,
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
