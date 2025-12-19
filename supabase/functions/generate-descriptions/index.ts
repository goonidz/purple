import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
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

    const { videoScript } = await req.json();
    
    if (!videoScript) {
      throw new Error("Le script vidéo est requis");
    }

    const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    const systemPrompt = `You generate ultra-short YouTube descriptions.

ABSOLUTE LANGUAGE RULE - THIS IS MANDATORY:
1. First, detect the language of the video script provided
2. Your description MUST be written in that EXACT language - no exceptions
3. If script is English → respond in English
4. If script is French → respond in French  
5. If script is German → respond in German
6. NEVER default to French or any other language - MATCH the script's language exactly

Your task: write ONE SINGLE SENTENCE in first person (I/we) that summarizes the video.

Rules:
- ONE SENTENCE only
- First person (I explain, I show you, I discovered...)
- Conversational and authentic tone
- No emojis
- No marketing phrases
- MUST be in the same language as the script`;

    const userPrompt = `MANDATORY: Your response MUST be in the SAME language as this script.

Script language detection: Read the script below and identify its language.

Script:
${videoScript}

Now write ONE SINGLE SENTENCE description in first person, in the EXACT SAME language as the script above.

Return ONLY this JSON:
{
  "description": "your sentence here - MUST BE IN THE SCRIPT'S LANGUAGE"
}`;

    console.log('Calling Google Gemini API for description generation...');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
          }
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte. Veuillez réessayer dans quelques instants." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('Google AI API error:', response.status, errorText);
      throw new Error(`Erreur API: ${response.status}`);
    }

    const data = await response.json();
    const aiContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    console.log('AI Response:', aiContent);

    // Remove markdown code blocks if present
    let cleanedContent = aiContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Parse the JSON response
    const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Format de réponse invalide de l\'IA');
    }

    const parsedResponse = JSON.parse(jsonMatch[0]);
    const description = parsedResponse.description;

    if (!description || typeof description !== 'string') {
      throw new Error('Le format de la description est invalide');
    }

    return new Response(
      JSON.stringify({ description }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in generate-descriptions function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erreur lors de la génération des descriptions' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
