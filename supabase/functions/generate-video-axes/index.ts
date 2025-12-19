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
    const { customPrompt } = await req.json();

    if (!customPrompt) {
      throw new Error("Custom prompt is required");
    }

    console.log("Generating video axes for prompt:", customPrompt.substring(0, 100));

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    const systemPrompt = `Tu es un expert en création de contenu vidéo viral et en storytelling captivant.
L'utilisateur te donne une idée de vidéo. Tu dois proposer exactement 4 THÈSES radicalement différentes.

RÈGLES POUR LES TITRES:
- Le titre doit être IMMÉDIATEMENT compréhensible et accrocheur
- Formule une opinion tranchée, provocante ou surprenante
- Évite les titres génériques ou académiques
- Préfère les formulations audacieuses: "Et si...", "Le vrai problème c'est...", "Personne ne parle de...", "On vous a menti sur..."
- Chaque titre doit donner envie de cliquer MAINTENANT

RÈGLES POUR LES ANGLES:
- Propose des angles ORIGINAUX, pas les angles évidents que tout le monde utilise
- Un angle divertissant ou humoristique
- Un angle contrarian ou contre-intuitif  
- Un angle émotionnel ou personnel
- Un angle "révélation" ou "vérité cachée"

IMPORTANT: Réponds UNIQUEMENT avec un JSON valide dans ce format exact:
{
  "axes": [
    {
      "id": 1, 
      "title": "Une affirmation percutante et immédiatement compréhensible", 
      "description": "L'angle narratif unique que le script va prendre (2-3 phrases)"
    },
    {
      "id": 2, 
      "title": "Un titre provocant ou contre-intuitif", 
      "description": "Comment le script va surprendre le spectateur"
    },
    {
      "id": 3, 
      "title": "Un angle émotionnel ou personnel fort", 
      "description": "L'approche qui va toucher le spectateur"
    },
    {
      "id": 4, 
      "title": "Un titre de type 'révélation' ou 'vérité cachée'", 
      "description": "Ce que le script va révéler de manière originale"
    }
  ]
}

Ne mets RIEN d'autre que ce JSON dans ta réponse.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              parts: [{ text: `Idée de vidéo: ${customPrompt}` }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google AI API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Google AI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("Raw AI response:", content);

    // Parse JSON from response
    let axes;
    try {
      // Remove markdown code fences if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();
      
      // Try to extract JSON from the response
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        axes = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Content to parse:", content.substring(0, 500));
      throw new Error("Failed to parse AI response as JSON");
    }

    console.log("Parsed axes:", axes);

    return new Response(
      JSON.stringify(axes),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Generate video axes error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
