import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { projectId } = await req.json();
    
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing projectId" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Repairing missing images for project ${projectId}`);

    // Get project prompts
    const { data: project, error: projectError } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompts = (project.prompts as any[]) || [];
    
    // Find prompts without images
    const missingIndices: number[] = [];
    prompts.forEach((prompt, index) => {
      if (!prompt?.imageUrl) {
        missingIndices.push(index);
      }
    });

    console.log(`Found ${missingIndices.length} prompts without images`);

    if (missingIndices.length === 0) {
      return new Response(JSON.stringify({ 
        repaired: 0, 
        message: "No missing images found" 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get completed predictions for these scene indices
    const { data: predictions, error: predError } = await adminClient
      .from('pending_predictions')
      .select('scene_index, result_url, created_at')
      .eq('project_id', projectId)
      .eq('prediction_type', 'scene_image')
      .eq('status', 'completed')
      .in('scene_index', missingIndices)
      .not('result_url', 'is', null)
      .order('created_at', { ascending: false });

    if (predError) {
      console.error("Error fetching predictions:", predError);
      return new Response(JSON.stringify({ error: "Error fetching predictions" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${predictions?.length || 0} completed predictions with images`);

    // Build a map of scene_index -> most recent result_url
    const imageMap = new Map<number, string>();
    for (const pred of (predictions || [])) {
      if (pred.scene_index !== null && pred.result_url && !imageMap.has(pred.scene_index)) {
        imageMap.set(pred.scene_index, pred.result_url);
      }
    }

    console.log(`Unique images to repair: ${imageMap.size}`);

    // Update prompts with the images
    let repairedCount = 0;
    const updatedPrompts = prompts.map((prompt, index) => {
      if (!prompt?.imageUrl && imageMap.has(index)) {
        repairedCount++;
        return { ...prompt, imageUrl: imageMap.get(index) };
      }
      return prompt;
    });

    // Save updated prompts
    const { error: updateError } = await adminClient
      .from('projects')
      .update({ prompts: updatedPrompts })
      .eq('id', projectId);

    if (updateError) {
      console.error("Error updating prompts:", updateError);
      return new Response(JSON.stringify({ error: "Error updating prompts" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Repaired ${repairedCount} images`);

    return new Response(JSON.stringify({ 
      repaired: repairedCount,
      stillMissing: missingIndices.length - repairedCount,
      message: `Repaired ${repairedCount} images` 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
