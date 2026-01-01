import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { imageUrl, projectId, sceneIndex } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "URL de l'image requise" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[download-web-image] Downloading image from: ${imageUrl}`);

    // Download image from web (server-side, no CORS issues)
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*',
      },
    });

    if (!imageResponse.ok) {
      console.error(`[download-web-image] Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
      throw new Error(`Impossible de télécharger l'image: ${imageResponse.status} ${imageResponse.statusText}`);
    }

    const imageBlob = await imageResponse.blob();
    const imageArrayBuffer = await imageBlob.arrayBuffer();
    const imageBytes = new Uint8Array(imageArrayBuffer);

    // Determine file extension from URL or Content-Type
    let fileExt = 'jpg';
    const urlExt = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase();
    if (urlExt && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(urlExt)) {
      fileExt = urlExt === 'jpeg' ? 'jpg' : urlExt;
    } else {
      const contentType = imageResponse.headers.get('content-type');
      if (contentType?.includes('png')) fileExt = 'png';
      else if (contentType?.includes('webp')) fileExt = 'webp';
      else if (contentType?.includes('gif')) fileExt = 'gif';
    }

    const filename = `${projectId || 'temp'}/scene_${sceneIndex + 1}_web_${Date.now()}.${fileExt}`;

    // Upload to Supabase Storage using service role
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    const { data: uploadData, error: uploadError } = await supabaseService.storage
      .from('generated-images')
      .upload(filename, imageBytes, {
        cacheControl: '3600',
        upsert: true,
        contentType: imageBlob.type || `image/${fileExt}`,
      });

    if (uploadError) {
      console.error(`[download-web-image] Upload error:`, uploadError);
      throw new Error(`Erreur lors de l'upload: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabaseService.storage
      .from('generated-images')
      .getPublicUrl(filename);

    console.log(`[download-web-image] Image uploaded successfully: ${publicUrl}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        imageUrl: publicUrl,
        filename
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in download-web-image:", error);
    const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
