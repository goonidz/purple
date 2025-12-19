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

    const { scene, summary, examplePrompts, sceneIndex, totalScenes, startTime, endTime, customSystemPrompt, previousPrompts } = await req.json();

    // DEBUG: Log received examplePrompts
    console.log(`[DEBUG] Scene ${sceneIndex}: Received examplePrompts:`, JSON.stringify(examplePrompts));
    console.log(`[DEBUG] Scene ${sceneIndex}: examplePrompts type: ${typeof examplePrompts}, isArray: ${Array.isArray(examplePrompts)}, length: ${examplePrompts?.length || 0}`);
    if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
      examplePrompts.forEach((ex: string, i: number) => {
        console.log(`[DEBUG] Scene ${sceneIndex}: Example ${i + 1} (first 100 chars): "${ex?.substring(0, 100)}..."`);
      });
    } else {
      console.log(`[DEBUG] Scene ${sceneIndex}: WARNING - No valid examplePrompts received!`);
    }
    console.log(`[DEBUG] Scene ${sceneIndex}: customSystemPrompt provided: ${!!customSystemPrompt}`);

    if (!scene) {
      return new Response(
        JSON.stringify({ error: "Le texte de la scène est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      console.error("GOOGLE_AI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante (GOOGLE_AI_API_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use custom system prompt if provided, otherwise use default
    let systemPrompt: string;
    
    if (customSystemPrompt && customSystemPrompt.trim()) {
      systemPrompt = customSystemPrompt.trim();
      
      // Add examples if provided - emphasize EXACT FORMAT MATCHING
      if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
        systemPrompt += `\n\nFORMAT REFERENCE EXAMPLES - YOU MUST FOLLOW THESE EXACTLY:\n\n`;
        examplePrompts.forEach((example: string, i: number) => {
          systemPrompt += `Example ${i + 1} (COPY THIS EXACT FORMAT STRUCTURE):\n"${example}"\n\n`;
        });
        systemPrompt += `CRITICAL FORMAT REQUIREMENTS:
1. Study the examples above CAREFULLY - analyze the EXACT structure, punctuation, sentence flow, and organization
2. Identify the pattern: How do they start? What comes first (subject, style, composition)? How are elements connected?
3. Match the FORMAT exactly: same sentence structure, same punctuation style, same descriptive flow, same paragraph organization
4. Match the STYLE: same vocabulary level, same technical terms, same tone, same descriptive patterns
5. Match the LENGTH: similar word count and detail level

CONTENT RULES:
- NEVER COPY subjects, objects, characters, locations, or specific content from examples
- The CONTENT must come from THE SCENE TEXT you receive
- But the FORMAT and STRUCTURE must match the examples EXACTLY
- Extract from examples: lighting style descriptions, color palette terms, composition phrases, aesthetic mood words, sentence patterns, punctuation style
- Apply these format patterns to describe the scene content you receive

YOUR OUTPUT MUST:
- Start the same way the examples start (same type of opening phrase)
- Follow the same sentence structure and flow
- Use the same punctuation and formatting style
- Organize information in the same order (subject → style → composition → lighting → mood, or whatever pattern the examples use)
- Match the same level of detail and technical vocabulary\n\n`;
      }
    } else {
      // Default system prompt
      systemPrompt = `You are an expert at generating prompts for AI image creation (like Midjourney, Stable Diffusion, DALL-E).

CRITICAL FORMATTING REQUIREMENTS - FOLLOW EXACTLY:
1. You MUST follow the EXACT structure, format, and style of the examples provided below
2. Analyze the examples to identify: sentence structure, paragraph organization, punctuation style, technical terms used, descriptive patterns, opening phrases
3. Your output MUST match the examples' format character-by-character in terms of structure and organization
4. Use the same vocabulary level, technical terms, and descriptive approach as the examples
5. Respect the same approximate length (match the word count range of examples)
6. Include the same types of elements in the same order as the examples (main subject, visual style, composition, lighting, mood, etc.)
7. NEVER deviate from the format established by the examples - if examples use commas, use commas; if they use periods, use periods; if they use specific phrases, use similar phrase patterns
8. Generate prompts in ENGLISH only
9. NEVER use the word "dead" in the prompt (rephrase with other words instead)

CONTENT SAFETY - STRICTLY FORBIDDEN (to avoid AI image generator blocks):
- No nudity, partial nudity, or suggestive/intimate content
- No violence, gore, blood, weapons pointed at people, or graphic injuries
- No sexual or romantic physical contact (kissing, embracing intimately)
- No drug use or drug paraphernalia
- No hate symbols, extremist imagery, or discriminatory content
- No realistic depictions of real public figures or celebrities
- No content involving minors in any potentially inappropriate context
- Instead of violent scenes, describe tension, conflict, or drama through expressions, postures, and atmosphere
- Instead of intimate scenes, describe emotional connection through eye contact, gestures, or symbolic imagery

`;

      // Add examples if provided - emphasize EXACT FORMAT MATCHING
      if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
        systemPrompt += `FORMAT REFERENCE EXAMPLES - YOU MUST FOLLOW THESE EXACTLY:\n\n`;
        examplePrompts.forEach((example: string, i: number) => {
          systemPrompt += `Example ${i + 1} (COPY THIS EXACT FORMAT STRUCTURE):\n"${example}"\n\n`;
        });
        systemPrompt += `FORMAT ANALYSIS INSTRUCTIONS - STUDY THESE CAREFULLY:
1. Analyze the examples above - note the EXACT structure, punctuation, sentence flow, and organization
2. Identify the pattern: How do they start? What comes first (subject, style, composition)? How are elements connected?
3. Match the FORMAT exactly: same sentence structure, same punctuation style, same descriptive flow, same paragraph organization
4. Match the STYLE: same vocabulary level, same technical terms, same tone, same descriptive patterns
5. Match the LENGTH: similar word count and detail level

CONTENT RULES:
- NEVER COPY subjects, objects, characters, locations, or specific content from examples (no vegetables, no vehicles, no moon, etc. unless the scene mentions them)
- The CONTENT must come from THE SCENE TEXT you receive
- But the FORMAT and STRUCTURE must match the examples EXACTLY
- Extract from examples: lighting style descriptions, color palette terms, composition phrases, aesthetic mood words, sentence patterns, punctuation style, opening phrases
- Apply these format patterns to describe the scene content you receive

YOUR OUTPUT MUST:
- Start the same way the examples start (same type of opening phrase or structure)
- Follow the same sentence structure and flow as the examples
- Use the same punctuation and formatting style
- Organize information in the same order as the examples (subject → style → composition → lighting → mood, or whatever pattern the examples use)
- Match the same level of detail and technical vocabulary\n\n`;
      }

      systemPrompt += `Your role is to create ONE detailed visual prompt for a specific scene from a video/audio.

CRITICAL - CONTENT MUST MATCH THE SCENE:
1. READ the scene text carefully and identify the SPECIFIC subject, action, or concept being discussed
2. The image must DIRECTLY illustrate what is being said in this specific scene
3. Different scenes = DIFFERENT subjects, settings, and visual elements
4. DO NOT generate generic or repetitive imagery - each prompt must be UNIQUE to its scene content
5. If the scene talks about "100 people surviving", show that. If it talks about "genetic diversity", show that concept. If it talks about "psychology", show that context.

OUTPUT REQUIREMENTS:
1. Identify the MAIN TOPIC and KEY CONCEPTS from the scene text
2. Create a visual that SPECIFICALLY represents what is being discussed
3. Apply the EXACT FORMAT and STRUCTURE from the examples (sentence patterns, punctuation, organization, opening phrases)
4. Apply the visual style vocabulary from the examples (lighting terms, composition phrases, mood descriptors)
5. Vary the setting, characters, objects, and composition based on the scene content
6. Your output must be structurally identical to the examples - same flow, same organization, same style, same format

Return ONLY the prompt text, no JSON, no title, no explanations, just the optimized prompt in ENGLISH that matches the example format exactly.`;
    }

    // Build user message with few-shot examples
    let userMessage = "";
    
    // Add few-shot examples directly in the user message for better format matching
    if (examplePrompts && Array.isArray(examplePrompts) && examplePrompts.length > 0) {
      userMessage += `Here are examples of the EXACT format and style you must follow:\n\n`;
      examplePrompts.forEach((example: string, i: number) => {
        userMessage += `EXAMPLE ${i + 1} (This is the EXACT format you must copy):\n${example}\n\n`;
      });
      userMessage += `CRITICAL: Your output must match the EXACT format, structure, style, and tone of the examples above. Study them carefully:\n`;
      userMessage += `- Same sentence structure and flow\n`;
      userMessage += `- Same punctuation style\n`;
      userMessage += `- Same vocabulary level and technical terms\n`;
      userMessage += `- Same organization and paragraph structure\n`;
      userMessage += `- Same opening phrases and descriptive patterns\n\n`;
    }
    
    if (summary) {
      userMessage += `Global context: ${summary}\n\n`;
    }
    
    // Add previous prompts to avoid repetition
    if (previousPrompts && Array.isArray(previousPrompts) && previousPrompts.length > 0) {
      userMessage += `Previous prompts (avoid similar imagery, compositions, and visual elements):\n`;
      previousPrompts.slice(-3).forEach((prompt: string, i: number) => {
        userMessage += `- Scene ${sceneIndex - previousPrompts.length + i}: "${prompt.substring(0, 150)}..."\n`;
      });
      userMessage += `\nIMPORTANT: Create a VISUALLY DIFFERENT prompt - vary the composition, angle, lighting, and main visual elements to avoid repetitive imagery.\n\n`;
    }
    
    userMessage += `Now generate a prompt for this scene:\n`;
    userMessage += `Scene ${sceneIndex}/${totalScenes} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s):\n"${scene}"\n\n`;
    userMessage += `Generate a detailed visual prompt following the EXACT format and style of the examples above. The content must describe what is in this scene, but the format, structure, and style must match the examples exactly.`;

    console.log(`Generating prompt for scene ${sceneIndex}/${totalScenes}`);
    
    // DEBUG: Log what we're sending to Gemini
    console.log(`[DEBUG] Scene ${sceneIndex}: systemPrompt length: ${systemPrompt.length} chars`);
    console.log(`[DEBUG] Scene ${sceneIndex}: systemPrompt first 500 chars: "${systemPrompt.substring(0, 500)}..."`);
    console.log(`[DEBUG] Scene ${sceneIndex}: userMessage length: ${userMessage.length} chars`);
    console.log(`[DEBUG] Scene ${sceneIndex}: userMessage first 500 chars: "${userMessage.substring(0, 500)}..."`);

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
              parts: [{ text: userMessage }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            topK: 20,
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
        JSON.stringify({ error: `Erreur lors de la génération du prompt: ${response.status} - ${errorText.substring(0, 200)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log(`Prompt generated for scene ${sceneIndex}`);

    const generatedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    // DEBUG: Log what Gemini returned
    console.log(`[DEBUG] Scene ${sceneIndex}: Gemini response: "${generatedPrompt?.substring(0, 200)}..."`);
    if (!generatedPrompt) {
      console.log(`[DEBUG] Scene ${sceneIndex}: WARNING - Empty response from Gemini! Full response:`, JSON.stringify(data));
    }

    return new Response(
      JSON.stringify({ prompt: generatedPrompt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in generate-prompts function:", error);
    const errorMessage = error instanceof Error ? error.message : "Erreur interne du serveur";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
