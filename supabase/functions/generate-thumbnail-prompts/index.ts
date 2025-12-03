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

    const { videoScript, videoTitle, exampleUrls, characterRefUrl, previousPrompts } = await req.json();

    if (!videoScript) {
      return new Response(
        JSON.stringify({ error: "Le script vidéo est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!videoTitle) {
      return new Response(
        JSON.stringify({ error: "Le titre de la vidéo est requis" }),
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

    const hasCharacterRef = !!characterRefUrl;
    
    let systemPrompt = `Tu es un expert en création de miniatures YouTube accrocheuses et performantes.

Ton rôle est de créer 3 prompts de miniatures YouTube BASÉS SUR LE CONTENU DU SCRIPT/TITRE fourni, en utilisant le STYLE VISUEL des exemples comme référence.

DISTINCTION CRUCIALE - STYLE vs CONTENU:
- Les images d'exemples = RÉFÉRENCE DE STYLE UNIQUEMENT (couleurs, composition, typographie, effets visuels, mise en page)
- Le script/titre de la vidéo = SOURCE DU CONTENU (sujet, personnages, éléments visuels pertinents)
- NE COPIE JAMAIS les personnes, textes, ou sujets des exemples - ils sont là uniquement pour montrer le style visuel désiré
- Le contenu de tes miniatures doit être 100% basé sur le script et le titre de la vidéo

CONTEXTE:
- Tu vas recevoir des images d'exemples montrant le STYLE VISUEL à reproduire (pas le contenu!)
${hasCharacterRef ? '- Tu vas recevoir UNE image de personnage à utiliser dans les miniatures' : '- Pas de personnage spécifique fourni, crée des éléments visuels pertinents au script'}
- Tu vas recevoir le TITRE et le SCRIPT de la vidéo - c'est ça qui détermine le CONTENU des miniatures

RÈGLES STRICTES:
1. ANALYSE les exemples pour: palette de couleurs, style d'illustration, composition, effets visuels, typographie
2. IGNORE complètement: les personnes, le texte, le sujet des exemples - ce n'est PAS le contenu à reproduire
3. CRÉE des miniatures dont le SUJET et le CONTENU viennent UNIQUEMENT du script/titre de la vidéo
${hasCharacterRef ? '4. Utilise "the character from the single-person reference image" pour le personnage principal' : '4. Décris des personnages ou éléments visuels pertinents au contenu du script'}
5. Les prompts doivent être en ANGLAIS
6. Chaque prompt: 60-100 mots, détaillé sur le style visuel ET pertinent au contenu du script
7. N'utilise JAMAIS le mot "dead" (reformule autrement)

RÈGLES DE SIMPLICITÉ:
- Maximum 3-4 éléments visuels par miniature
- Compositions épurées et lisibles
- 1-2 éléments visuels forts, pas beaucoup de petits détails
- Arrière-plan simple
${hasCharacterRef ? '- Le personnage + 1-2 éléments clés liés au script = design efficace' : '- 2-3 éléments visuels clés tirés du script = design efficace'}`;

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

    // Add video title and script
    userContent.push({
      type: "text",
      text: `\n\nTITRE DE LA VIDÉO:\n"${videoTitle}"\n\nSCRIPT DE LA VIDÉO:\n${videoScript}\n\nGénère 3 prompts de miniatures en REPRODUISANT LE STYLE des exemples ci-dessus, mais avec des variations de contenu basées sur le titre et le script.

IMPORTANT: Crée des designs SIMPLES et ÉPURÉS. Maximum 3-4 éléments visuels. Évite la complexité excessive. Le titre doit être pris en compte dans la conception des miniatures pour assurer la cohérence avec le contenu.`
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
