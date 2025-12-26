import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import Replicate from "https://esm.sh/replicate@0.25.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to fetch image and convert to base64
async function imageUrlToBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch image: ${url}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const base64 = base64Encode(new Uint8Array(arrayBuffer));
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return { data: base64, mimeType: contentType };
  } catch (error) {
    console.error(`Error converting image to base64: ${url}`, error);
    return null;
  }
}

// Extract key themes from prompts to explicitly ban them
function extractBannedThemes(prompts: string[]): string[] {
  const themes = new Set<string>();
  
  // Common patterns to extract
  const patterns = [
    /['"]([A-Z][A-Z\s\?!:]+)['"]/g,  // Quoted uppercase text (headlines)
    /text\s+['"]([^'"]+)['"]/gi,      // Text mentions
    /(?:FERRARI|TRASH|BRAIN FOG|BEAT THE SYSTEM|REAL COST|INFLATION|CRASH|MAKE IT|DIY|HIDDEN COST)/gi,
  ];
  
  for (const prompt of prompts) {
    // Extract headlines/text
    for (const pattern of patterns) {
      const matches = prompt.matchAll(pattern);
      for (const match of matches) {
        const theme = match[1] || match[0];
        if (theme && theme.length > 3 && theme.length < 50) {
          themes.add(theme.toUpperCase().trim());
        }
      }
    }
    
    // Extract key visual concepts
    const visualConcepts = [
      'sports car', 'Ferrari', 'fuel hose', 'brain fog', 'split image', 
      'piggy bank', 'broken piggy', 'smoothie comparison', 'side-by-side',
      'clock', 'graph', 'dollar sign', 'price tag', 'stomach split'
    ];
    
    for (const concept of visualConcepts) {
      if (prompt.toLowerCase().includes(concept.toLowerCase())) {
        themes.add(concept.toUpperCase());
      }
    }
  }
  
  return Array.from(themes).slice(0, 15); // Limit to 15 themes
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication - accept both user tokens and service role keys
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if this is a service role key (internal call)
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isServiceRoleCall = authHeader === `Bearer ${serviceRoleKey}`;
    
    if (!isServiceRoleCall) {
      // Normal user call - verify user authentication
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
    }
    // Service role calls are allowed without user verification (internal backend calls)

    const { videoScript, videoTitle, exampleUrls, characterRefUrl, previousPrompts, customPrompt, userIdea, textModel, userId: bodyUserId } = await req.json();

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

    // Check which model to use
    const useClaudeModel = textModel === 'claude-sonnet-4';
    
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    
    if (!useClaudeModel && !GOOGLE_AI_API_KEY) {
      console.error("GOOGLE_AI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante (GOOGLE_AI_API_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // For Claude, we need to get user's Replicate API key
    let replicateApiKey: string | null = null;
    if (useClaudeModel) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      
      // Get user from token or from body (for internal calls)
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.replace('Bearer ', '');
      const isServiceRoleCall = token === supabaseServiceKey;
      
      let targetUserId: string | null = null;
      
      if (isServiceRoleCall && bodyUserId) {
        // Internal call from start-generation-job - use userId from body
        targetUserId = bodyUserId;
        console.log(`Using userId from body for internal call: ${targetUserId}`);
      } else if (!isServiceRoleCall) {
        // Direct user call - get user from auth
        const supabaseClient = createClient(
          supabaseUrl,
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authHeader! } } }
        );
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
          targetUserId = user.id;
        }
      }
      
      if (targetUserId) {
        const { data: apiKeyData } = await supabaseAdmin.rpc(
          'get_user_api_key_for_service',
          { target_user_id: targetUserId, key_name: 'replicate' }
        );
        replicateApiKey = apiKeyData;
      }
      
      if (!replicateApiKey) {
        return new Response(
          JSON.stringify({ error: "Clé API Replicate non configurée. Ajoutez-la dans votre profil." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const hasCharacterRef = !!characterRefUrl;
    
    // Use custom prompt if provided, otherwise use default
    let systemPrompt = customPrompt || `Tu es un expert en création de miniatures YouTube accrocheuses et performantes.

Ton rôle est de créer 3 prompts de miniatures YouTube BASÉS SUR LE CONTENU DU SCRIPT/TITRE fourni, en utilisant le STYLE VISUEL des exemples comme référence.

DISTINCTION CRUCIALE - STYLE vs CONTENU:
- Les images d'exemples = RÉFÉRENCE DE STYLE UNIQUEMENT (couleurs, composition, typographie, effets visuels, mise en page)
- Le script/titre de la vidéo = SOURCE DU CONTENU (sujet, personnages, éléments visuels pertinents)
- NE COPIE JAMAIS les personnes, textes, ou sujets des exemples - ils sont là uniquement pour montrer le style visuel désiré
- Le contenu de tes miniatures doit être 100% basé sur le script et le titre de la vidéo

RÈGLE CRITIQUE SUR LES VISAGES:
- NE REPRODUIS JAMAIS les visages des personnes vues dans les images d'exemples
- Les exemples montrent un STYLE (éclairage, couleurs, composition) mais les VISAGES/PERSONNES doivent être ORIGINAUX
- Décris des personnages GÉNÉRIQUES basés sur le script (ex: "a man", "a woman", "a middle-aged person") 
- NE décris JAMAIS des traits faciaux spécifiques vus dans les exemples
- Si le script parle d'une personne spécifique, décris-la selon le script, PAS selon les exemples
${hasCharacterRef ? '- EXCEPTION: Tu peux utiliser "the character from the single-person reference image" UNIQUEMENT pour la référence de personnage fournie séparément' : ''}

CONTEXTE:
- Tu vas recevoir des images d'exemples montrant le STYLE VISUEL à reproduire (pas le contenu ni les visages!)
${hasCharacterRef ? '- Tu vas recevoir UNE image de personnage à utiliser dans les miniatures' : '- Pas de personnage spécifique fourni, crée des éléments visuels pertinents au script'}
- Tu vas recevoir le TITRE et le SCRIPT de la vidéo - c'est ça qui détermine le CONTENU des miniatures

RÈGLES STRICTES:
1. ANALYSE les exemples pour: palette de couleurs, style d'illustration, composition, effets visuels, typographie, éclairage dramatique
2. IGNORE complètement: les VISAGES, les personnes, le texte, le sujet des exemples - ce n'est PAS le contenu à reproduire
3. CRÉE des miniatures dont le SUJET et le CONTENU viennent UNIQUEMENT du script/titre de la vidéo
${hasCharacterRef ? '4. Utilise "the character from the single-person reference image" pour le personnage principal (référence personnage séparée uniquement)' : '4. Décris des personnages GÉNÉRIQUES pertinents au contenu du script (sans copier les visages des exemples)'}
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
      // Extract key themes/concepts to explicitly ban
      const bannedThemes = extractBannedThemes(previousPrompts);
      
      systemPrompt += `

!!!!! MANDATORY CONSTRAINT - READ THIS FIRST !!!!!

The user has REJECTED all the following ${previousPrompts.length} thumbnails. They want something COMPLETELY DIFFERENT.

BANNED PROMPTS (DO NOT USE SIMILAR IDEAS):
${previousPrompts.map((p, i) => `❌ ${i + 1}. ${p}`).join('\n\n')}

BANNED THEMES/CONCEPTS (ABSOLUTELY FORBIDDEN):
${bannedThemes.map(t => `🚫 "${t}"`).join(', ')}

STRICT REQUIREMENTS:
1. DO NOT use ANY of the banned themes above
2. DO NOT create variations of the rejected prompts
3. Find COMPLETELY NEW angles from the script
4. Use DIFFERENT visual metaphors
5. Choose DIFFERENT text/headlines
6. Explore UNEXPLORED aspects of the video content

Think: "What aspects of the script have NOT been explored yet?"`;
    }

    // Ajouter l'idée de l'utilisateur si fournie
    if (userIdea && userIdea.trim()) {
      systemPrompt += `

💡 USER'S IDEA - MANDATORY DIRECTION:
The user wants ALL 3 thumbnails to be variations of this specific idea: "${userIdea.trim()}"

CRITICAL REQUIREMENT:
- ALL 3 prompts MUST be variations/interpretations of the user's idea above
- Each prompt should explore a different angle or visual approach to the same concept
- The user's idea is the PRIMARY direction - adapt it to fit the video script content
- Still follow ALL the rules above (style from examples, content from script, simplicity, etc.)
- Create 3 distinct variations that all relate to the user's idea but with different visual compositions, angles, or emphasis`;
    }

    // Always append the JSON format instruction
    const variationInstruction = userIdea && userIdea.trim() 
      ? " (tous les 3 doivent être des variations de l'idée de l'utilisateur)"
      : "";
    
    systemPrompt += `

Retourne UNIQUEMENT un JSON avec ce format exact:
{
  "prompts": [
    "premier prompt détaillé reprenant le style des exemples${variationInstruction}...",
    "deuxième prompt avec même style mais variation différente${variationInstruction}...",
    "troisième prompt toujours dans le même style, autre variation${variationInstruction}..."
  ]
}`;

    // Build content parts array for Google Gemini API
    const contentParts: any[] = [
      { text: "EXEMPLES DE MINIATURES À REPRODUIRE (analyse le style, la composition, les couleurs):" }
    ];

    // Add example images (convert to base64)
    console.log(`Converting ${exampleUrls.length} example images to base64...`);
    for (const url of exampleUrls) {
      const imageData = await imageUrlToBase64(url);
      if (imageData) {
        contentParts.push({
          inline_data: {
            mime_type: imageData.mimeType,
            data: imageData.data
          }
        });
      }
    }

    // Add character reference if provided
    if (characterRefUrl) {
      contentParts.push({
        text: "PERSONNAGE À UTILISER (celui-ci uniquement, pas les autres personnages des exemples):"
      });
      const charImageData = await imageUrlToBase64(characterRefUrl);
      if (charImageData) {
        contentParts.push({
          inline_data: {
            mime_type: charImageData.mimeType,
            data: charImageData.data
          }
        });
      }
    }

    // Add video title and script
    contentParts.push({
      text: `
=== TITRE DE LA VIDÉO ===
"${videoTitle}"

=== SCRIPT COMPLET DE LA VIDÉO (LIS ATTENTIVEMENT) ===
${videoScript}

=== INSTRUCTIONS CRITIQUES ===

ÉTAPE 1 - ANALYSE DU SCRIPT:
Avant de générer les prompts, tu DOIS identifier dans le script ci-dessus:
- Les PERSONNAGES ou PERSONNES mentionnés (noms, rôles, descriptions)
- Les ÉVÉNEMENTS ou ACTIONS clés
- Les LIEUX ou ENVIRONNEMENTS décrits
- Les OBJETS ou PRODUITS importants mentionnés
- Le THÈME principal et le TON de la vidéo

ÉTAPE 2 - CRÉATION DES PROMPTS:
Chaque prompt DOIT inclure des éléments SPÉCIFIQUES tirés du script. Exemples:
- Script sur une recette de cuisine → montre le plat ou les ingrédients mentionnés
- Script sur un voyage → montre le lieu ou monument décrit
- Script sur une histoire vraie → représente les personnages ou événements clés
- Script sur un tutoriel → montre le résultat ou l'outil expliqué
- Script sur un produit → met en avant ce produit spécifique

NE GÉNÈRE PAS de miniatures génériques avec des éléments aléatoires.
GÉNÈRE des miniatures qui représentent VRAIMENT le contenu spécifique de CETTE vidéo.

RAPPEL: Les images d'exemples = STYLE VISUEL uniquement (couleurs, composition, typographie).
Le CONTENU des miniatures vient UNIQUEMENT du script ci-dessus.

Crée des designs SIMPLES (3-4 éléments max) mais PERTINENTS au script.`
    });

    console.log(`Generating thumbnail prompts with ${useClaudeModel ? 'Claude Sonnet 4' : 'Gemini 2.0 Flash'}...`);
    console.log(`Processed ${exampleUrls.length} example images and ${characterRefUrl ? '1' : '0'} character image`);

    let generatedContent: string;

    if (useClaudeModel) {
      // Use Claude via Replicate
      const replicate = new Replicate({ auth: replicateApiKey! });
      
      // Build the user prompt
      const userPrompt = `EXEMPLES DE MINIATURES À REPRODUIRE (analyse le style, la composition, les couleurs):
Les images d'exemples sont fournies ci-jointes. Analyse leur STYLE VISUEL (couleurs, composition, typographie, effets).
${exampleUrls.length > 1 ? `Note: ${exampleUrls.length} images d'exemple sont fournies.` : ''}

${characterRefUrl ? `PERSONNAGE À UTILISER (celui-ci uniquement, pas les autres personnages des exemples):
Une image de personnage est également fournie.` : ''}

=== TITRE DE LA VIDÉO ===
"${videoTitle}"

=== SCRIPT COMPLET DE LA VIDÉO (LIS ATTENTIVEMENT) ===
${videoScript}

=== INSTRUCTIONS CRITIQUES ===

ÉTAPE 1 - ANALYSE DU SCRIPT:
Avant de générer les prompts, tu DOIS identifier dans le script ci-dessus:
- Les PERSONNAGES ou PERSONNES mentionnés (noms, rôles, descriptions)
- Les ÉVÉNEMENTS ou ACTIONS clés
- Les LIEUX ou ENVIRONNEMENTS décrits
- Les OBJETS ou PRODUITS importants mentionnés
- Le THÈME principal et le TON de la vidéo

ÉTAPE 2 - CRÉATION DES PROMPTS:
Chaque prompt DOIT inclure des éléments SPÉCIFIQUES tirés du script. Exemples:
- Script sur une recette de cuisine → montre le plat ou les ingrédients mentionnés
- Script sur un voyage → montre le lieu ou monument décrit
- Script sur une histoire vraie → représente les personnages ou événements clés
- Script sur un tutoriel → montre le résultat ou l'outil expliqué
- Script sur un produit → met en avant ce produit spécifique

NE GÉNÈRE PAS de miniatures génériques avec des éléments aléatoires.
GÉNÈRE des miniatures qui représentent VRAIMENT le contenu spécifique de CETTE vidéo.

RAPPEL: Les images d'exemples = STYLE VISUEL uniquement (couleurs, composition, typographie).
Le CONTENU des miniatures vient UNIQUEMENT du script ci-dessus.

Crée des designs SIMPLES (3-4 éléments max) mais PERTINENTS au script.`;

      try {
        // Send images one by one and combine results, or use first image
        // Replicate's Claude accepts one image at a time via the 'image' field
        // We'll use the first example image as the main style reference
        const primaryImageUrl = exampleUrls[0];
        
        const output = await replicate.run(
          "anthropic/claude-4.5-sonnet",
          {
            input: {
              prompt: userPrompt,
              system_prompt: systemPrompt,
              image: primaryImageUrl,
              max_tokens: 2048,
              temperature: previousPrompts && previousPrompts.length > 0 ? 0.95 : 0.7,
            }
          }
        );
        
        // Replicate returns an array of strings or a single string
        if (Array.isArray(output)) {
          generatedContent = output.join('');
        } else {
          generatedContent = String(output);
        }
      } catch (replicateError: any) {
        console.error("Replicate Claude error:", replicateError);
        
        if (replicateError.message?.includes('rate limit')) {
          return new Response(
            JSON.stringify({ error: "Limite de requêtes dépassée, veuillez réessayer plus tard" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: `Erreur lors de la génération des prompts avec Claude: ${replicateError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
    } else {
      // Use Gemini (existing logic)
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
                parts: contentParts
              }
            ],
            generationConfig: {
              temperature: previousPrompts && previousPrompts.length > 0 ? 0.95 : 0.7,
            }
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Google AI API error:", response.status, errorText);
        
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Limite de requêtes dépassée, veuillez réessayer plus tard" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: "Erreur lors de la génération des prompts" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      generatedContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
    
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
