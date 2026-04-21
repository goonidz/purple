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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { videoScript, videoTitle } = await req.json();

    if (!videoScript) {
      return new Response(
        JSON.stringify({ error: "videoScript is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating tags for video:", videoTitle);

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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a YouTube SEO expert specializing in keyword optimization. Generate exactly 20 highly optimized SEO tags for this video.

CRITICAL LANGUAGE RULE:
- First, detect the language of the video script provided
- Generate ALL tags in THE SAME LANGUAGE as the video script
- If the script is in English → tags MUST be in English
- If the script is in French → tags MUST be in French
- If the script is in Spanish → tags MUST be in Spanish
- etc.

CRITICAL: FOCUS ON MAIN TOPIC ONLY
- Analyze the video title and script to identify the MAIN OVERALL TOPIC
- Generate tags ONLY related to the main subject/theme of the video
- DO NOT include tags for specific sub-topics, examples, or details mentioned in the video
- Focus on the broad category and main subject matter
- Think about what category this video belongs to, not the specific examples discussed

EXAMPLE:
- If video is about "How to invest in ETFs" → Main topic: investing, finance, ETFs
- Tags should be: "investing", "finance", "ETF", "stocks", "money", "wealth", "portfolio", etc.
- DO NOT include tags for specific ETFs mentioned, specific strategies discussed, or examples given

SEO OPTIMIZATION STRATEGY:
1. Mix of keyword types for maximum reach:
   - Broad keywords related to the main topic (high search volume, competitive)
   - Long-tail keywords (2 words, more specific, less competitive)
   - Related terms and synonyms of the main topic
   - Topic category and general concepts
   - Trending terms if relevant to the main topic

2. Tag length and format:
   - Single words: Use for broad, high-volume keywords (e.g., "investing", "finance")
   - Two words: Use for long-tail keywords and specific phrases (e.g., "stock market", "passive income", "real estate")
   - Maximum 2 words per tag (no more)
   - No articles (a, an, the, le, la, les, etc.)
   - No punctuation or special characters

3. SEO best practices:
   - Include the main topic category and core keywords
   - Add related terms that viewers might search for about this topic
   - Include variations and synonyms of the main topic
   - Mix popular and niche terms related to the main subject
   - Focus on search intent for the main topic (what people actually search for)

GOOD EXAMPLES (for English video about investing):
- Single words: "investing", "ETF", "finance", "stocks", "money", "wealth"
- Two words: "stock market", "passive income", "index funds", "dividend stocks", "financial planning", "retirement savings"

BAD EXAMPLES (too long, too specific, or not SEO-optimized):
- "how to invest in ETF 2024" (too long, 5+ words)
- "best ETF for beginners to buy" (too long, 6+ words)
- "Vanguard S&P 500" (too specific, sub-topic)
- "a guide to" (contains article, not a keyword)

TAG GENERATION RULES:
1. Generate EXACTLY 20 tags
2. Each tag: 1-2 words maximum (2 words allowed for SEO optimization)
3. Focus ONLY on the main overall topic/category, NOT sub-topics or examples
4. Prioritize search volume and relevance to the main subject
5. Mix single-word and two-word tags strategically
6. Focus on what viewers actually search for on YouTube about this main topic

Respond ONLY with a JSON array of 20 strings, no explanation.
Example: ["tag1", "tag2", "two word tag", "tag4", ...]`;

    const userContent = `VIDEO TITLE: ${videoTitle || "Untitled"}

VIDEO SCRIPT (detect language and generate tags in this language):
${videoScript.substring(0, 4000)}

IMPORTANT: 
- Identify the MAIN OVERALL TOPIC of this video from the title and script
- Generate tags ONLY for the main subject/category, NOT for specific sub-topics, examples, or details mentioned
- Focus on the broad category this video belongs to
- Ignore specific examples, case studies, or detailed sub-topics discussed in the script`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GOOGLE_AI_API_KEY}`,
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
              parts: [{ text: userContent }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google AI API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`Google AI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("Raw AI response:", content);

    // Parse JSON response
    let tags: string[];
    try {
      // Clean potential markdown code blocks
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.replace(/```json\n?/, "").replace(/```$/, "");
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.replace(/```\n?/, "").replace(/```$/, "");
      }
      
      tags = JSON.parse(cleanContent.trim());
      
      if (!Array.isArray(tags)) {
        throw new Error("Response is not an array");
      }
      
      // Ensure we have strings and limit to 20
      tags = tags
        .filter(tag => typeof tag === 'string')
        .slice(0, 20);
        
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      throw new Error("Failed to parse tags from AI response");
    }

    console.log("Generated tags:", tags);

    return new Response(
      JSON.stringify({ tags }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in generate-tags:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to generate tags";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
