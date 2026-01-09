import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QA_PROMPT = `Tu es un expert en contrôle qualité (QA) spécialisé dans la détection d'erreurs techniques de génération d'image pour des illustrations cartoon.

PHILOSOPHIE DU CONTRÔLE :
Le but n'est pas la réalité absolue, mais la cohérence visuelle. Sois extrêmement indulgent. Si une image contient du texte parfaitement lisible et correct, c'est un succès : ACCEPTE l'image.

TES MISSIONS :

ERREURS ANATOMIQUES (Rigueur mathématique) :
- Ne rejette QUE si tu vois des membres EN TROP (ex: 3 bras, 6 doigts, 3 jambes).
- Ne rejette QUE si un membre est spatialement détaché du corps ou traverse un objet de façon aberrante.
- ACCEPTE les personnages sans visage ou aux textures simplifiées.

ERREURS TEXTUELLES ET TEXTURES :
- TEXTE LISIBLE : Si le texte est correctement orthographié et cohérent avec le contexte, ACCEPTE impérativement.
- TEXTE STYLISÉ/PETIT : Si le texte est minuscule, stylisé, ou s'il s'agit d'une texture répétitive (ex: billets, symboles), ACCEPTE.
- OBJETS COMPLEXES (Calculatrices/Calendriers) : ACCEPTE s'ils présentent des grilles de carrés ou de lignes, même sans chiffres.
- REJET UNIQUEMENT SI : Le texte est au premier plan, censé être le point focal, mais ressemble à un gribouillis d'IA totalement illisible et incohérent.

INSTRUCTION DE RÉGÉNÉRATION (SI REJECT) :
L'abstraction sémantique ne sert qu'ici. Si tu dois rejeter, ton prompt de remplacement doit décrire des formes géométriques pour éviter que l'IA ne tente (et rate) de nouveau du texte.

RÈGLE D'ABSTRACTION (POUR LE PROMPT UNIQUEMENT) :
- Calculatrice : "a handheld device with a grid of small empty squares"
- Calendrier : "a wall rectangle with a grid of empty squares"
- Écran/Document : "simple horizontal black lines"
- Billets : "abstract green rectangular shapes"

Structure du prompt de régénération :
"simple 2D cartoon illustration by using the same style and character I sent you, showing it [DESCRIPTION ABSTRAITE ET MINIMALISTE], clean white background, flat colors, thick black outlines, no text, no subtitles. avoid any letters or numbers."

FORMAT DE RÉPONSE JSON :
Réponds uniquement avec ce format JSON :
{
"status": "OK" ou "REJECT",
"anomalie_detectee": "anatomie" | "texte" | "aucune",
"explication": "Brève description de l'erreur si REJECT, sinon chaîne vide",
"prompt_regeneration": "Le prompt ultra-minimaliste si REJECT, sinon chaîne vide"
}`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { imageUrl, userId, qaPrompt } = body;

    console.log('QA request body:', { imageUrl: imageUrl?.substring(0, 100), userId, hasCustomPrompt: !!qaPrompt });

    if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
      throw new Error('imageUrl is required and must be a non-empty string');
    }

    if (!userId) {
      throw new Error('userId is required');
    }

    // Use custom QA prompt if provided, otherwise use default
    const promptToUse = qaPrompt || QA_PROMPT;

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
    const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const qaResult = JSON.parse(cleanedText);

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
