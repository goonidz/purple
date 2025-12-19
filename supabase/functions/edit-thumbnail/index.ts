import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Replicate from "https://esm.sh/replicate@0.25.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { imageUrl, prompt, projectId, thumbnailProjectId, standalone } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "L'URL de l'image est requise" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "L'instruction de modification est requise" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's Replicate API key
    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin.rpc(
      'get_user_api_key_for_service',
      { target_user_id: user.id, key_name: 'replicate' }
    );

    if (apiKeyError || !apiKeyData) {
      console.error("Error fetching Replicate API key:", apiKeyError);
      return new Response(
        JSON.stringify({ error: "Clé API Replicate non configurée. Ajoutez-la dans votre profil." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const replicate = new Replicate({ auth: apiKeyData });

    console.log("Editing thumbnail with Seedream...");
    console.log("Original image:", imageUrl);
    console.log("Edit prompt:", prompt);

    // Call Seedream 4.5 to edit the image (using image as style reference)
    const output = await replicate.run(
      "bytedance/seedream-4.5",
      {
        input: {
          prompt: prompt,
          size: "custom",
          width: 1920,
          height: 1080,
          image_input: [imageUrl]
        }
      }
    );

    if (!output) {
      throw new Error("No image generated from Seedream");
    }

    // Get the generated image URL
    const generatedImageUrl = Array.isArray(output) ? output[0] : output;
    console.log("Generated image URL:", generatedImageUrl);

    // Fetch the generated image
    const imageResponse = await fetch(generatedImageUrl);
    if (!imageResponse.ok) {
      throw new Error("Failed to fetch generated image");
    }

    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();

    // Upload to Supabase Storage
    const fileName = `thumbnails/${user.id}/${Date.now()}_edited.jpg`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('generated-images')
      .upload(fileName, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error("Failed to upload edited image");
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('generated-images')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;
    console.log("Uploaded to:", publicUrl);

    // Save to database
    const { error: dbError } = await supabaseAdmin
      .from('generated_thumbnails')
      .insert({
        project_id: standalone ? null : projectId,
        thumbnail_project_id: thumbnailProjectId || null,
        user_id: user.id,
        prompts: [prompt],
        thumbnail_urls: [publicUrl]
      });

    if (dbError) {
      console.error("Database error:", dbError);
      // Don't fail the request, the image was still generated
    }

    console.log("Thumbnail edited successfully");

    return new Response(
      JSON.stringify({ 
        success: true,
        url: publicUrl,
        prompt: prompt
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in edit-thumbnail function:", error);
    const errorMessage = error instanceof Error ? error.message : "Erreur interne du serveur";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
