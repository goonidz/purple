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

    const systemPrompt = `Tu es un expert en création de contenu vidéo et en argumentation. 
L'utilisateur te donne une idée de vidéo. Tu dois proposer exactement 4 THÈSES différentes pour cette vidéo.

Chaque thèse doit être:
- Un angle argumentatif fort et clair
- Accompagnée d'une explication de la direction que prendra le script

IMPORTANT: Réponds UNIQUEMENT avec un JSON valide dans ce format exact:
{
  "axes": [
    {
      "id": 1, 
      "title": "La thèse principale en une phrase percutante", 
      "description": "Ce que le script va démontrer/expliquer et comment il va s'y prendre (2-3 phrases)"
    },
    {
      "id": 2, 
      "title": "Une autre thèse possible", 
      "description": "Direction et argumentation que le script va suivre"
    },
    {
      "id": 3, 
      "title": "Une thèse alternative", 
      "description": "Comment le script va aborder le sujet sous cet angle"
    },
    {
      "id": 4, 
      "title": "Une dernière thèse différente", 
      "description": "L'approche narrative et argumentative du script"
    }
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
