import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const { scene, summary, examplePrompts, sceneIndex, totalScenes, startTime, endTime, customSystemPrompt, previousPrompts } = await req.json();

    if (!scene) {
      return new Response(
        JSON.stringify({ error: "Le texte de la scène est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use custom system prompt if provided, otherwise use default
    let systemPrompt: string;
    
    if (customSystemPrompt && customSystemPrompt.trim()) {
      systemPrompt = customSystemPrompt.trim();
      
      // Add examples if provided - emphasize STYLE ONLY
      if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
        systemPrompt += `\n\nSTYLE REFERENCE EXAMPLES (use for FORMAT and STYLE only, NEVER copy subjects/content):\n\n`;
        examplePrompts.forEach((example: string, i: number) => {
          systemPrompt += `Style Example ${i + 1}:\n"${example}"\n\n`;
        });
        systemPrompt += `CRITICAL: These examples show the desired VISUAL STYLE, TONE, and FORMAT only.
- Extract: lighting style, color palette, composition approach, aesthetic mood, sentence structure
- NEVER COPY: subjects, objects, characters, locations, or specific content from examples
- Your prompt MUST describe what is in THE SCENE TEXT, using the style/format from examples\n\n`;
      }
    } else {
      // Default system prompt
      systemPrompt = `You are an expert at generating prompts for AI image creation (like Midjourney, Stable Diffusion, DALL-E).

STRICT RULES FOR GENERATING CONSISTENT PROMPTS:
1. Follow EXACTLY the structure and style of the examples below
2. Use the same tone, vocabulary, and format
3. Respect the same approximate length (50-100 words)
4. Include the same types of elements: main subject, visual style, composition, lighting, mood
5. NEVER deviate from the format established by the examples
6. Generate prompts in ENGLISH only
7. NEVER use the word "dead" in the prompt (rephrase with other words instead)

CONTENT SAFETY - STRICTLY FORBIDDEN (to avoid AI image generator blocks):
- No nudity, partial nudity, or suggestive/intimate content
- No violence, gore, blood, weapons pointed at people, or graphic injuries
- No sexual or romantic physical contact (kissing, embracing intimately)
- No drug use or drug paraphernalia
- No hate symbols, extremist imagery, or discriminatory content
- No realistic depictions of real public figures or celebrities
- No content involving minors in any potentially inappropriate context
- Instead of violent scenes, describe tension, conflict, or drama through expressions, postures, and atmosphere
- Instead of intimate scenes, describe emotional connection through eye contact, gestures, or symbolic imagery

`;

      // Add examples if provided - emphasize STYLE ONLY
      if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
        systemPrompt += `STYLE REFERENCE EXAMPLES (use for FORMAT and STYLE only, NEVER copy subjects/content):\n\n`;
        examplePrompts.forEach((example: string, i: number) => {
          systemPrompt += `Style Example ${i + 1}:\n"${example}"\n\n`;
        });
        systemPrompt += `CRITICAL: These examples show the desired VISUAL STYLE, TONE, and FORMAT only.
- Extract: lighting style, color palette, composition approach, aesthetic mood, sentence structure
- NEVER COPY: subjects, objects, characters, locations, or specific content from examples (no vegetables, no vehicles, no moon, etc. unless the scene mentions them)
- Your prompt MUST describe what is in THE SCENE TEXT, styled like the examples\n\n`;
      }

      systemPrompt += `Your role is to create ONE detailed visual prompt for a specific scene from a video/audio.

CRITICAL - CONTENT MUST MATCH THE SCENE:
1. READ the scene text carefully and identify the SPECIFIC subject, action, or concept being discussed
2. The image must DIRECTLY illustrate what is being said in this specific scene
3. Different scenes = DIFFERENT subjects, settings, and visual elements
4. DO NOT generate generic or repetitive imagery - each prompt must be UNIQUE to its scene content
5. If the scene talks about "100 people surviving", show that. If it talks about "genetic diversity", show that concept. If it talks about "psychology", show that context.

For this scene, you must:
1. Identify the MAIN TOPIC and KEY CONCEPTS from the scene text
2. Create a visual that SPECIFICALLY represents what is being discussed
3. Apply the visual style from the examples (lighting, mood, 3D aesthetic) but with DIFFERENT content
4. Vary the setting, characters, objects, and composition based on the scene content

Return ONLY the prompt text, no JSON, no title, just the optimized prompt in ENGLISH.`;
    }

    // Build user message with context
    let userMessage = "";
    
    if (summary) {
      userMessage += `Contexte global : ${summary}\n\n`;
    }
    
    // Add previous prompts to avoid repetition
    if (previousPrompts && Array.isArray(previousPrompts) && previousPrompts.length > 0) {
      userMessage += `PREVIOUS PROMPTS (avoid similar imagery, compositions, and visual elements):\n`;
      previousPrompts.slice(-3).forEach((prompt: string, i: number) => {
        userMessage += `- Scene ${sceneIndex - previousPrompts.length + i}: "${prompt.substring(0, 150)}..."\n`;
      });
      userMessage += `\nIMPORTANT: Create a VISUALLY DIFFERENT prompt - vary the composition, angle, lighting, and main visual elements to avoid repetitive imagery.\n\n`;
    }
    
    userMessage += `Scene ${sceneIndex}/${totalScenes} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s):\n"${scene}"\n\n`;
    userMessage += `Generate a detailed visual prompt to illustrate this specific scene.`;

    console.log(`Generating prompt for scene ${sceneIndex}/${totalScenes}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes dépassée, veuillez réessayer plus tard" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédit insuffisant, veuillez ajouter des crédits à votre workspace" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Erreur lors de la génération du prompt: ${response.status} - ${errorText.substring(0, 200)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log(`Prompt generated for scene ${sceneIndex}`);

    const generatedPrompt = data.choices[0].message.content;

    return new Response(
      JSON.stringify({ prompt: generatedPrompt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in generate-prompts function:", error);
    const errorMessage = error instanceof Error ? error.message : "Erreur interne du serveur";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
