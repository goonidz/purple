import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Replicate from "https://esm.sh/replicate@0.25.2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY')
    if (!REPLICATE_API_KEY) {
      console.error('REPLICATE_API_KEY is not set')
      throw new Error('REPLICATE_API_KEY is not configured')
    }

    const replicate = new Replicate({
      auth: REPLICATE_API_KEY,
    })

    const body = await req.json()

    // If it's a status check request
    if (body.predictionId) {
      console.log("Checking status for prediction:", body.predictionId)
      const prediction = await replicate.predictions.get(body.predictionId)
      console.log("Status check response:", prediction.status)
      return new Response(JSON.stringify(prediction), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If it's a generation request
    if (!body.prompt) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required field: prompt is required" 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    console.log("Generating image with SeedDream 4, prompt:", body.prompt)
    
    const input: any = {
      prompt: body.prompt,
      size: "custom",
      width: body.width || 2048,
      height: body.height || 2048,
    }

    // Add image reference if provided
    if (body.image_urls && body.image_urls.length > 0) {
      input.image_input = body.image_urls
    }

    // Add optional parameters if provided
    if (body.seed) input.seed = body.seed
    if (body.guidance_scale) input.guidance_scale = body.guidance_scale
    if (body.num_inference_steps) input.num_inference_steps = body.num_inference_steps

    console.log("SeedDream 4 input parameters:", input)

    const output = await replicate.run(
      "bytedance/seedream-4",
      { input }
    )

    console.log("SeedDream 4 generation complete")
    return new Response(JSON.stringify({ output }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error("Error in generate-image-seedream function:", error)
    return new Response(JSON.stringify({ 
      error: error.message || 'An unexpected error occurred' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
