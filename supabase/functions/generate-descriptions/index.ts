import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SceneInfo {
  text: string;
  startTime: number;
  endTime: number;
}

// Format seconds to YouTube chapter format (M:SS or H:MM:SS)
function formatYouTubeTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

    const { videoScript, scenes } = await req.json();
    
    console.log('[DEBUG] Received scenes:', JSON.stringify(scenes));
    console.log('[DEBUG] Scenes type:', typeof scenes);
    console.log('[DEBUG] Scenes is array:', Array.isArray(scenes));
    console.log('[DEBUG] Scenes length:', scenes?.length);
    
    if (!videoScript) {
      throw new Error("Le script vidéo est requis");
    }

    const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    const hasScenes = scenes && Array.isArray(scenes) && scenes.length > 0;
    console.log('[DEBUG] hasScenes:', hasScenes);

    // Build the system prompt based on whether we need chapters
    let systemPrompt = `You generate ultra-short YouTube descriptions.

ABSOLUTE LANGUAGE RULE - THIS IS MANDATORY:
1. First, detect the language of the video script provided
2. Your response MUST be written in that EXACT language - no exceptions
3. If script is English → respond in English
4. If script is French → respond in French  
5. If script is German → respond in German
6. NEVER default to French or any other language - MATCH the script's language exactly

Your task: write ONE SINGLE SENTENCE in first person (I/we) that summarizes the video.

Rules for description:
- ONE SENTENCE only
- First person (I explain, I show you, I discovered...)
- Conversational and authentic tone
- No emojis
- No marketing phrases
- MUST be in the same language as the script`;

    if (hasScenes) {
      systemPrompt += `

ADDITIONAL TASK - YouTube Chapters:
You will also generate catchy, copywritten chapter titles for each scene provided.

Rules for chapter titles:
- Each title should be SHORT (2-5 words max)
- Make them INTRIGUING and CLICKABLE
- Use action words, questions, or dramatic statements
- Examples of good chapter titles:
  * "The Shocking Truth"
  * "Why It Failed"
  * "The Secret Weapon"
  * "Everything Changes"
  * "The Big Reveal"
  * "How I Did It"
  * "The Turning Point"
- MUST be in the same language as the script
- Don't use emojis`;
    }

    // Build the user prompt
    let userPrompt = `MANDATORY: Your response MUST be in the SAME language as this script.

Script language detection: Read the script below and identify its language.

Script:
${videoScript}

Now write ONE SINGLE SENTENCE description in first person, in the EXACT SAME language as the script above.`;

    if (hasScenes) {
      const scenesWithTimestamps = (scenes as SceneInfo[]).map((scene, index) => 
        `Scene ${index + 1} (${formatYouTubeTimestamp(scene.startTime)}): "${scene.text.substring(0, 100)}${scene.text.length > 100 ? '...' : ''}"`
      ).join('\n');

      userPrompt += `

Also generate a catchy chapter title for each of these ${scenes.length} scenes:
${scenesWithTimestamps}

Return ONLY this JSON:
{
  "description": "your sentence here - MUST BE IN THE SCRIPT'S LANGUAGE",
  "chapters": ["Chapter title 1", "Chapter title 2", ...]
}

The chapters array MUST have exactly ${scenes.length} titles, one for each scene, in order.`;
    } else {
      userPrompt += `

Return ONLY this JSON:
{
  "description": "your sentence here - MUST BE IN THE SCRIPT'S LANGUAGE"
}`;
    }

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
    let description = parsedResponse.description;

    if (!description || typeof description !== 'string') {
      throw new Error('Le format de la description est invalide');
    }

    console.log('[DEBUG] Parsed response chapters:', parsedResponse.chapters);
    console.log('[DEBUG] hasScenes:', hasScenes);
    console.log('[DEBUG] parsedResponse.chapters exists:', !!parsedResponse.chapters);
    console.log('[DEBUG] parsedResponse.chapters is array:', Array.isArray(parsedResponse.chapters));

    // If we have chapters, format and append them
    if (hasScenes && parsedResponse.chapters && Array.isArray(parsedResponse.chapters)) {
      const chapters = parsedResponse.chapters as string[];
      console.log('[DEBUG] Formatting chapters, count:', chapters.length);
      const chaptersText = (scenes as SceneInfo[]).map((scene, index) => {
        const timestamp = formatYouTubeTimestamp(scene.startTime);
        const title = chapters[index] || `Scene ${index + 1}`;
        return `${timestamp} - ${title}`;
      }).join('\n');

      console.log('[DEBUG] Formatted chapters text:', chaptersText);
      description = `${description}\n\nCHAPTERS\n${chaptersText}`;
      console.log('[DEBUG] Final description with chapters:', description);
    } else {
      console.log('[DEBUG] No chapters added. hasScenes:', hasScenes, 'chapters in response:', !!parsedResponse.chapters);
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
