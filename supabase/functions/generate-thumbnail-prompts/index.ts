import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { isInternalServiceCall } from "../_shared/auth.ts";

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

    // Check if this is a service role key (internal call).
    // Uses the shared helper which accepts ANY valid service-role-equivalent
    // token (legacy SUPABASE_SERVICE_ROLE_KEY JWT, new sb_secret_* keys
    // exposed via SUPABASE_SECRET_KEYS, or extras in SERVICE_KEY_ALLOWLIST)
    // — required since Supabase started auto-rotating the value injected
    // under SUPABASE_SERVICE_ROLE_KEY in May 2026.
    const isServiceRoleCall = isInternalServiceCall(req);

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

    const { videoScript, videoTitle, exampleUrls, characterRefUrl, previousPrompts, customPrompt, userIdea, userIdeaCount, totalCount: totalCountRaw, textModel, userId: bodyUserId } = await req.json();

    // totalCount controls how many prompts the model should produce.
    // Default 5 keeps backward compatibility for legacy callers.
    // Clamped to [1..5] (the JSON template + downstream image generation expect ≤ 5 slots).
    const totalCount = Math.max(1, Math.min(5, Math.floor(
      typeof totalCountRaw === 'number' ? totalCountRaw : 5
    )));

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

    const hasExamples = exampleUrls && Array.isArray(exampleUrls) && exampleUrls.length > 0;

    // Check which model to use
    const useClaudeModel = textModel === 'claude-sonnet-4-6' || textModel === 'claude-sonnet-4';
    
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    
    if (!useClaudeModel && !GOOGLE_AI_API_KEY) {
      console.error("GOOGLE_AI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante (GOOGLE_AI_API_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // For Claude, we need to get user's Anthropic API key
    let anthropicApiKey: string | null = null;
    if (useClaudeModel) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      
      const authHeader = req.headers.get('Authorization');
      const isServiceRoleCall = isInternalServiceCall(req);
      
      let targetUserId: string | null = null;
      
      if (isServiceRoleCall && bodyUserId) {
        targetUserId = bodyUserId;
        console.log(`Using userId from body for internal call: ${targetUserId}`);
      } else if (!isServiceRoleCall) {
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
          { target_user_id: targetUserId, key_name: 'anthropic' }
        );
        anthropicApiKey = apiKeyData;
      }
      
      if (!anthropicApiKey) {
        return new Response(
          JSON.stringify({ error: "Clé API Anthropic non configurée. Ajoutez-la dans votre profil." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const hasCharacterRef = !!characterRefUrl;
    
    // Use custom prompt if provided, otherwise use default
    let systemPrompt = customPrompt || `Tu es un expert en création de miniatures YouTube accrocheuses et performantes.

Ton rôle est de créer 5 prompts de miniatures YouTube BASÉS SUR LE CONTENU DU SCRIPT/TITRE fourni, en utilisant le STYLE VISUEL des exemples comme référence.

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

    // Determine how many of the totalCount prompts should be variations of the user idea.
    // Falls back to min(2, totalCount) (legacy default) if userIdea is provided but no count
    // is sent (e.g. older clients). Clamped to [0..totalCount]. If userIdea is missing/empty,
    // count = 0.
    const ideaCountRaw = typeof userIdeaCount === 'number'
      ? userIdeaCount
      : (userIdea && userIdea.trim() ? Math.min(2, totalCount) : 0);
    const ideaCount = Math.max(0, Math.min(totalCount, Math.floor(ideaCountRaw)));
    const hasUserIdea = !!(userIdea && userIdea.trim()) && ideaCount > 0;

    // Helper: format slot lists like ["#1"] -> "#1", ["#1","#2"] -> "#1 and #2",
    // ["#1","#2","#3"] -> "#1, #2, and #3"
    const formatSlots = (slots: string[]): string => {
      if (slots.length === 0) return '';
      if (slots.length === 1) return slots[0];
      if (slots.length === 2) return `${slots[0]} and ${slots[1]}`;
      return `${slots.slice(0, -1).join(', ')}, and ${slots[slots.length - 1]}`;
    };

    if (hasUserIdea) {
      const appliedSlots = Array.from({ length: ideaCount }, (_, i) => `#${i + 1}`);
      const ignoredSlots = Array.from({ length: totalCount - ideaCount }, (_, i) => `#${ideaCount + i + 1}`);
      const ignoredCount = totalCount - ideaCount;
      const appliedLabel = formatSlots(appliedSlots);
      const ignoredLabel = formatSlots(ignoredSlots);

      systemPrompt += `

💡 USER'S IDEA — PARTIAL DIRECTION (TWO MODES IN ONE BATCH):
The user provided this idea: "${userIdea.trim()}"

═══════════════════════════════════════════════════════════
MODE A — IDEA-DRIVEN PROMPTS (prompt${ideaCount > 1 ? 's' : ''} ${appliedLabel}, ${ideaCount} of ${totalCount}):
═══════════════════════════════════════════════════════════
For these ${ideaCount} prompt${ideaCount > 1 ? 's' : ''}, THE USER'S IDEA ABOVE IS THE SOLE SOURCE OF TRUTH for visual style.

STRICT OVERRIDE RULES — these ${ideaCount > 1 ? 'prompts' : 'prompt'} MUST:
1. Follow STRICTLY and ONLY what is described in the user's idea
2. OVERRIDE / IGNORE any conflicting visual rule from this system prompt
   (background color, lighting, color palette, framing, composition style, etc.)
   For example: if the system prompt says "white background" but the user's idea
   says "fond sombre" / "dark background", these prompts MUST use a dark background.
3. IGNORE the visual style of the example thumbnails when it conflicts with the user's idea
4. Use the script ONLY to pick the SUBJECT/CONTENT (what to depict), NOT the style
${ideaCount > 1 ? `5. Each of the ${ideaCount} prompts explores a DIFFERENT angle/composition of the user's idea (varied between each other, but all faithful to the idea)\n` : ''}
The ONLY rules that still apply: 60-100 words per prompt, English, simple composition (3-4 elements max), no banned words ("dead").${ignoredCount > 0 ? `

═══════════════════════════════════════════════════════════
MODE B — SCRIPT-ONLY PROMPTS (prompt${ignoredCount > 1 ? 's' : ''} ${ignoredLabel}, ${ignoredCount} of ${totalCount}):
═══════════════════════════════════════════════════════════
For these ${ignoredCount} prompt${ignoredCount > 1 ? 's' : ''}, COMPLETELY IGNORE the user's idea above. Apply all the standard rules from this system prompt:
- Use the visual style from the example thumbnails (colors, composition, typography)
- Base the content ONLY on the video script/title
- Do NOT reference, hint at, or visually echo the user's idea${ignoredCount > 1 ? `
- The ${ignoredCount} prompts must be DISTINCT angles drawn from the script (different from each other)` : ''}` : ''}

Final result: ${ideaCount} idea-driven + ${ignoredCount} script-only thumbnail${(ideaCount + ignoredCount) > 1 ? 's' : ''}.`;
    }

    // Per-slot lines — each line in the JSON template is rebuilt to match the slot's mode
    // (idea-driven vs script-only) so the model cannot drift back to mixing the two.
    const ordinals = ['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième'];
    const buildSlotLine = (slotIdx: number /* 0-based */): string => {
      const ord = ordinals[slotIdx] || `prompt #${slotIdx + 1}`;
      if (!hasUserIdea) {
        if (slotIdx === 0) return `"${ord} prompt détaillé reprenant le style des exemples..."`;
        if (slotIdx === 1) return `"${ord} prompt avec même style mais variation différente..."`;
        return `"${ord} prompt toujours dans le même style, autre variation..."`;
      }
      if (slotIdx < ideaCount) {
        const variantHint = slotIdx === 0
          ? 'première interprétation de l\'idée'
          : `interprétation #${slotIdx + 1} de l'idée (angle/composition différent des précédentes)`;
        return `"${ord} prompt — MODE A : suit STRICTEMENT et UNIQUEMENT l'idée utilisateur, IGNORE les exemples et toute règle stylistique contradictoire du prompt système (fond, couleurs, lighting, etc.) — ${variantHint}..."`;
      }
      const ignoredOrdinal = slotIdx - ideaCount;
      if (ignoredOrdinal === 0) {
        return `"${ord} prompt — MODE B : reprenant le style des exemples, basé uniquement sur le script, ignore complètement l'idée utilisateur..."`;
      }
      const prevIgnoredRefs = Array.from({ length: ignoredOrdinal }, (_, i) => `#${ideaCount + i + 1}`).join(', ');
      return `"${ord} prompt — MODE B : reprenant le style des exemples, basé uniquement sur le script, ignore l'idée utilisateur, autre angle du script (différent du/des ${prevIgnoredRefs})..."`;
    };

    const slotLines = Array.from({ length: totalCount }, (_, i) => buildSlotLine(i)).join(',\n    ');
    systemPrompt += `

Retourne UNIQUEMENT un JSON avec ce format exact (${totalCount} prompt${totalCount > 1 ? 's' : ''}):
{
  "prompts": [
    ${slotLines}
  ]
}`;

    // Build content parts array for Google Gemini API
    const contentParts: any[] = [];

    if (hasExamples) {
      contentParts.push(
        { text: "EXEMPLES DE MINIATURES À REPRODUIRE (analyse le style, la composition, les couleurs):" }
      );

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
    } else {
      console.log("No example images provided, generating without style reference");
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

    console.log(`Generating thumbnail prompts with ${useClaudeModel ? 'Claude Sonnet 4.6 (Anthropic)' : 'Gemini 2.0 Flash'}...`);
    console.log(`[generate-thumbnail-prompts] totalCount=${totalCount}, ideaCount=${ideaCount}, hasUserIdea=${hasUserIdea}`);
    console.log(`Processed ${hasExamples ? exampleUrls.length : 0} example images and ${characterRefUrl ? '1' : '0'} character image`);

    let generatedContent: string;

    if (useClaudeModel) {
      // Build multimodal content blocks for Anthropic Messages API
      const userContent: any[] = [];

      if (hasExamples) {
        userContent.push({ type: "text", text: "EXEMPLES DE MINIATURES À REPRODUIRE (analyse le style, la composition, les couleurs):" });

        for (const url of exampleUrls) {
          const imageData = await imageUrlToBase64(url);
          if (imageData) {
            userContent.push({
              type: "image",
              source: { type: "base64", media_type: imageData.mimeType, data: imageData.data }
            });
          }
        }
      }

      if (characterRefUrl) {
        userContent.push({ type: "text", text: "PERSONNAGE À UTILISER (celui-ci uniquement, pas les autres personnages des exemples):" });
        const charImageData = await imageUrlToBase64(characterRefUrl);
        if (charImageData) {
          userContent.push({
            type: "image",
            source: { type: "base64", media_type: charImageData.mimeType, data: charImageData.data }
          });
        }
      }

      userContent.push({ type: "text", text: `
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

Crée des designs SIMPLES (3-4 éléments max) mais PERTINENTS au script.

CRITICAL OUTPUT INSTRUCTION: You MUST call the generate_prompts tool with exactly ${totalCount} detailed image generation prompt${totalCount > 1 ? 's' : ''} in the "prompts" array. Each prompt must be a complete, standalone text description for an AI image generator. Do NOT return an empty object.` });

      try {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 8192,
            temperature: previousPrompts && previousPrompts.length > 0 ? 0.95 : 0.7,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
            tools: [{
              name: 'generate_prompts',
              description: `You MUST use this tool to return your ${totalCount} thumbnail prompt${totalCount > 1 ? 's' : ''}. Put each image generation prompt as a string in the prompts array. Each prompt should be a complete standalone text description (60-100 words) that an AI image generator can use to create a YouTube thumbnail.`,
              input_schema: {
                type: 'object',
                properties: {
                  prompts: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: totalCount,
                    maxItems: totalCount,
                    description: `Array of exactly ${totalCount} detailed image generation prompt string${totalCount > 1 ? 's' : ''}. Each string is a complete image description.`
                  }
                },
                required: ['prompts']
              }
            }],
            tool_choice: { type: 'tool', name: 'generate_prompts' }
          }),
        });

        if (!anthropicResponse.ok) {
          const errorText = await anthropicResponse.text();
          console.error("Anthropic API error:", anthropicResponse.status, errorText);

          if (anthropicResponse.status === 429) {
            return new Response(
              JSON.stringify({ error: "Limite de requêtes dépassée, veuillez réessayer plus tard" }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({ error: `Erreur Claude: ${anthropicResponse.status} - ${errorText}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const anthropicData = await anthropicResponse.json();
        console.log("Claude response structure:", JSON.stringify({
          stop_reason: anthropicData.stop_reason,
          content_types: (anthropicData.content || []).map((b: any) => b.type),
          usage: anthropicData.usage
        }));
        const toolBlock = (anthropicData.content || []).find((b: any) => b.type === 'tool_use');
        if (toolBlock?.input?.prompts && Array.isArray(toolBlock.input.prompts) && toolBlock.input.prompts.length > 0) {
          generatedContent = JSON.stringify(toolBlock.input);
        } else {
          console.log("Tool_use empty or missing prompts, retrying WITHOUT tool_use...");
          const retryResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicApiKey!,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 8192,
              temperature: previousPrompts && previousPrompts.length > 0 ? 0.95 : 0.7,
              system: systemPrompt + `\n\nYou MUST respond with ONLY a valid JSON object containing exactly ${totalCount} prompt${totalCount > 1 ? 's' : ''}: {"prompts": [${Array.from({ length: totalCount }, (_, i) => `"prompt${i + 1}"`).join(', ')}]}. No other text.`,
              messages: [{ role: 'user', content: userContent }],
            }),
          });
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            generatedContent = (retryData.content || [])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('');
            console.log("Retry response (first 300 chars):", generatedContent.substring(0, 300));
          } else {
            const retryError = await retryResponse.text();
            console.error("Retry also failed:", retryResponse.status, retryError);
            generatedContent = '';
          }
        }
      } catch (claudeError: any) {
        console.error("Anthropic Claude error:", claudeError);
        return new Response(
          JSON.stringify({ error: `Erreur lors de la génération des prompts avec Claude: ${claudeError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
    } else {
      // Use Gemini (existing logic). Honor the textModel coming from the preset/UI:
      // supported values: 'gemini-3-flash-preview' (default), 'gemini-2.0-flash' (legacy).
      const geminiModelId = (typeof textModel === 'string' && textModel.startsWith('gemini-'))
        ? textModel
        : 'gemini-3-flash-preview';
      console.log(`[generate-thumbnail-prompts] Using Gemini model: ${geminiModelId}`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModelId}:generateContent?key=${GOOGLE_AI_API_KEY}`,
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
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  prompts: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  }
                },
                required: ["prompts"]
              }
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
    
    console.log("Raw AI response:", generatedContent.substring(0, 500));

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(generatedContent);
    } catch {
      try {
        const cleaned = generatedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in response");
        parsedResponse = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error("Failed to parse AI response:", parseError, "Raw content:", generatedContent.substring(0, 1000));
        return new Response(
          JSON.stringify({ error: "Erreur lors du parsing de la réponse AI", raw: generatedContent.substring(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!parsedResponse.prompts || !Array.isArray(parsedResponse.prompts) || parsedResponse.prompts.length < 1) {
      console.error("Invalid prompts format:", JSON.stringify(parsedResponse).substring(0, 500));
      return new Response(
        JSON.stringify({ error: "Format de prompts invalide", keys: Object.keys(parsedResponse), raw: JSON.stringify(parsedResponse).substring(0, 300) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully generated ${parsedResponse.prompts.length} thumbnail prompt${parsedResponse.prompts.length > 1 ? 's' : ''} (requested: ${totalCount})`);

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
