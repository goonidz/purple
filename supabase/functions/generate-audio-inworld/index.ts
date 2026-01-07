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

// Inworld TTS has a limit of 2000 characters per request
const MAX_CHUNK_SIZE = 2000;

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

    const { 
      script, 
      voice = 'Dennis', 
      projectId,
      jobId,
      userId: passedUserId
    } = await req.json();

    let userId: string;
    
    // Check if this is an internal call with service role
    if (passedUserId && authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'NO_MATCH')) {
      userId = passedUserId;
      console.log("Internal service role call for user:", userId);
    } else {
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
      userId = user.id;
    }

    if (!script) {
      throw new Error("Script is required");
    }

    console.log("Generating audio with Inworld, script length:", script.length, "voice:", voice, "jobId:", jobId);

    // Get user's Inworld API key from Vault
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin.rpc(
      'get_user_api_key_for_service',
      { target_user_id: userId, key_name: 'inworld' }
    );

    if (apiKeyError || !apiKeyData) {
      console.error("Error fetching Inworld API key:", apiKeyError);
      
      if (jobId) {
        await supabaseAdmin
          .from('generation_jobs')
          .update({ 
            status: 'failed',
            error_message: "Inworld API key not configured. Please add it in your profile.",
            completed_at: new Date().toISOString()
          })
          .eq('id', jobId);
      }
      
      return new Response(
        JSON.stringify({ error: "Inworld API key not configured. Please add it in your profile." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If jobId is provided, process in background
    if (jobId) {
      console.log(`Job mode: Starting background processing for job ${jobId}`);
      
      EdgeRuntime.waitUntil(processAudioInBackground(
        supabaseAdmin,
        jobId,
        projectId,
        userId,
        script,
        apiKeyData,
        voice
      ));
      
      return new Response(
        JSON.stringify({ 
          status: 'processing',
          jobId,
          message: 'Audio generation started in background'
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Synchronous mode (not recommended for long scripts)
    const audioUrl = await generateAndAssembleAudio(
      supabaseAdmin,
      userId,
      projectId,
      script,
      apiKeyData,
      voice
    );

    return new Response(
      JSON.stringify({ audioUrl }),
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

// Background processing function
async function processAudioInBackground(
  adminClient: any,
  jobId: string,
  projectId: string,
  userId: string,
  script: string,
  apiKey: string,
  voiceId: string
) {
  try {
    console.log(`Background processing started for job ${jobId}`);
    
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    const audioUrl = await generateAndAssembleAudio(
      adminClient,
      userId,
      projectId,
      script,
      apiKey,
      voiceId
    );

    // Update project with audio URL
    if (projectId) {
      await adminClient
        .from('projects')
        .update({ 
          audio_url: audioUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', projectId);
    }

    // Update job as completed
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
        progress: 1,
        metadata: {
          audioUrl: audioUrl
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

// Main function to generate and assemble audio
async function generateAndAssembleAudio(
  adminClient: any,
  userId: string,
  projectId: string | null,
  script: string,
  apiKey: string,
  voiceId: string
): Promise<string> {
  // Split script into chunks
  const chunks = splitTextIntoChunks(script, MAX_CHUNK_SIZE);
  console.log(`Script split into ${chunks.length} chunk(s)`);

  if (chunks.length === 1) {
    // Single chunk - direct generation
    const audioBytes = await generateInworldAudio(apiKey, chunks[0], voiceId);
    
    const timestamp = Date.now();
    const filename = `${userId}/${projectId || 'temp'}/${timestamp}_inworld_generated.mp3`;
    
    const { error: uploadError } = await adminClient.storage
      .from('audio-files')
      .upload(filename, audioBytes, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = adminClient.storage
      .from('audio-files')
      .getPublicUrl(filename);

    return publicUrl;
  }

  // Multiple chunks - generate ALL in parallel for speed
  const timestamp = Date.now();
  console.log(`Generating ${chunks.length} chunks in parallel...`);

  const results = await Promise.all(
    chunks.map(async (chunk, index) => {
      console.log(`Starting chunk ${index + 1}/${chunks.length} (${chunk.length} chars)`);
      
      const audioBytes = await generateInworldAudio(apiKey, chunk, voiceId);
      
      const chunkFilename = `${userId}/${projectId || 'temp'}/${timestamp}_inworld_chunk_${index}.mp3`;
      
      const { error: uploadError } = await adminClient.storage
        .from('audio-files')
        .upload(chunkFilename, audioBytes, {
          contentType: 'audio/mpeg',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload chunk ${index}: ${uploadError.message}`);
      }

      const { data: { publicUrl } } = adminClient.storage
        .from('audio-files')
        .getPublicUrl(chunkFilename);

      console.log(`Chunk ${index + 1}/${chunks.length} completed`);
      return { index, url: publicUrl };
    })
  );

  // Sort by index to preserve order for concatenation
  const chunkUrls = results.sort((a, b) => a.index - b.index).map(r => r.url);

  console.log(`All ${chunkUrls.length} chunks generated in parallel, concatenating on VPS...`);

  // Call VPS to concatenate chunks
  const ffmpegServiceUrl = Deno.env.get('FFMPEG_SERVICE_URL');
  if (!ffmpegServiceUrl) {
    throw new Error("FFMPEG_SERVICE_URL not configured");
  }

  const concatResponse = await fetch(`${ffmpegServiceUrl}/concat-audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('FFMPEG_SERVICE_API_KEY') || ''}`,
    },
    body: JSON.stringify({
      audioUrls: chunkUrls,
      userId,
      projectId: projectId || 'temp'
    }),
  });

  if (!concatResponse.ok) {
    const errorText = await concatResponse.text();
    throw new Error(`Concatenation failed: ${errorText}`);
  }

  const concatResult = await concatResponse.json();
  
  if (!concatResult.audioUrl) {
    throw new Error("No audio URL in concatenation response");
  }

  console.log("Concatenation complete:", concatResult.audioUrl);

  // Clean up chunk files (optional - can be done async)
  for (const url of chunkUrls) {
    try {
      const path = url.split('/audio-files/')[1];
      if (path) {
        await adminClient.storage.from('audio-files').remove([path]);
      }
    } catch (e) {
      console.warn("Failed to clean up chunk:", e);
    }
  }

  return concatResult.audioUrl;
}

// Split text into chunks without cutting sentences
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  // If text is short enough, return as single chunk
  if (text.length <= maxLength) {
    return [text];
  }

  // Split by sentence-ending punctuation
  // This regex captures sentences including their ending punctuation
  const sentenceRegex = /[^.!?]*[.!?]+\s*/g;
  const sentences: string[] = [];
  let match;
  
  while ((match = sentenceRegex.exec(text)) !== null) {
    sentences.push(match[0]);
  }
  
  // Handle any remaining text without sentence-ending punctuation
  const lastIndex = sentenceRegex.lastIndex || 0;
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      sentences.push(remaining);
    }
  }

  // If no sentences found (text without punctuation), fall back to word splitting
  if (sentences.length === 0) {
    return splitByWords(text, maxLength);
  }

  // Group sentences into chunks
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    // If a single sentence is longer than maxLength, we need to split it
    if (sentence.length > maxLength) {
      // First, save current chunk if not empty
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      // Split the long sentence by words
      const sentenceChunks = splitByWords(sentence, maxLength);
      chunks.push(...sentenceChunks);
      continue;
    }

    // Check if adding this sentence would exceed the limit
    if ((currentChunk + sentence).length > maxLength) {
      // Save current chunk and start new one
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Fallback: split by words when sentence splitting isn't possible
function splitByWords(text: string, maxLength: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const word of words) {
    if ((currentChunk + " " + word).length > maxLength) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = word;
    } else {
      currentChunk = currentChunk ? currentChunk + " " + word : word;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Generate audio using Inworld TTS API
async function generateInworldAudio(
  apiKey: string,
  text: string,
  voiceId: string
): Promise<Uint8Array> {
  console.log(`Calling Inworld TTS API for ${text.length} chars with voice: ${voiceId}`);

  // Inworld provides a pre-encoded Base64 key, use it directly
  const authHeader = `Basic ${apiKey}`;

  const response = await fetch('https://api.inworld.ai/tts/v1/synthesize', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      voiceId: voiceId,
      modelId: 'inworld-tts-1'
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Inworld API error:", response.status, errorText);
    throw new Error(`Inworld API error: ${response.status} - ${errorText}`);
  }

  // Response is audio binary
  const audioBuffer = await response.arrayBuffer();
  return new Uint8Array(audioBuffer);
}
