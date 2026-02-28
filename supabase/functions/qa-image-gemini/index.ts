import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QA_PROMPT = `Tu es un expert QA qui détecte UNIQUEMENT les erreurs TECHNIQUES de génération d'image cartoon.

========================================
TA MISSION : DÉTECTER DES BUGS, PAS VÉRIFIER DES CONSIGNES
========================================

Tu ne dois PAS vérifier si l'image respecte les instructions du prompt source. Ignore complètement "no text", "avoid text", ou toute autre consigne.

Ton rôle : détecter si l'IA a produit un BUG TECHNIQUE visible.

========================================
RÈGLE SUR LE TEXTE (ULTRA-SIMPLE)
========================================

- Texte LISIBLE (peu importe le contenu) = PAS UN BUG = status: "OK"
- Texte ILLISIBLE/GRIBOUILLIS (lettres mélangées, symboles aléatoires) = BUG = status: "REJECT"

Exemples de texte LISIBLE (TOUS acceptables) :
- Mots réels : "NVIDIA", "Amazon", "BORING", "OPEN", "Hello", "2024"
- Symboles : "$", "€", "+", "✓", "✗"
- Logos de marques
- Panneaux, affiches, enseignes
- Tout texte dont on peut lire les lettres

Exemples de texte ILLISIBLE (à rejeter) :
- "NVIDI@#$A", "am@z0n##", "B0R!N6#"
- Lettres déformées, fondues, incompréhensibles

========================================
RÈGLE SUR L'ANATOMIE
========================================

- Membres EN TROP (3 bras, 6 doigts, 3 jambes) = BUG = status: "REJECT"
- Membre détaché du corps ou traversant un objet = BUG = status: "REJECT"
- Personnage sans visage ou simplifié = PAS UN BUG = status: "OK"

========================================
RÈGLE SUR LE CADRAGE
========================================

- Bandes NOIRES sur les côtés, en haut ou en bas = BUG = status: "REJECT"
- L'image doit prendre TOUT l'écran, pas de letterbox/pillarbox
- Marges blanches/colorées normales = OK
- Seules les bandes NOIRES épaisses sont un problème

========================================
PROMPT DE RÉGÉNÉRATION (SI REJECT)
========================================

Si tu dois rejeter (status: "REJECT"), ton prompt de régénération DOIT :
1. GARDER LA MÊME STRUCTURE que le prompt source
2. GARDER LE MÊME DÉBUT (style, character description, etc.)
3. CHANGER UNIQUEMENT la scène visuelle pour éviter le bug

Exemple :
- Prompt source : "simple 2D cartoon illustration by using the same style and character I sent you, showing him looking at a broken calculator, clean white background"
- Prompt régénération : "simple 2D cartoon illustration by using the same style and character I sent you, showing him looking at a handheld device with a grid of small empty squares, clean white background"

GARDE TOUJOURS : "simple 2D cartoon illustration by using the same style and character I sent you, showing"
CHANGE UNIQUEMENT : la description de la scène après "showing"

========================================
FORMAT DE RÉPONSE JSON
========================================

Réponds UNIQUEMENT avec ce format JSON :
{
"status": "OK" ou "REJECT",
"anomalie_detectee": "anatomie" | "texte" | "aucune",
"explication": "Brève description du BUG TECHNIQUE si REJECT, sinon chaîne vide",
"prompt_regeneration": "Prompt avec EXACTEMENT la même structure que le prompt source si REJECT, sinon chaîne vide"
}

========================================
CONTEXTE
========================================

Prompt source qui a généré l'image :
(variable qui insère le prompt lié à l'image)

Note : Le prompt source peut contenir "no text" ou "avoid text". IGNORE-LE complètement. Il ne définit PAS ce qui est un bug.`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { imageUrl, userId, qaPrompt, sourcePrompt, mode } = body;

    console.log('QA request body:', { imageUrl: imageUrl?.substring(0, 100), userId, hasCustomPrompt: !!qaPrompt, hasSourcePrompt: !!sourcePrompt, mode });

    if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      throw new Error('imageUrl is required and must be a non-empty string');
    }

    if (!userId) {
      throw new Error('userId is required');
    }

    // Get Gemini API key from Vault
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: geminiKey, error: keyError } = await adminClient.rpc('get_user_api_key', {
      key_name: 'gemini',
      p_user_id: userId
    });

    if (keyError || !geminiKey) {
      console.error('Error getting Gemini API key:', keyError);
      throw new Error('Gemini API key not configured for this user');
    }

    // ---- MODE: describe (thumbnail composition analysis) ----
    if (mode === 'describe') {
      const describePrompt = `You are a thumbnail composition analyst. Describe this YouTube thumbnail as a structured creative brief that can be used to recreate a similar thumbnail from scratch.

You must be EXTREMELY detailed and specific. Each section must contain multiple bullet points with granular descriptions. Think like a graphic designer writing production specs.

OUTPUT FORMAT — Use EXACTLY these sections in this order. Fill each section with concrete, specific, granular details from the image. If a section does not apply (e.g., no symbolic object), write "None" for that section.

BACKGROUND (FULL WIDTH)
Describe in detail:
- Exact background color(s) (e.g., "soft muted teal / blue-green")
- Gradient direction and intensity, or solid color
- Blur level and texture
- Tone and mood (e.g., "calm but somber", "energetic and bold")
- Level of detail: clean, busy, photographic, illustrated, etc.
- Any patterns, shapes, or environmental elements in the background

CHARACTER (specify position: LEFT/RIGHT/CENTER and approximate % of frame, e.g., "LEFT SIDE – 35-40%")
Describe in detail:
- Exact position in frame (left third, center, right side, etc.) and approximate percentage of frame occupied
- Framing: headshot, upper body, full body, etc.
- Direction they face: directly toward camera, angled left/right, profile
- Expression: be very specific (e.g., "serious, concerned, attentive" not just "serious")
- Emotion conveyed (e.g., "worry, realism, and responsibility")
- Posture: relaxed, tense, arms crossed, pointing, hands on hips, etc.
- Hand gestures and body language details
- Separation from background: soft depth of field, hard cutout, glow, shadow, etc.
- Role/function of the character in the composition (e.g., "functions as the voice of the generation", "acts as an authority figure")
- IMPORTANT: Never describe the person's physical appearance (skin color, hair, clothes, gender, age). Always refer to them as "the character" or "my character".
- If multiple people: use "my character" for the main subject, describe others generically.

MAIN TEXT (specify position, e.g., "RIGHT SIDE – DOMINANT")
Describe in detail:
- Exact text visible, reproduced in UPPERCASE between quotes
- Text layout: list each line separately (e.g., Line 1: "GEN X", Line 2: "RETIREMENT", Line 3: "CRISIS")
- All caps or mixed case
- Font style: bold, thin, sans-serif, serif, handwritten, etc.
- Font color with specifics (e.g., "light blue / cyan tone with dark outline or shadow")
- Font size relative to frame (e.g., "very large, occupying most of the right half")
- Effects: outline, drop shadow, glow, gradient, 3D effect, stroke
- Vertical or horizontal stacking
- Alignment: left, center, right, center-right
- Whether the text is the most dominant element or secondary

SYMBOLIC OBJECT(S) (specify exact position, e.g., "BOTTOM RIGHT")
Describe in detail for each object:
- What the object is (e.g., "a retro cassette tape", "a stack of dollar bills", "a red arrow pointing down")
- Visual style: flat, semi-realistic, photographic, 3D rendered, illustrated
- Color tone of the object
- Shadow or grounding effect
- Symbolic meaning in context (e.g., "acts as a generational symbol / nostalgia / Gen X reference")
- Size relative to other elements (e.g., "should not overpower the headline")

COLOR & MOOD
- Exact dominant color palette (e.g., "cool palette: blues, teals")
- Colors to avoid (e.g., "no bright or aggressive colors")
- Overall mood: calm, serious, reflective, aggressive, fun, dramatic, etc.
- Vibe: educational, explanatory, sensational, clickbait, premium, etc.
- Contrast level and saturation notes

VISUAL HIERARCHY (ordered from most to least dominant)
List every element in order of visual impact/attention, e.g.:
1. "CRISIS" (text)
2. "RETIREMENT" (text)
3. "GEN X" (text)
4. Character (emotional anchor)
5. Cassette tape (symbolic context)

--- EXAMPLE OUTPUT (for reference — your output must match this level of detail) ---

BACKGROUND (FULL WIDTH)
Soft, muted teal / blue-green background.
Slight gradient or subtle blur.
Calm but somber tone.
No sharp details; background should feel neutral and serious.

CHARACTER (LEFT SIDE – 35–40%)
Single character positioned on the left third of the frame.
Framing: upper body visible.
Facing directly toward the camera.
Expression: serious, concerned, attentive.
Emotion conveys worry, realism, and responsibility.
Neutral posture, arms relaxed.
Clean separation from background (soft depth of field or cutout).
Character functions as the "voice of the generation."

MAIN TEXT (RIGHT SIDE – DOMINANT)
Large stacked headline occupying most of the right half.
Text layout:
Line 1: "GEN X"
Line 2: "RETIREMENT"
Line 3: "CRISIS"
All text: Uppercase, Bold sans-serif, Light blue / cyan tone with dark outline or shadow.
Very large font size, strong vertical stacking.
Aligned left or center-right.
Text should be the most dominant element in the thumbnail.

SYMBOLIC OBJECT (BOTTOM RIGHT)
A retro cassette tape placed at the bottom right.
Flat or semi-realistic appearance.
Blue-toned casing.
Slight shadow to ground it visually.
Acts as a generational symbol (nostalgia / Gen X reference).
Object should not overpower the headline.

COLOR & MOOD
Cool color palette (blues, teals).
No bright or aggressive colors.
Calm, serious, reflective tone.
Educational / explanatory vibe rather than sensational.

VISUAL HIERARCHY
1. "CRISIS"
2. "RETIREMENT"
3. "GEN X"
4. Character (emotional anchor)
5. Cassette tape (symbolic context)

--- END EXAMPLE ---

Now analyze the provided thumbnail with AT LEAST this level of detail. Respond ONLY with the structured description. No introduction, no commentary, no summary.`;

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: describePrompt },
                { inline_data: { mime_type: "image/jpeg", data: await fetchImageAsBase64(imageUrl) } }
              ]
            }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 3000 }
          })
        }
      );

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
      }

      const geminiResult = await geminiResponse.json();
      const description = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!description) {
        throw new Error('No description from Gemini');
      }

      return new Response(
        JSON.stringify({ description: description.trim() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // ---- MODE: QA (default) ----
    // Use custom QA prompt if provided, otherwise use default
    let promptToUse = qaPrompt || QA_PROMPT;
    console.log('[qa-image-gemini] Custom prompt provided:', !!qaPrompt);
    console.log('[qa-image-gemini] Prompt length:', promptToUse.length);
    console.log('[qa-image-gemini] Prompt contains "SYMBOLES ICONOGRAPHIQUES":', promptToUse.includes('SYMBOLES ICONOGRAPHIQUES'));
    
    // Insert source prompt if provided
    if (sourcePrompt) {
      promptToUse = promptToUse.replace('(variable qui insère le prompt lié à l\'image)', sourcePrompt);
    } else {
      // Remove the placeholder if no source prompt
      promptToUse = promptToUse.replace('Prompt source qui a généré l\'image que tu as reçu :\n\n(variable qui insère le prompt lié à l\'image)\n\n', '');
    }
    
    // Log the COMPLETE prompt once per request (for debugging)
    console.log('[qa-image-gemini] ========== COMPLETE QA PROMPT ==========');
    console.log(promptToUse);
    console.log('[qa-image-gemini] ========================================')

    // Use Gemini 2.0 Flash (higher quota than gemini-2.5-flash-lite which has 20 req/day free tier)
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptToUse
                },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: await fetchImageAsBase64(imageUrl)
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["OK", "REJECT"],
                  description: "Status of the QA check - OK if image is fine, REJECT if technical bug detected"
                },
                anomalie_detectee: {
                  type: "string",
                  enum: ["aucune", "anatomie", "texte", "cadrage"],
                  description: "Type of anomaly detected - aucune, anatomie, texte, or cadrage"
                },
                explication: {
                  type: "string",
                  description: "Brief explanation of the technical bug if REJECT, empty string otherwise"
                },
                prompt_regeneration: {
                  type: "string",
                  description: "Regeneration prompt with same structure as source if REJECT, empty string otherwise"
                }
              },
              required: ["status", "anomalie_detectee", "explication", "prompt_regeneration"]
            }
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiResult = await geminiResponse.json();
    
    // Extract the response text
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      throw new Error('No response text from Gemini');
    }

    console.log('Gemini raw response:', responseText);

    // With structured output (responseSchema), Gemini GUARANTEES valid JSON
    // No need for complex parsing logic or fallbacks
    const qaResult = JSON.parse(responseText);

    // Extra validation (should never fail with structured output)
    if (!qaResult.status || !qaResult.anomalie_detectee) {
      throw new Error('Invalid QA response structure');
    }

    return new Response(
      JSON.stringify(qaResult),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('QA Image Gemini error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        status: 'ERROR',
        anomalie_detectee: 'aucune',
        explication: `Erreur lors de l'analyse: ${error.message}`,
        prompt_regeneration: ''
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );
  
  return base64;
}
