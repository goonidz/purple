import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GENAIPRO_BASE = "https://genaipro.vn/api/v1";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 min

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      script,
      voice = "uju3wxzG5OhpWcoi3SMy",
      model = "eleven_multilingual_v2",
      speed = 1.0,
      stability = 0.5,
      similarity = 0.75,
      style = 0.0,
      useSpeakerBoost = false,
      projectId,
      jobId,
      userId: passedUserId,
    } = await req.json();

    let userId: string;

    if (passedUserId && authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "NO_MATCH")) {
      userId = passedUserId;
      console.log("Internal service role call for user:", userId);
    } else {
      const supabaseAuth = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    if (!script) {
      throw new Error("Script is required");
    }

    console.log("GenAIPro TTS: script length:", script.length, "model:", model, "voice:", voice, "jobId:", jobId);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: apiKey, error: apiKeyError } = await supabaseAdmin.rpc(
      "get_user_api_key_for_service",
      { target_user_id: userId, key_name: "genaipro" }
    );

    if (apiKeyError || !apiKey) {
      console.error("Error fetching GenAIPro API key:", apiKeyError);
      if (jobId) {
        await supabaseAdmin
          .from("generation_jobs")
          .update({
            status: "failed",
            error_message: "GenAIPro API key not configured. Please add it in your profile.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
      return new Response(
        JSON.stringify({ error: "GenAIPro API key not configured. Please add it in your profile." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (jobId) {
      console.log(`Job mode: background processing for job ${jobId}`);
      EdgeRuntime.waitUntil(
        processInBackground(supabaseAdmin, jobId, projectId, userId, script, apiKey, model, voice, speed, stability, similarity, style, useSpeakerBoost)
      );
      return new Response(
        JSON.stringify({ status: "processing", jobId, message: "Audio generation started in background" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Synchronous mode (legacy)
    const result = await generateAudio(apiKey, script, model, voice, speed, stability, similarity, style, useSpeakerBoost);
    const publicUrl = await uploadToStorage(supabaseAdmin, userId, projectId, result.audioBytes);

    return new Response(
      JSON.stringify({ audioUrl: publicUrl, duration: result.duration }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("GenAIPro audio generation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processInBackground(
  adminClient: any,
  jobId: string,
  projectId: string,
  userId: string,
  script: string,
  apiKey: string,
  model: string,
  voice: string,
  speed: number,
  stability: number,
  similarity: number,
  style: number,
  useSpeakerBoost: boolean
) {
  try {
    console.log(`Background: started for job ${jobId}`);

    await adminClient
      .from("generation_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    const result = await generateAudio(apiKey, script, model, voice, speed, stability, similarity, style, useSpeakerBoost);
    const publicUrl = await uploadToStorage(adminClient, userId, projectId, result.audioBytes);

    console.log("Background: audio uploaded to:", publicUrl);

    if (projectId) {
      await adminClient
        .from("projects")
        .update({ audio_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", projectId);
    }

    await adminClient
      .from("generation_jobs")
      .update({
        status: "completed",
        progress: 1,
        metadata: { audioUrl: publicUrl, duration: result.duration },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    console.log(`Background: job ${jobId} completed`);
  } catch (error: any) {
    console.error(`Background: job ${jobId} failed:`, error);
    await adminClient
      .from("generation_jobs")
      .update({
        status: "failed",
        error_message: error.message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

async function generateAudio(
  apiKey: string,
  text: string,
  model: string,
  voice: string,
  speed: number,
  stability: number,
  similarity: number,
  style: number,
  useSpeakerBoost: boolean
): Promise<{ audioBytes: Uint8Array; duration: number }> {
  // Step 1: Create task
  console.log("GenAIPro: creating task...");
  const createRes = await fetch(`${GENAIPRO_BASE}/labs/task`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      voice_id: voice,
      model_id: model,
      speed,
      stability,
      similarity,
      style,
      use_speaker_boost: useSpeakerBoost,
    }),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    console.error("GenAIPro task create error:", createRes.status, errBody);
    throw new Error(`GenAIPro API error ${createRes.status}: ${errBody}`);
  }

  const { task_id } = await createRes.json();
  if (!task_id) {
    throw new Error("No task_id in GenAIPro response");
  }

  console.log("GenAIPro: task created:", task_id);

  // Step 2: Poll until completed
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    console.log(`GenAIPro: polling (${attempt + 1}/${MAX_POLL_ATTEMPTS})...`);

    const pollRes = await fetch(`${GENAIPRO_BASE}/labs/task/${task_id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      console.error("GenAIPro poll error:", pollRes.status);
      continue;
    }

    const taskData = await pollRes.json();
    console.log("GenAIPro: task status:", taskData.status);

    if (taskData.status === "completed") {
      const audioUrl = taskData.result;
      if (!audioUrl) {
        throw new Error("No result URL in completed GenAIPro task");
      }

      console.log("GenAIPro: downloading audio from:", audioUrl);
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new Error(`Failed to download audio: ${audioRes.status}`);
      }

      const audioBytes = new Uint8Array(await audioRes.arrayBuffer());
      const duration = Math.round(text.split(/\s+/).length / 2.5);

      console.log("GenAIPro: audio downloaded, estimated duration:", duration);
      return { audioBytes, duration };
    }

    if (taskData.status === "failed") {
      throw new Error(`GenAIPro task failed: ${taskData.error || "Unknown error"}`);
    }
  }

  throw new Error("GenAIPro task timed out after 10 minutes");
}

async function uploadToStorage(
  adminClient: any,
  userId: string,
  projectId: string | null,
  audioBytes: Uint8Array
): Promise<string> {
  const timestamp = Date.now();
  const filename = `${userId}/${projectId || "temp"}/${timestamp}_genaipro_generated.mp3`;

  const { error: uploadError } = await adminClient.storage
    .from("audio-files")
    .upload(filename, audioBytes, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload audio: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = adminClient.storage.from("audio-files").getPublicUrl(filename);

  return publicUrl;
}
