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
    console.log('Authorization header present:', !!authHeader);
    console.log('Authorization header length:', authHeader?.length || 0);
    
    if (!authHeader) {
      console.error('No authorization header found');
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract JWT token from Authorization header
    const token = authHeader.replace('Bearer ', '');
    console.log('Token extracted, length:', token.length);

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    console.log('Attempting to get user with token...');
    // Pass the JWT token directly to getUser() - this is the correct way in Edge Functions
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    
    if (userError) {
      console.error('User error:', userError.message);
    }
    
    if (userError || !user) {
      console.error('User authentication failed:', { userError: userError?.message, hasUser: !!user });
      return new Response(JSON.stringify({ 
        error: 'Unauthorized',
        details: userError?.message || 'User not found'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User authenticated:', user.id);

    const requestBody = await req.json();
    console.log("Request body keys:", Object.keys(requestBody));
    console.log("Request body effectType:", requestBody.effectType, "(type:", typeof requestBody.effectType, ")");
    
    const { 
      projectId, 
      framerate = 25, 
      width = 1920,
      height = 1080,
      subtitleSettings,
      effectType = 'zoom' // 'zoom' for Ken Burns, 'pan' for pan effects
    } = requestBody;

    if (!projectId) {
      throw new Error("Project ID is required");
    }

    console.log("Starting video rendering for project:", projectId);
    console.log("Effect type received:", effectType, "(type:", typeof effectType, ")");

    // Initialize Supabase client
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

    console.log(`Processing ${scenes.length} scenes with framerate ${framerate}`);

    // Prepare render data
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
        width,
        height,
        framerate,
        format: 'mp4',
      },
      projectId,
      userId: user.id,
      effectType: effectType || 'zoom', // Pass effect type to VPS service (ensure it's never undefined)
    };

    console.log("Sending render data to VPS with effectType:", effectType);
    console.log("renderData keys before sending:", Object.keys(renderData));
    console.log("renderData.effectType:", renderData.effectType);
    console.log("Full renderData:", JSON.stringify(renderData, null, 2).substring(0, 500));

    // Get FFmpeg service URL from environment variable
    const ffmpegServiceUrl = Deno.env.get('FFMPEG_SERVICE_URL');
    
    if (!ffmpegServiceUrl) {
      console.error('FFMPEG_SERVICE_URL not found in environment');
      throw new Error("FFMPEG_SERVICE_URL environment variable not configured. Please set up the video rendering service URL.");
    }

    console.log(`FFMPEG_SERVICE_URL: ${ffmpegServiceUrl}`);

    // Call external FFmpeg service (async - returns immediately with jobId)
    console.log(`Calling FFmpeg service at ${ffmpegServiceUrl}/render`);
    
    let renderResponse;
    try {
      const requestBody = JSON.stringify(renderData);
      console.log("Request body length:", requestBody.length);
      console.log("Request body contains effectType:", requestBody.includes('effectType'));
      
      renderResponse = await fetch(`${ffmpegServiceUrl}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('FFMPEG_SERVICE_API_KEY') || ''}`,
        },
        body: requestBody,
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
    } catch (fetchError: any) {
      console.error('Fetch error:', fetchError);
      console.error('Error details:', JSON.stringify(fetchError, null, 2));
      
      // Return error response with CORS headers
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to connect to FFmpeg service: ${fetchError.message || fetchError}`,
          details: fetchError.name === 'AbortError' ? 'Request timeout - service may be unavailable' : fetchError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!renderResponse.ok) {
      let errorText = 'Unknown error';
      try {
        errorText = await renderResponse.text();
      } catch (e) {
        errorText = `HTTP ${renderResponse.status}: ${renderResponse.statusText}`;
      }
      
      console.error(`FFmpeg service error (${renderResponse.status}):`, errorText);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `FFmpeg service error: ${errorText}`,
          status: renderResponse.status
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let renderResult;
    try {
      renderResult = await renderResponse.json();
    } catch (parseError: any) {
      console.error('Failed to parse FFmpeg service response:', parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid response from FFmpeg service',
          details: parseError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (renderResult.success && renderResult.jobId) {
      const statusUrl = `${ffmpegServiceUrl}/status/${renderResult.jobId}`;
      
      // Create job in database
      console.log('Attempting to create video render job in database...');
      console.log('Supabase URL:', supabaseUrl);
      console.log('Supabase Key present:', !!supabaseKey);
      console.log('Job data:', {
        project_id: projectId,
        user_id: user.id,
        status: renderResult.status || 'pending',
        progress: 0,
        job_id: renderResult.jobId,
        status_url: statusUrl,
      });
      
      const insertData = {
        project_id: projectId,
        user_id: user.id,
        status: renderResult.status || 'pending',
        progress: 0,
        job_id: renderResult.jobId,
        status_url: statusUrl,
        steps: [],
        current_step: null,
        metadata: {
          framerate,
          width,
          height,
          scenesCount: scenes.length,
        },
      };
      
      console.log('Inserting job with data:', JSON.stringify(insertData, null, 2));
      
      const { data: dbJob, error: dbError } = await supabase
        .from('video_render_jobs')
        .insert(insertData)
        .select()
        .single();
      
      console.log('Insert result - data:', dbJob);
      console.log('Insert result - error:', dbError);

      if (dbError) {
        console.error('❌ Error creating video render job:', dbError);
        console.error('Error code:', dbError.code);
        console.error('Error message:', dbError.message);
        console.error('Error details:', JSON.stringify(dbError, null, 2));
        // Continue anyway - job is started on VPS
      } else {
        console.log('✅ Video render job created successfully in database:', dbJob?.id);
        console.log('Job details:', JSON.stringify(dbJob, null, 2));
      }

      // Return immediately with jobId - client will poll for status
      return new Response(
        JSON.stringify({
          success: true,
          jobId: renderResult.jobId,
          dbJobId: dbJob?.id,
          status: renderResult.status || 'pending',
          message: 'Render job started. Use /status/:jobId to check progress.',
          statusUrl: statusUrl,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Unexpected response from FFmpeg service",
        result: renderResult
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("Video rendering error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
