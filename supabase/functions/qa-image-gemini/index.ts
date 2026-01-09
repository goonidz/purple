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
    const { imageUrl, userId, qaPrompt, sourcePrompt } = body;

    console.log('QA request body:', { imageUrl: imageUrl?.substring(0, 100), userId, hasCustomPrompt: !!qaPrompt, hasSourcePrompt: !!sourcePrompt });

    if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      throw new Error('imageUrl is required and must be a non-empty string');
    }

    if (!userId) {
      throw new Error('userId is required');
    }

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

    // Call Gemini API to analyze image
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${geminiKey}`,
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

    // Parse JSON response from Gemini
    // Remove markdown code blocks if present
    let cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Try to parse JSON, with fallback for malformed responses
    let qaResult: any;
    try {
      qaResult = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON parse error, attempting to fix:', parseError);
      // Try to extract JSON using regex as fallback
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          qaResult = JSON.parse(jsonMatch[0]);
        } catch {
          // If still fails, return a safe default
          qaResult = {
            status: 'OK',
            anomalie_detectee: 'aucune',
            explication: '',
            prompt_regeneration: ''
          };
          console.log('Fallback to OK status due to parse error');
        }
      } else {
        throw new Error(`Failed to parse Gemini response: ${parseError}`);
      }
    }

    // Validate response structure
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
