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

    console.log("API key retrieved, length:", apiKeyData?.length, "starts with:", apiKeyData?.substring(0, 5), "ends with:", apiKeyData?.substring(apiKeyData?.length - 5));

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
    const { audioUrl, transcriptData } = await generateAndAssembleAudio(
      supabaseAdmin,
      userId,
      projectId,
      script,
      apiKeyData,
      voice
    );

    return new Response(
      JSON.stringify({ audioUrl, transcriptData }),
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

    const { audioUrl, transcriptData } = await generateAndAssembleAudio(
      adminClient,
      userId,
      projectId,
      script,
      apiKey,
      voiceId
    );

    // Update project with audio URL and transcript_json (if available)
    if (projectId) {
      const updateData: any = { 
        audio_url: audioUrl,
        updated_at: new Date().toISOString()
      };
      
      // Store transcript_json if timestamps were generated
      if (transcriptData) {
        updateData.transcript_json = transcriptData;
        console.log(`Storing transcript_json with ${transcriptData.segments.length} segments`);
      }
      
      await adminClient
        .from('projects')
        .update(updateData)
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

type InworldWordAlignment = {
  words: string[];
  wordStartTimeSeconds: number[];
  wordEndTimeSeconds: number[];
};

type WordTiming = { word: string; start: number; end: number };

function normalizeJoinedText(text: string): string {
  // Remove spaces before common punctuation (handles tokenization differences)
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .replace(/\s+/g, " ")
    .trim();
}

function alignmentToWordTimings(alignment: InworldWordAlignment, offsetSeconds: number): WordTiming[] {
  const len = Math.min(
    alignment.words?.length ?? 0,
    alignment.wordStartTimeSeconds?.length ?? 0,
    alignment.wordEndTimeSeconds?.length ?? 0
  );

  const out: WordTiming[] = [];
  for (let i = 0; i < len; i++) {
    const word = alignment.words[i];
    const start = alignment.wordStartTimeSeconds[i] + offsetSeconds;
    const end = alignment.wordEndTimeSeconds[i] + offsetSeconds;
    if (typeof word !== "string") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ word, start, end });
  }
  return out;
}

// Convert word timings to TranscriptData format (bucketed segments, ordered)
function wordTimingsToTranscriptData(
  wordTimings: WordTiming[],
  opts?: { maxSegmentSeconds?: number; maxWordsPerSegment?: number }
): { segments: Array<{ text: string; start_time: number; end_time: number }>; language_code?: string } {
  const maxSegmentSeconds = opts?.maxSegmentSeconds ?? 4;
  const maxWordsPerSegment = opts?.maxWordsPerSegment ?? 40;

  const sorted = [...wordTimings].sort((a, b) => a.start - b.start);
  const segments: Array<{ text: string; start_time: number; end_time: number }> = [];

  let segWords: string[] = [];
  let segStart = 0;
  let segEnd = 0;

  const flush = () => {
    if (segWords.length === 0) return;
    const text = normalizeJoinedText(segWords.join(" "));
    if (text) {
      segments.push({ text, start_time: segStart, end_time: segEnd });
    }
    segWords = [];
  };

  for (const wt of sorted) {
    if (segWords.length === 0) {
      segStart = wt.start;
      segEnd = wt.end;
    } else {
      segEnd = wt.end;
    }

    segWords.push(wt.word);

    const last = wt.word.trim();
    const endsSentence = /[.!?]$/.test(last);
    const tooLong = segEnd - segStart >= maxSegmentSeconds;
    const tooManyWords = segWords.length >= maxWordsPerSegment;

    if (endsSentence || tooLong || tooManyWords) {
      flush();
    }
  }

  flush();

  return {
    segments,
    language_code: "en", // Inworld timestamps are English-first; others are experimental
  };
}

