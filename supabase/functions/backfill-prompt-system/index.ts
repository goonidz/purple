import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default system prompt (from generate-prompts/index.ts)
const DEFAULT_SYSTEM_PROMPT = `You are an expert at generating prompts for AI image creation (like Midjourney, Stable Diffusion, DALL-E).

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

Your role is to create ONE detailed visual prompt for a specific scene from a video/audio.

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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Client for user auth
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Service client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all projects for this user that have prompts but no prompt_system_message
    const { data: projects, error: fetchError } = await supabase
      .from('projects')
      .select('id, name, prompts, prompt_system_message')
      .eq('user_id', user.id)
      .not('prompts', 'is', null);

    if (fetchError) {
      throw new Error(`Failed to fetch projects: ${fetchError.message}`);
    }

    if (!projects || projects.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No projects found that need backfilling',
        updated: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter projects that need updating
    const projectsToUpdate = projects.filter((project: any) => {
      const prompts = project.prompts;
      const hasPrompts = prompts && Array.isArray(prompts) && prompts.length > 0;
      const hasNoSystemMessage = !project.prompt_system_message || project.prompt_system_message.trim() === '';
      return hasPrompts && hasNoSystemMessage;
    });

    if (projectsToUpdate.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'All projects already have prompt_system_message',
        updated: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update each project
    let updatedCount = 0;
    for (const project of projectsToUpdate) {
      const { error: updateError } = await supabase
        .from('projects')
        .update({ prompt_system_message: DEFAULT_SYSTEM_PROMPT })
        .eq('id', project.id)
        .eq('user_id', user.id);

      if (!updateError) {
        updatedCount++;
      } else {
        console.error(`Failed to update project ${project.id}:`, updateError);
      }
    }

    return new Response(JSON.stringify({ 
      message: `Backfill completed: ${updatedCount} projects updated`,
      updated: updatedCount,
      total: projectsToUpdate.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error("Error in backfill-prompt-system:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to backfill prompt system messages";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
