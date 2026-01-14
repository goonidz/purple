import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Scene {
  startTime: number;
  endTime: number;
  imageUrl: string;
  text: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication (client JWT)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          details: userError?.message || "User not found",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const requestBody = await req.json();
    const {
      projectId,
      framerate = 25,
      width = 1920,
      height = 1080,
      subtitleSettings,
      effectType = "pan",
      renderMethod = "standard",
    } = requestBody;

    if (!projectId) {
      throw new Error("Project ID is required");
    }

    // Service role client (DB reads + job insert)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectError) throw projectError;

    const scenes = project.prompts as Scene[];
    const audioUrl = project.audio_url;

    if (!audioUrl) throw new Error("Project has no audio file");
    if (!scenes || scenes.length === 0) throw new Error("Project has no scenes");

    const missingImages = scenes.filter((s: Scene) => !s.imageUrl);
    if (missingImages.length > 0) {
      throw new Error(`${missingImages.length} scene(s) are missing images`);
    }

    // Prefer project dimensions, fallback to request
    let projectWidth = project.image_width || width;
    let projectHeight = project.image_height || height;

    // Handle Z-Image 16:9 special casing (same as serverless function)
    const imageModel = project.image_model || "";
    const isZImage =
      imageModel === "z-image-turbo" || imageModel === "z-image-turbo-lora";
    if (isZImage) {
      const ratio = projectWidth / projectHeight;
      const is16x9 = Math.abs(ratio - 16 / 9) < 0.1;
      if (is16x9 && projectWidth < 1920) {
        projectWidth = 1920;
        projectHeight = 1088;
      }
    }

    const payload = {
      scenes: scenes.map((scene, index) => ({
        index,
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration: scene.endTime - scene.startTime,
        imageUrl: scene.imageUrl,
        text: scene.text,
      })),
      audioUrl,
      subtitleSettings: subtitleSettings || { enabled: false },
      videoSettings: {
        width: projectWidth,
        height: projectHeight,
        framerate,
        format: "mp4",
      },
      projectId,
      projectName: project.name || "video",
      userId: user.id,
      effectType,
      renderMethod,
    };

    const { data: job, error: jobError } = await supabase
      .from("gpu_render_jobs")
      .insert({
        project_id: projectId,
        user_id: user.id,
        status: "pending",
        progress: 0,
        payload,
      })
      .select("id,status")
      .single();

    if (jobError) throw jobError;

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        status: job.status,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[GPU-POD] Error:", error?.message || error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

