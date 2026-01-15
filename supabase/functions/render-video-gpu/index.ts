import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Scene {
  startTime: number;
  endTime: number;
  imageUrl: string;
  text: string;
}

interface SubtitleSettings {
  enabled: boolean;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  opacity: number;
  textShadow: string;
  x: number;
  y: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    console.log('[GPU] Authorization header present:', !!authHeader);
    
    if (!authHeader) {
      console.error('[GPU] No authorization header found');
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract JWT token from Authorization header
    const token = authHeader.replace('Bearer ', '');

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    
    if (userError || !user) {
      console.error('[GPU] User authentication failed:', { userError: userError?.message, hasUser: !!user });
      return new Response(JSON.stringify({ 
        error: 'Unauthorized',
        details: userError?.message || 'User not found'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[GPU] User authenticated:', user.id);

    const requestBody = await req.json();
    console.log("[GPU] Request body keys:", Object.keys(requestBody));
    
    const { 
      projectId, 
      framerate = 25, 
      width = 1920,
      height = 1080,
      subtitleSettings,
      effectType = 'pan',
      renderMethod = 'standard'
    } = requestBody;

    if (!projectId) {
      throw new Error("Project ID is required");
    }

    console.log("[GPU] Starting GPU video rendering for project:", projectId);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch project data
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectError) throw projectError;

    const scenes = project.prompts as Scene[];
    const audioUrl = project.audio_url;

    if (!audioUrl) {
      throw new Error("Project has no audio file");
    }

    if (!scenes || scenes.length === 0) {
      throw new Error("Project has no scenes");
    }

    // Check if all scenes have images
    const missingImages = scenes.filter((s: Scene) => !s.imageUrl);
    if (missingImages.length > 0) {
      throw new Error(`${missingImages.length} scene(s) are missing images`);
    }

    // Use project dimensions from DB, fallback to request dimensions
    let projectWidth = project.image_width || width;
    let projectHeight = project.image_height || height;
    
    console.log(`[GPU] Processing ${scenes.length} scenes with framerate ${framerate}`);
    console.log(`[GPU] Dimensions: ${projectWidth}x${projectHeight}`);
    
    // Handle Z-Image dimensions
    const imageModel = project.image_model || '';
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    
    if (isZImage) {
      const ratio = projectWidth / projectHeight;
      const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
      
      if (is16x9 && projectWidth < 1920) {
        console.log(`[GPU] Z-Image 16:9 detected - using 1920x1088 for render`);
        projectWidth = 1920;
        projectHeight = 1088;
      }
    }

    // Prepare render data for RunPod
    const renderData = {
      scenes: scenes.map((scene, index) => ({
        index,
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration: scene.endTime - scene.startTime,
        imageUrl: scene.imageUrl,
        text: scene.text,
      })),
      audioUrl,
      subtitleSettings: subtitleSettings || {
        enabled: false,
        fontSize: 18,
        fontFamily: 'Arial',
        color: '#ffffff',
        backgroundColor: '#000000',
        opacity: 0.8,
        textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
        x: 50,
        y: 85
      },
      videoSettings: {
        width: projectWidth,
        height: projectHeight,
        framerate,
        format: 'mp4',
      },
      projectId,
      projectName: project.name || 'video',
      userId: user.id,
      effectType: effectType || 'pan',
      renderMethod: renderMethod || 'standard',
    };

    // Get RunPod credentials from environment
    const runpodApiKey = Deno.env.get('RUNPOD_API_KEY');
    const runpodEndpointId = Deno.env.get('RUNPOD_ENDPOINT_ID');
    
    if (!runpodApiKey || !runpodEndpointId) {
      console.error('[GPU] RunPod credentials not configured');
      throw new Error("RunPod credentials not configured. Please set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID environment variables.");
    }

    console.log(`[GPU] Calling RunPod endpoint: ${runpodEndpointId}`);

    // Create job in DB FIRST to get the ID
    console.log('[GPU] Creating GPU render job in database...');
    
    const insertData = {
      project_id: projectId,
      user_id: user.id,
      status: 'pending',
      progress: 0,
      job_id: null,  // Will be updated with RunPod job ID after submission
      status_url: null,
      steps: [],
      current_step: null,
      metadata: {
        framerate,
        width: projectWidth,
        height: projectHeight,
        scenesCount: scenes.length,
        renderType: 'gpu',
        runpodEndpoint: runpodEndpointId,
      },
    };
    
    const { data: dbJob, error: dbError } = await supabase
      .from('gpu_render_jobs')
      .insert(insertData)
      .select()
      .single();

    if (dbError) {
      console.error('[GPU] Error creating GPU render job:', dbError);
      throw new Error(`Failed to create DB job: ${dbError.message}`);
    }
    
    console.log('[GPU] GPU render job created in DB:', dbJob?.id);

    // Now call RunPod with the dbJobId so handler can update DB during render
    console.log('[GPU] Calling RunPod with dbJobId for real-time DB updates...');
    
    renderData.dbJobId = dbJob?.id;  // Add dbJobId to payload
    
    let runpodResponse;
    try {
      runpodResponse = await fetch(`https://api.runpod.ai/v2/${runpodEndpointId}/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runpodApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: renderData }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (fetchError: any) {
      console.error('[GPU] RunPod fetch error:', fetchError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to connect to RunPod: ${fetchError.message || fetchError}`,
          details: fetchError.name === 'AbortError' ? 'Request timeout' : fetchError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!runpodResponse.ok) {
      let errorText = 'Unknown error';
      try {
        errorText = await runpodResponse.text();
      } catch (e) {
        errorText = `HTTP ${runpodResponse.status}: ${runpodResponse.statusText}`;
      }
      
      console.error(`[GPU] RunPod error (${runpodResponse.status}):`, errorText);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `RunPod error: ${errorText}`,
          status: runpodResponse.status
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let runpodResult;
    try {
      runpodResult = await runpodResponse.json();
    } catch (parseError: any) {
      console.error('[GPU] Failed to parse RunPod response:', parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid response from RunPod',
          details: parseError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log('[GPU] RunPod response:', JSON.stringify(runpodResult, null, 2));

    // RunPod returns { id: "job-id", status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" }
    if (runpodResult.id) {
      const runpodJobId = runpodResult.id;
      const statusUrl = `https://api.runpod.ai/v2/${runpodEndpointId}/status/${runpodJobId}`;
      
      // Update DB job with RunPod job ID
      await supabase
        .from('gpu_render_jobs')
        .update({ job_id: runpodJobId, status_url: statusUrl })
        .eq('id', dbJob?.id);

      console.log('[GPU] RunPod job submitted:', runpodJobId);

      // Return with jobId - frontend will poll gpu_render_jobs table
      return new Response(
        JSON.stringify({
          success: true,
          jobId: dbJob?.id,  // Return DB job ID for frontend polling
          runpodJobId: runpodJobId,  // Keep RunPod job ID for reference
          status: 'pending',
          message: 'GPU render job started. Progress tracked in gpu_render_jobs table.',
          renderType: 'gpu',
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Unexpected response from RunPod",
        result: runpodResult
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("[GPU] Video rendering error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
