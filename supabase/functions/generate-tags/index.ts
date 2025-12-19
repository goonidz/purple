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

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    const systemPrompt = `You are a YouTube SEO expert. Generate exactly 20 keyword tags for this video.

CRITICAL LANGUAGE RULE:
- First, detect the language of the video script provided
- Generate ALL tags in THE SAME LANGUAGE as the video script
- If the script is in English → tags MUST be in English
- If the script is in French → tags MUST be in French
- If the script is in Spanish → tags MUST be in Spanish
- etc.

TAG FORMAT RULES:
1. Generate EXACTLY 20 tags
2. Tags must be SHORT GENERAL KEYWORDS (1-2 words maximum)
3. NO complete search phrases or sentences
4. Focus on broad, popular terms related to the topic
5. Include the main subject and related popular terms

GOOD EXAMPLES (for English video):
- "investing", "ETF", "finance", "stock market", "money", "passive income"

BAD EXAMPLES (too specific/too long):
- "how to invest in ETF 2024", "best ETF for beginners to buy"

Respond ONLY with a JSON array of 20 strings, no explanation.
Example: ["tag1", "tag2", "tag3", ...]`;

    const userContent = `VIDEO TITLE: ${videoTitle || "Untitled"}

VIDEO SCRIPT (detect language and generate tags in this language):
${videoScript.substring(0, 4000)}`;

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
