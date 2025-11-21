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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { projectId, framerate = 25, subtitleSettings } = await req.json();

    if (!projectId) {
      throw new Error("Project ID is required");
    }

    console.log("Starting video generation for project:", projectId);

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

    // For now, return a message that video generation is being processed
    // In a production environment, this would trigger a background job
    // that generates the video using FFmpeg or a video processing service

    return new Response(
      JSON.stringify({
        message: "Video generation started",
        projectId,
        sceneCount: scenes.length,
        framerate,
        note: "Video generation requires FFmpeg integration. This would typically be handled by a separate video processing service or worker that combines images, audio, and subtitles into an MP4 file."
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 202, // Accepted
      }
    );

  } catch (error: any) {
    console.error("Video generation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
