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
    const { videoScript, exampleUrls, characterRefUrl, previousPrompts } = await req.json();

    if (!videoScript) {
      return new Response(
        JSON.stringify({ error: "Le script vidéo est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!exampleUrls || !Array.isArray(exampleUrls) || exampleUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: "Les exemples de miniatures sont requis" }),
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

    let systemPrompt = `Tu es un expert en création de miniatures YouTube accrocheuses et performantes.

Ton rôle est d'ANALYSER les exemples de miniatures fournis et de générer 3 prompts SIMILAIRES mais DIFFÉRENTS pour créer des miniatures YouTube.

CONTEXTE IMPORTANT:
- Tu vas recevoir plusieurs images d'exemples de miniatures (style de référence à REPRODUIRE)
- Tu vas recevoir UNE image avec UNIQUEMENT le personnage (pas d'autre élément, juste le personnage sur fond uni)
- Tu dois ANALYSER le style, la composition, les couleurs, le texte des exemples
- Tu dois créer des prompts qui REPRODUISENT ce style tout en variant le contenu

RÈGLES STRICTES:
1. OBSERVE ATTENTIVEMENT les exemples: composition, couleurs, typographie, style d'illustration, mise en page
2. Tes 3 prompts doivent SUIVRE LE MÊME STYLE que les exemples
3. Chaque prompt doit rester UNIQUE avec des variations sur le contenu mais PAS sur le style global
4. Utilise "the character from the single-person reference image" pour le personnage
5. Les prompts doivent être en ANGLAIS pour la génération d'images
6. Chaque prompt doit faire 60-100 mots et être très détaillé sur le style visuel
7. Mentionne explicitement les éléments de style observés dans les exemples`;

    // Ajouter l'instruction sur les prompts précédents si fournis
    if (previousPrompts && Array.isArray(previousPrompts) && previousPrompts.length > 0) {
      systemPrompt += `

CRITICAL CONSTRAINT - AVOID PREVIOUS PROMPTS:
The user has already generated thumbnails with the following prompts and was NOT satisfied with them.
You MUST generate 3 COMPLETELY DIFFERENT prompts that explore NEW creative directions while maintaining the style from the examples.
DO NOT create variations similar to these rejected prompts:

${previousPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}

Generate fresh, innovative prompts that are distinctly different from the above.`;
    }

    systemPrompt += `

Retourne UNIQUEMENT un JSON avec ce format exact:
{
  "prompts": [
    "premier prompt détaillé reprenant le style des exemples...",
    "deuxième prompt avec même style mais contenu différent...",
    "troisième prompt toujours dans le même style..."
  ]
}`;

    // Build content array with images
    const userContent: any[] = [
      { type: "text", text: "EXEMPLES DE MINIATURES À REPRODUIRE (analyse le style, la composition, les couleurs):" }
    ];

    // Add example images
    for (const url of exampleUrls) {
      userContent.push({
        type: "image_url",
        image_url: { url }
      });
    }

    // Add character reference if provided
    if (characterRefUrl) {
      userContent.push({
        type: "text",
        text: "PERSONNAGE À UTILISER (celui-ci uniquement, pas les autres personnages des exemples):"
      });
      userContent.push({
        type: "image_url",
        image_url: { url: characterRefUrl }
      });
    }

    // Add video script
    userContent.push({
      type: "text",
      text: `\n\nSCRIPT DE LA VIDÉO:\n${videoScript}\n\nGénère 3 prompts de miniatures en REPRODUISANT LE STYLE des exemples ci-dessus, mais avec des variations de contenu basées sur le script.`
    });

    console.log("Generating thumbnail prompts with Gemini (with images)...");
    console.log(`Sending ${exampleUrls.length} example images and ${characterRefUrl ? '1' : '0'} character image`);

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
          { role: "user", content: userContent }
        ],
        temperature: 0.7,
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
