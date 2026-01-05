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

    const { currentSceneText, previousSceneText, previousPrompt } = await req.json();

    if (!currentSceneText || !previousSceneText) {
      return new Response(
        JSON.stringify({ error: "currentSceneText and previousSceneText are required" }),
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

    const systemPrompt = `You are an expert at analyzing narrative continuity between video scenes.

Your task is to determine if two consecutive scenes should maintain visual continuity (same location, setting, or ongoing event).

ANALYSIS CRITERIA:
1. Same location/setting: Are both scenes happening in the same place? (same room, same street, same building, etc.)
2. Same ongoing event: Are both scenes part of the same continuous event or sequence?
3. Same subject focus: Are both scenes discussing or showing the same main subject/concept?
4. Temporal continuity: Does scene 2 logically follow scene 1 in the same narrative moment?

OUTPUT FORMAT (JSON only):
{
  "hasContinuity": boolean,
  "confidence": number (0-1),
  "reasoning": "brief explanation",
  "elementsToKeep": ["element1", "element2", ...],
  "elementsToChange": ["change1", "change2", ...],
  "modifiedPromptSuffix": "description of what changes while keeping the same setting"
}

RULES:
- hasContinuity: true ONLY if scenes share the same location/setting OR are part of the same ongoing event
- confidence: 0.7+ for strong continuity, 0.5-0.7 for moderate, <0.5 for weak/no continuity
- elementsToKeep: Extract from previousPrompt the visual elements that should remain (location, setting, atmosphere, lighting style, color palette)
- elementsToChange: What specifically changes in the new scene (actions, characters, objects, details)
- modifiedPromptSuffix: A concise description (1-2 sentences) of what changes while maintaining the same visual setting

EXAMPLES:

Example 1 - Strong continuity:
Previous: "A dark forest at night, a cabin with warm light in the window"
Current: "The character enters the cabin"
→ hasContinuity: true, confidence: 0.9
→ elementsToKeep: ["dark forest", "night", "cabin", "warm light"]
→ elementsToChange: ["character enters"]
→ modifiedPromptSuffix: "same dark forest and cabin setting, but now a character is entering through the door"

Example 2 - No continuity:
Previous: "A busy city street during the day"
Current: "A scientist in a laboratory explaining genetics"
→ hasContinuity: false, confidence: 0.1
→ elementsToKeep: []
→ elementsToChange: ["completely different setting"]
→ modifiedPromptSuffix: ""

Return ONLY valid JSON, no other text.`;

    const userMessage = `PREVIOUS SCENE TEXT:
"${previousSceneText}"

PREVIOUS SCENE VISUAL PROMPT:
"${previousPrompt || 'N/A'}"

CURRENT SCENE TEXT:
"${currentSceneText}"

Analyze if these scenes should maintain visual continuity. Return JSON with your analysis.`;

    console.log(`[analyze-scene-continuity] Analyzing continuity between scenes`);

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
            temperature: 0.3,
            topP: 0.8,
            topK: 20,
            response_mime_type: "application/json"
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
        JSON.stringify({ error: `Erreur lors de l'analyse: ${response.status} - ${errorText.substring(0, 200)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!analysisText) {
      console.error("[analyze-scene-continuity] Empty response from Gemini");
      return new Response(
        JSON.stringify({ 
          hasContinuity: false, 
          confidence: 0,
          reasoning: "Failed to analyze",
          elementsToKeep: [],
          elementsToChange: [],
          modifiedPromptSuffix: ""
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const analysis = JSON.parse(analysisText);
      console.log(`[analyze-scene-continuity] Analysis result:`, analysis);
      
      return new Response(
        JSON.stringify(analysis),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("[analyze-scene-continuity] Failed to parse JSON:", parseError, "Raw response:", analysisText);
      // Fallback: try to extract JSON from markdown code blocks
      const jsonMatch = analysisText.match(/```json\s*([\s\S]*?)\s*```/) || analysisText.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const analysis = JSON.parse(jsonMatch[1]);
          return new Response(
            JSON.stringify(analysis),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e) {
          // Fall through to default response
        }
      }
      
      // Default: no continuity
      return new Response(
        JSON.stringify({ 
          hasContinuity: false, 
          confidence: 0,
          reasoning: "Failed to parse analysis",
          elementsToKeep: [],
          elementsToChange: [],
          modifiedPromptSuffix: ""
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("Error in analyze-scene-continuity function:", error);
    const errorMessage = error instanceof Error ? error.message : "Erreur interne du serveur";
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        hasContinuity: false,
        confidence: 0,
        reasoning: errorMessage,
        elementsToKeep: [],
        elementsToChange: [],
        modifiedPromptSuffix: ""
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
