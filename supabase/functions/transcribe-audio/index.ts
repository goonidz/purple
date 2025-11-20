import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVEN_LABS_API_KEY = Deno.env.get("ELEVEN_LABS_API_KEY");
    if (!ELEVEN_LABS_API_KEY) {
      throw new Error("ELEVEN_LABS_API_KEY is not set");
    }

    const { audioUrl } = await req.json();
    
    if (!audioUrl) {
      throw new Error("audioUrl is required");
    }

    console.log("Fetching audio from:", audioUrl);

    // Download the audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
    }

    const audioBlob = await audioResponse.blob();
    console.log("Audio blob size:", audioBlob.size);

    // Prepare form data for Eleven Labs API
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.mp3");

    console.log("Sending to Eleven Labs API...");

    // Call Eleven Labs Speech to Text API
    const response = await fetch("https://api.elevenlabs.io/v1/audio-intelligence/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_LABS_API_KEY,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Eleven Labs API error:", errorText);
      throw new Error(`Eleven Labs API error: ${response.status} - ${errorText}`);
    }

    const transcriptionData = await response.json();
    console.log("Transcription successful");

    // Transform Eleven Labs response to match expected format
    const formattedTranscript = {
      segments: transcriptionData.segments?.map((seg: any) => ({
        text: seg.text,
        start_time: seg.start,
        end_time: seg.end,
      })) || [],
      language_code: transcriptionData.language || "en",
    };

    return new Response(JSON.stringify(formattedTranscript), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in transcribe-audio function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
