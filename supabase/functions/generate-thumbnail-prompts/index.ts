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
    const { videoScript } = await req.json();

    if (!videoScript) {
      return new Response(
        JSON.stringify({ error: "Le script vidéo est requis" }),
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

    const systemPrompt = `Tu es un expert en création de miniatures YouTube accrocheuses et performantes.

Ton rôle est d'analyser un script vidéo et de générer 3 prompts DIFFÉRENTS et CRÉATIFS pour créer des miniatures YouTube.

CONTEXTE IMPORTANT:
- L'utilisateur fournit des exemples de miniatures (style de référence)
- L'utilisateur fournit UNE image avec UNIQUEMENT son personnage (pas d'autre élément, juste le personnage sur fond uni)
- Tu dois utiliser CE personnage précis dans tes prompts

RÈGLES STRICTES:
1. Chaque prompt doit être UNIQUE avec une approche visuelle différente
2. Les prompts doivent être accrocheurs et optimisés pour le CTR YouTube
3. Inclure des éléments visuels précis: composition, couleurs, texte, émotions
4. Les prompts doivent être en ANGLAIS pour la génération d'images
5. Chaque prompt doit faire 50-80 mots
6. Pense à différentes approches: émotionnelle, dramatique, informative, intrigante
7. IMPORTANT: Précise bien "Use the character from the reference image that shows ONLY the character with no other elements" pour identifier le bon personnage

Retourne UNIQUEMENT un JSON avec ce format exact:
{
  "prompts": [
    "premier prompt détaillé...",
    "deuxième prompt avec approche différente...",
    "troisième prompt avec encore une autre approche..."
  ]
}`;

    const userMessage = `Voici le script de la vidéo:\n\n${videoScript}\n\nGénère 3 prompts de miniatures YouTube différents et créatifs pour cette vidéo.`;

    console.log("Generating thumbnail prompts with Gemini...");

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
        temperature: 0.8,
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
        JSON.stringify({ error: "Erreur lors de la génération des prompts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const generatedContent = data.choices[0].message.content;
    
    console.log("Raw AI response:", generatedContent);

    // Parse le JSON de la réponse
    let parsedResponse;
    try {
      // Nettoie le contenu pour extraire uniquement le JSON
      const jsonMatch = generatedContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError, generatedContent);
      return new Response(
        JSON.stringify({ error: "Erreur lors du parsing de la réponse AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!parsedResponse.prompts || !Array.isArray(parsedResponse.prompts) || parsedResponse.prompts.length !== 3) {
      console.error("Invalid prompts format:", parsedResponse);
      return new Response(
        JSON.stringify({ error: "Format de prompts invalide" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Successfully generated 3 thumbnail prompts");

    return new Response(
      JSON.stringify({ prompts: parsedResponse.prompts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in generate-thumbnail-prompts function:", error);
    const errorMessage = error instanceof Error ? error.message : "Erreur interne du serveur";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
