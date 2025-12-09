import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Declare EdgeRuntime for Supabase Edge Functions
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Text length threshold for switching to async API (in characters)
// MiniMax t2a_v2 has a limit around 5000 chars, use async for longer texts
const ASYNC_TEXT_THRESHOLD = 4000;

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

    const { 
      script, 
      voice = 'English_expressive_narrator', 
      model = 'speech-2.6-hd', 
      speed = 1.0,
      pitch = 0,
      volume = 1.0,
      languageBoost = 'auto',
      englishNormalization = true,
      emotion = 'neutral',
      projectId,
      jobId // If provided, this is a job-based call
    } = await req.json();

    if (!script) {
      throw new Error("Script is required");
    }

    console.log("Generating audio with MiniMax, script length:", script.length, "model:", model, "voice:", voice, "jobId:", jobId);

    // Get user's MiniMax API key from Vault
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin.rpc(
      'get_user_api_key_for_service',
      { target_user_id: user.id, key_name: 'minimax' }
    );

    if (apiKeyError || !apiKeyData) {
      console.error("Error fetching MiniMax API key:", apiKeyError);
      
      // If this is a job-based call, update job status
      if (jobId) {
        await supabaseAdmin
          .from('generation_jobs')
          .update({ 
            status: 'failed',
            error_message: "MiniMax API key not configured. Please add it in your profile.",
            completed_at: new Date().toISOString()
          })
          .eq('id', jobId);
      }
      
      return new Response(
        JSON.stringify({ error: "MiniMax API key not configured. Please add it in your profile." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const voiceId = voice || "English_expressive_narrator";
    console.log("Calling MiniMax TTS with voice:", voice, "voiceId:", voiceId, "model:", model);

    // If jobId is provided, process in background and return immediately
    if (jobId) {
      console.log(`Job mode: Starting background processing for job ${jobId}`);
      
      // Start background processing
      EdgeRuntime.waitUntil(processAudioInBackground(
        supabaseAdmin,
        jobId,
        projectId,
        user.id,
        script,
        apiKeyData,
        model,
        voiceId,
        speed,
        volume,
        pitch,
        languageBoost,
        englishNormalization,
        emotion
      ));
      
      // Return immediately
      return new Response(
        JSON.stringify({ 
          status: 'processing',
          jobId,
          message: 'Audio generation started in background'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Synchronous mode (legacy) - for short texts without jobId
    let audioBytes: Uint8Array;
    let audioDuration: number;

    // Choose between sync and async API based on text length
    if (script.length > ASYNC_TEXT_THRESHOLD) {
      console.log("Using async API for long text (", script.length, "chars)");
      const result = await generateAudioAsync(apiKeyData, script, model, voiceId, speed, volume, pitch, languageBoost, englishNormalization, emotion);
      audioBytes = result.audioBytes;
      audioDuration = result.duration;
    } else {
      console.log("Using sync API for short text (", script.length, "chars)");
      const result = await generateAudioSync(apiKeyData, script, model, voiceId, speed, volume, pitch, languageBoost, englishNormalization, emotion);
      audioBytes = result.audioBytes;
      audioDuration = result.duration;
    }

    console.log("Audio generated, uploading to storage...");

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${user.id}/${projectId || 'temp'}/${timestamp}_minimax_generated.mp3`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('audio-files')
      .upload(filename, audioBytes, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('audio-files')
      .getPublicUrl(filename);

    console.log("Audio uploaded to:", publicUrl);

    return new Response(
      JSON.stringify({ 
        audioUrl: publicUrl,
        duration: audioDuration,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Audio generation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Background processing function for job-based audio generation
async function processAudioInBackground(
  adminClient: any,
  jobId: string,
  projectId: string,
  userId: string,
  script: string,
  apiKey: string,
  model: string,
  voiceId: string,
  speed: number,
  volume: number,
  pitch: number,
  languageBoost: string,
  englishNormalization: boolean,
  emotion: string
) {
  try {
    console.log(`Background processing started for job ${jobId}`);
    
    // Update job status to processing
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    let audioBytes: Uint8Array;
    let audioDuration: number;

    // Choose between sync and async API based on text length
    if (script.length > ASYNC_TEXT_THRESHOLD) {
      console.log("Background: Using async API for long text (", script.length, "chars)");
      const result = await generateAudioAsync(apiKey, script, model, voiceId, speed, volume, pitch, languageBoost, englishNormalization, emotion);
      audioBytes = result.audioBytes;
      audioDuration = result.duration;
    } else {
      console.log("Background: Using sync API for short text (", script.length, "chars)");
      const result = await generateAudioSync(apiKey, script, model, voiceId, speed, volume, pitch, languageBoost, englishNormalization, emotion);
      audioBytes = result.audioBytes;
      audioDuration = result.duration;
    }

    console.log("Background: Audio generated, uploading to storage...");

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${userId}/${projectId || 'temp'}/${timestamp}_minimax_generated.mp3`;

    // Upload to Supabase Storage
    const { error: uploadError } = await adminClient.storage
      .from('audio-files')
      .upload(filename, audioBytes, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = adminClient.storage
      .from('audio-files')
      .getPublicUrl(filename);

    console.log("Background: Audio uploaded to:", publicUrl);

    // Update project with audio URL
    if (projectId) {
      await adminClient
        .from('projects')
        .update({ 
          audio_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId);
    }

    // Update job as completed with audio info in metadata
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
        progress: 1,
        metadata: {
          audioUrl: publicUrl,
          duration: audioDuration
        },
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`Background: Job ${jobId} completed successfully`);

  } catch (error: any) {
    console.error(`Background: Job ${jobId} failed:`, error);
    
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}

// Synchronous API for shorter texts (< 4000 chars)
async function generateAudioSync(
  apiKey: string,
  text: string,
  model: string,
  voiceId: string,
  speed: number,
  volume: number,
  pitch: number,
  languageBoost: string,
  englishNormalization: boolean = true,
  emotion: string = 'neutral'
): Promise<{ audioBytes: Uint8Array; duration: number }> {
  const ttsResponse = await fetch(
    'https://api.minimax.io/v1/t2a_v2',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        text: text,
        stream: false,
        language_boost: languageBoost,
        output_format: "hex",
        voice_setting: {
          voice_id: voiceId,
          speed: speed,
          vol: volume,
          pitch: pitch,
          english_normalization: englishNormalization,
          emotion: emotion,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
    }
  );

  if (!ttsResponse.ok) {
    const errorText = await ttsResponse.text();
    console.error("MiniMax API error:", ttsResponse.status, errorText);
    throw new Error(`MiniMax API error: ${ttsResponse.status}`);
  }

  const result = await ttsResponse.json();
  
  if (result.base_resp?.status_code !== 0) {
    console.error("MiniMax API error:", result.base_resp);
    throw new Error(`MiniMax API error: ${result.base_resp?.status_msg || 'Unknown error'}`);
  }

  const hexAudio = result.data?.audio;
  if (!hexAudio) {
    throw new Error("No audio data in response");
  }

  const audioBytes = new Uint8Array(hexAudio.match(/.{1,2}/g).map((byte: string) => parseInt(byte, 16)));
  
  const duration = result.extra_info?.audio_length 
    ? Math.round(result.extra_info.audio_length / 1000) 
    : Math.round(text.split(/\s+/).length / 2.5);

  return { audioBytes, duration };
}

// Asynchronous API for longer texts (>= 4000 chars)
async function generateAudioAsync(
  apiKey: string,
  text: string,
  model: string,
  voiceId: string,
  speed: number,
  volume: number,
  pitch: number,
  languageBoost: string,
  englishNormalization: boolean = true,
  emotion: string = 'neutral'
): Promise<{ audioBytes: Uint8Array; duration: number }> {
  // Step 1: Create async task
  console.log("Creating async TTS task...");
  const createResponse = await fetch(
    'https://api.minimax.io/v1/t2a_async_v2',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        text: text,
        language_boost: languageBoost,
        voice_setting: {
          voice_id: voiceId,
          speed: speed,
          vol: volume,
          pitch: pitch,
          english_normalization: englishNormalization,
          emotion: emotion,
        },
        audio_setting: {
          audio_sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
    }
  );

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error("MiniMax async create error:", createResponse.status, errorText);
    throw new Error(`MiniMax async API error: ${createResponse.status}`);
  }

  const createResult = await createResponse.json();
  console.log("Async task create response:", JSON.stringify(createResult));

  if (createResult.base_resp?.status_code !== 0) {
    console.error("MiniMax async create error:", createResult.base_resp);
    throw new Error(`MiniMax async API error: ${createResult.base_resp?.status_msg || 'Unknown error'}`);
  }

  const taskId = createResult.task_id;
  if (!taskId) {
    throw new Error("No task_id in async response");
  }

  console.log("Async task created with ID:", taskId);

  // Step 2: Poll for task completion
  const maxAttempts = 120; // 10 minutes max (5 sec intervals)
  const pollInterval = 5000; // 5 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    console.log(`Polling task status (attempt ${attempt + 1}/${maxAttempts})...`);

    const statusResponse = await fetch(
      `https://api.minimax.io/v1/query/t2a_async_v2?task_id=${taskId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!statusResponse.ok) {
      console.error("Status poll error:", statusResponse.status);
      continue;
    }

    const statusResult = await statusResponse.json();
    console.log("Task status:", statusResult.status);

    if (statusResult.base_resp?.status_code !== 0) {
      console.error("Status poll API error:", statusResult.base_resp);
      throw new Error(`Status poll error: ${statusResult.base_resp?.status_msg || 'Unknown error'}`);
    }

    // Check task status
    // Status: 0 = preparing, 1 = running, 2 = success, 3 = failed
    if (statusResult.status === 2) {
      // Success - download audio
      const audioUrl = statusResult.file_url || statusResult.audio_file?.download_url;
      
      if (!audioUrl) {
        console.error("No audio URL in completed task:", JSON.stringify(statusResult));
        throw new Error("No audio URL in completed async task");
      }

      console.log("Downloading audio from:", audioUrl);

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Failed to download audio: ${audioResponse.status}`);
      }

      const audioBuffer = await audioResponse.arrayBuffer();
      const audioBytes = new Uint8Array(audioBuffer);

      // Estimate duration based on text length
      const duration = statusResult.extra_info?.audio_length 
        ? Math.round(statusResult.extra_info.audio_length / 1000) 
        : Math.round(text.split(/\s+/).length / 2.5);

      console.log("Async audio generation complete, duration:", duration);

      return { audioBytes, duration };
    } else if (statusResult.status === 3) {
      // Failed
      throw new Error(`Async task failed: ${statusResult.error_message || 'Unknown error'}`);
    }

    // Status 0 or 1 - still processing, continue polling
  }

  throw new Error("Async task timed out after 10 minutes");
}
