import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { scene, summary, examplePrompts, sceneIndex, totalScenes, startTime, endTime } = await req.json();

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

    // Construct the system prompt in English
    let systemPrompt = `You are an expert at generating prompts for AI image creation (like Midjourney, Stable Diffusion, DALL-E).

STRICT RULES FOR GENERATING CONSISTENT PROMPTS:
1. Follow EXACTLY the structure and style of the examples below
2. Use the same tone, vocabulary, and format
3. Respect the same approximate length (50-100 words)
4. Include the same types of elements: main subject, visual style, composition, lighting, mood
5. NEVER deviate from the format established by the examples
6. Generate prompts in ENGLISH only

`;

    // Add examples if provided
    if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
      systemPrompt += `EXAMPLES TO FOLLOW STRICTLY:\n\n`;
      examplePrompts.forEach((example: string, i: number) => {
        systemPrompt += `Example ${i + 1}:\n"${example}"\n\n`;
      });
      systemPrompt += `You MUST generate a prompt that follows EXACTLY this structure and style.\n\n`;
    }

    systemPrompt += `Your role is to create ONE detailed visual prompt for a specific scene from a video/audio.

For this scene, you must:
1. Identify key visual elements from the text
2. Create a descriptive and detailed prompt
3. Include style, mood, composition, lighting
4. Optimize for high-quality image generation
5. Think about visual coherence with the global story context

Return ONLY the prompt text, no JSON, no title, just the optimized prompt in ENGLISH.`;

    // Build user message with context
    let userMessage = "";
    
    if (summary) {
      userMessage += `Contexte global : ${summary}\n\n`;
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
        JSON.stringify({ error: "Erreur lors de la génération du prompt" }),
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
