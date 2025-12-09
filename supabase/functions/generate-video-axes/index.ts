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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `Tu es un expert en création de contenu vidéo. 
L'utilisateur te donne une idée de vidéo. Tu dois proposer exactement 4 axes/angles différents pour aborder ce sujet.

Chaque axe doit être:
- Distinct et créatif
- Accrocheur pour YouTube
- Formulé en 1-2 phrases maximum

IMPORTANT: Réponds UNIQUEMENT avec un JSON valide dans ce format exact:
{
  "axes": [
    {"id": 1, "title": "Titre court de l'axe", "description": "Description en 1-2 phrases de l'angle proposé"},
    {"id": 2, "title": "Titre court de l'axe", "description": "Description en 1-2 phrases de l'angle proposé"},
    {"id": 3, "title": "Titre court de l'axe", "description": "Description en 1-2 phrases de l'angle proposé"},
    {"id": 4, "title": "Titre court de l'axe", "description": "Description en 1-2 phrases de l'angle proposé"}
  ]
}

Ne mets RIEN d'autre que ce JSON dans ta réponse.`;

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
          { role: "user", content: `Idée de vidéo: ${customPrompt}` }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Lovable AI error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("Raw AI response:", content);

    // Parse JSON from response
    let axes;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        axes = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
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