// Main function to generate and assemble audio
async function generateAndAssembleAudio(
  adminClient: any,
  userId: string,
  projectId: string | null,
  script: string,
  apiKey: string,
  voiceId: string
): Promise<{ audioUrl: string; transcriptData?: any }> {
  // Split script into chunks
  const chunks = splitTextIntoChunks(script, MAX_CHUNK_SIZE);
  console.log(`Script length: ${script.length}, split into ${chunks.length} chunk(s)`);
  
  // Debug: log first 50 chars of each chunk to detect duplicates
  chunks.forEach((chunk, i) => {
    console.log(`Chunk ${i}: "${chunk.substring(0, 50)}..." (${chunk.length} chars)`);
  });

  if (chunks.length === 1) {
    // Single chunk - direct generation
    const { audioBytes, timestamps } = await generateInworldAudio(apiKey, chunks[0], voiceId);
    
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

    // Convert timestamps to TranscriptData if available
    let transcriptData = null;
    if (timestamps) {
      const wordTimings = alignmentToWordTimings(timestamps as InworldWordAlignment, 0);
      transcriptData = wordTimingsToTranscriptData(wordTimings);
      console.log(`Generated transcript with ${transcriptData.segments.length} segments (single chunk)`);
    }

    return { audioUrl: publicUrl, transcriptData };
  }

  // Multiple chunks - generate ALL in parallel for speed
  const timestamp = Date.now();
  console.log(`Generating ${chunks.length} chunks in parallel...`);

  const results = await Promise.all(
    chunks.map(async (chunk, index) => {
      console.log(`Starting chunk ${index + 1}/${chunks.length} (${chunk.length} chars)`);
      
      const { audioBytes, timestamps, duration } = await generateInworldAudio(apiKey, chunk, voiceId);
      
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

      console.log(`Chunk ${index + 1}/${chunks.length} completed, duration: ${duration || 'unknown'}s`);
      return { index, url: publicUrl, timestamps, duration: duration || 0 };
    })
  );

  // Sort by index to preserve order for concatenation
  const sortedResults = results.sort((a, b) => a.index - b.index);
  const chunkUrls = sortedResults.map(r => r.url);

  console.log(`All ${chunkUrls.length} chunks generated in parallel, concatenating on VPS...`);
  console.log(`URLs to concatenate:`, JSON.stringify(chunkUrls, null, 2));

  // Process timestamps with offsets for concatenation
  let transcriptData = null;
  const allWordTimings: WordTiming[] = [];
  let cumulativeOffset = 0;

  for (const result of sortedResults) {
    if (result.timestamps) {
      const timings = alignmentToWordTimings(result.timestamps as InworldWordAlignment, cumulativeOffset);
      allWordTimings.push(...timings);
      console.log(`Chunk ${result.index} timestamps merged (+${cumulativeOffset}s), words=${timings.length}`);
    }
    
    // Update cumulative offset for next chunk
    cumulativeOffset += result.duration;
  }

  // Convert all word timings to TranscriptData
  if (allWordTimings.length > 0) {
    transcriptData = wordTimingsToTranscriptData(allWordTimings);
    console.log(`Generated transcript with ${transcriptData.segments.length} segments from ${sortedResults.length} chunks`);
  }

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

  return { audioUrl: concatResult.audioUrl, transcriptData };
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
  let lastMatchEnd = 0; // Track end position manually (lastIndex resets to 0 after loop)
  
  while ((match = sentenceRegex.exec(text)) !== null) {
    sentences.push(match[0]);
    lastMatchEnd = sentenceRegex.lastIndex;
  }
  
  // Handle any remaining text without sentence-ending punctuation
  if (lastMatchEnd < text.length) {
    const remaining = text.slice(lastMatchEnd).trim();
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
): Promise<{ audioBytes: Uint8Array; timestamps?: any; duration?: number }> {
  console.log(`Calling Inworld TTS API for ${text.length} chars with voice: ${voiceId}`);
  console.log(`API key length: ${apiKey?.length}, starts with: ${apiKey?.substring(0, 10)}...`);

  // Inworld provides a pre-encoded Base64 key, use it directly
  const authHeader = `Basic ${apiKey}`;
  console.log(`Auth header: Basic ${apiKey?.substring(0, 10)}...`);

  const requestBody = {
    text: text,
    voiceId: voiceId,
    modelId: 'inworld-tts-1-max',
    timestampType: 'WORD' // Request word-level timestamps
  };
  console.log("Request body:", JSON.stringify(requestBody));

  const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Inworld API error:", response.status, errorText);
    console.error("Response headers:", JSON.stringify(Object.fromEntries(response.headers.entries())));
    throw new Error(`Inworld API error: ${response.status} - ${errorText}`);
  }

  // Response is JSON with audioContent as base64
  const jsonResponse = await response.json();
  console.log("Inworld response received, audioContent length:", jsonResponse.audioContent?.length);
  
  if (!jsonResponse.audioContent) {
    throw new Error("No audioContent in Inworld response");
  }

  // Decode base64 to binary
  const binaryString = atob(jsonResponse.audioContent);
  const audioBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    audioBytes[i] = binaryString.charCodeAt(i);
  }

  // Extract timestamps if available
  const timestamps = jsonResponse.timestampInfo?.wordAlignment || null;
  const duration = timestamps && timestamps.wordEndTimeSeconds?.length > 0
    ? timestamps.wordEndTimeSeconds[timestamps.wordEndTimeSeconds.length - 1]
    : null;

  if (timestamps) {
    console.log(`Timestamps received: ${timestamps.words?.length || 0} words`);
  } else {
    console.log("No timestamps in response");
  }
  
  return { audioBytes, timestamps, duration };
}
