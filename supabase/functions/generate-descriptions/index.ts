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

// Parse timestamp string (M:SS or H:MM:SS) to seconds
function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 2) {
    // M:SS format
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // H:MM:SS format
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
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

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: GOOGLE_AI_API_KEY, error: keyError } = await supabaseAdmin.rpc('get_user_api_key_for_service', {
      target_user_id: user.id,
      key_name: 'gemini'
    });

    if (keyError || !GOOGLE_AI_API_KEY) {
      console.error("Gemini API key not found for user:", user.id, keyError);
      return new Response(
        JSON.stringify({ error: "Clé API Gemini non configurée. Ajoutez-la dans votre profil." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hasScenes = scenes && Array.isArray(scenes) && scenes.length > 0;
    console.log('[DEBUG] hasScenes:', hasScenes);

    // Build the system prompt based on whether we need chapters
    let systemPrompt = `You generate ultra-short YouTube descriptions.

CRITICAL LANGUAGE RULE - THIS IS THE HIGHEST PRIORITY:
1. FIRST, read the entire video script and identify its language
2. Your ENTIRE response (description AND chapters) MUST be written in that EXACT language
3. If the script is in English → write EVERYTHING in English
4. If the script is in French → write EVERYTHING in French
5. If the script is in German → write EVERYTHING in German
6. If the script is in Spanish → write EVERYTHING in Spanish
7. If the script is in Italian → write EVERYTHING in Italian
8. NEVER translate or change the language - MATCH the script's language EXACTLY
9. If you are unsure of the language, analyze the script more carefully before responding

Your task: write ONE SINGLE SENTENCE in first person (I/we) that summarizes the video.

Rules for description:
- ONE SENTENCE only
- First person (I explain, I show you, I discovered...)
- Conversational and authentic tone
- No emojis
- No marketing phrases
- CRITICAL: MUST be in the EXACT SAME language as the script (detect the script's language first!)`;

    if (hasScenes) {
      systemPrompt += `

ADDITIONAL TASK - YouTube Chapters:
You will analyze the video script and generate meaningful chapter titles at key moments (approximately every 3-4 minutes).

Rules for chapter generation:
- Analyze the script content to identify natural topic transitions and key moments
- Generate chapters approximately every 3-4 minutes based on content structure
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
- Don't use emojis
- Focus on major topic shifts, not minor scene changes`;
    }

    // Build the user prompt
    let userPrompt = `STEP 1: DETECT THE LANGUAGE OF THIS SCRIPT
Read the script below carefully and identify what language it is written in.

Script:
${videoScript}

STEP 2: RESPOND IN THAT EXACT LANGUAGE
Now write ONE SINGLE SENTENCE description in first person, using the EXACT SAME language as the script above.

CRITICAL: 
- If the script is in English, write in English
- If the script is in French, write in French
- If the script is in German, write in German
- DO NOT translate or change the language
- MATCH the script's language EXACTLY`;

    if (hasScenes) {
      // Calculate total video duration
      const totalDuration = Math.max(...(scenes as SceneInfo[]).map(s => s.endTime || s.startTime));
      const durationInMinutes = totalDuration / 60;
      
      // Estimate number of chapters (one every 3-4 minutes)
      const estimatedChapters = Math.max(1, Math.floor(durationInMinutes / 3.5));
      
      // Provide scene timeline for context
      const scenesTimeline = (scenes as SceneInfo[]).map((scene, index) => 
        `${formatYouTubeTimestamp(scene.startTime)}: "${scene.text.substring(0, 150)}${scene.text.length > 150 ? '...' : ''}"`
      ).join('\n');

      userPrompt += `

ANALYZE THE SCRIPT ABOVE and generate meaningful YouTube chapters.

Video duration: approximately ${Math.round(durationInMinutes)} minutes
Generate approximately ${estimatedChapters} chapters (one every 3-4 minutes) at key moments where topics shift or important points are made.

Scene timeline for reference:
${scenesTimeline}

CRITICAL LANGUAGE REQUIREMENT:
- ALL chapter titles MUST be in the EXACT SAME language as the script
- If the script is in English, write chapter titles in English
- If the script is in French, write chapter titles in French
- If the script is in German, write chapter titles in German
- DO NOT translate chapter titles - use the script's language

IMPORTANT: 
- Analyze the script content to identify natural topic transitions
- Generate chapters at meaningful moments (major topic shifts, key revelations, important points)
- Do NOT create a chapter for every scene - only for significant content breaks
- Space chapters approximately 3-4 minutes apart based on content structure
- The first chapter MUST be at 0:00

Return ONLY this JSON:
{
  "description": "your sentence here - MUST BE IN THE SCRIPT'S LANGUAGE",
  "chapters": [
    {"time": "0:00", "title": "Chapter title 1 - IN SCRIPT'S LANGUAGE"},
    {"time": "3:45", "title": "Chapter title 2 - IN SCRIPT'S LANGUAGE"},
    {"time": "7:20", "title": "Chapter title 3 - IN SCRIPT'S LANGUAGE"}
  ]
}

Each chapter object must have:
- "time": timestamp in format "M:SS" or "H:MM:SS" (must match actual content moments in the script)
- "title": catchy chapter title (2-5 words, MUST be in the script's language - same language as the description!)

Generate ${estimatedChapters} to ${estimatedChapters + 1} chapters based on content analysis.`;
    } else {
      userPrompt += `

Return ONLY this JSON:
{
  "description": "your sentence here - MUST BE IN THE SCRIPT'S LANGUAGE"
}`;
    }

    console.log('Calling Google Gemini API for description generation...');
    console.log('[DEBUG] Script preview (first 200 chars):', videoScript.substring(0, 200));
    console.log('[DEBUG] System prompt length:', systemPrompt.length);
    console.log('[DEBUG] User prompt length:', userPrompt.length);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${GOOGLE_AI_API_KEY}`,
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
      console.log('[DEBUG] Formatting chapters, count:', parsedResponse.chapters.length);
      
      // Check if chapters are in new format (objects with time and title) or old format (array of strings)
      const isNewFormat = parsedResponse.chapters.length > 0 && 
                          typeof parsedResponse.chapters[0] === 'object' && 
                          parsedResponse.chapters[0].time !== undefined;
      
      let chaptersText: string;
      
      if (isNewFormat) {
        // New format: chapters with timestamps from AI
        const chapters = parsedResponse.chapters as Array<{time: string, title: string}>;
        chaptersText = chapters
          .sort((a, b) => {
            // Sort by timestamp (convert to seconds for comparison)
            const timeA = parseTimestampToSeconds(a.time);
            const timeB = parseTimestampToSeconds(b.time);
            return timeA - timeB;
          })
          .map(ch => `${ch.time} - ${ch.title}`)
          .join('\n');
      } else {
        // Old format: array of titles, use scene timestamps
        const chapters = parsedResponse.chapters as string[];
        chaptersText = (scenes as SceneInfo[]).map((scene, index) => {
          const timestamp = formatYouTubeTimestamp(scene.startTime);
          const title = chapters[index] || `Scene ${index + 1}`;
          return `${timestamp} - ${title}`;
        }).join('\n');
      }

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
