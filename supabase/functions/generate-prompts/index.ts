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
    const { scene, globalContext, examplePrompt, sceneIndex, totalScenes, startTime, endTime } = await req.json();

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

    // Construct the system prompt
    let systemPrompt = `Tu es un expert en génération de prompts pour la création d'images par IA (comme Midjourney, Stable Diffusion, DALL-E).

Ton rôle est de créer UN SEUL prompt visuel détaillé pour une scène spécifique d'une vidéo/audio.

Pour cette scène, tu dois :
1. Identifier les éléments visuels clés à partir du texte
2. Créer un prompt descriptif et détaillé
3. Inclure le style, l'ambiance, la composition, l'éclairage
4. Optimiser pour la génération d'images de haute qualité
5. Penser à la cohérence visuelle avec le contexte global de l'histoire

Retourne UNIQUEMENT le texte du prompt, sans JSON, sans titre, juste le prompt optimisé.`;

    if (examplePrompt) {
      systemPrompt += `\n\nStyle de référence à suivre : "${examplePrompt}"`;
    }

    // Build user message with context
    let userMessage = "";
    
    if (globalContext) {
      userMessage += `Contexte global de l'histoire : ${globalContext}\n\n`;
    }
    
    userMessage += `Scène ${sceneIndex}/${totalScenes} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s) :\n"${scene}"\n\n`;
    userMessage += `Génère un prompt visuel détaillé pour illustrer cette scène spécifique.`;

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
