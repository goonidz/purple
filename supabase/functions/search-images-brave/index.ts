import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BraveImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  width: number;
  height: number;
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Client for user auth
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

    const { sceneText, sceneIndex } = await req.json();

    if (!sceneText) {
      return new Response(
        JSON.stringify({ error: "Le texte de la scène est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's Brave API key from Vault using service role
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[search-images-brave] Fetching Brave API key for user: ${user.id}`);
    const { data: braveKeyData, error: braveKeyError } = await supabaseService
      .rpc('get_user_api_key_for_service', {
        target_user_id: user.id,
        key_name: 'brave'
      });

    if (braveKeyError) {
      console.error("Error getting Brave API key:", JSON.stringify(braveKeyError));
      return new Response(
        JSON.stringify({ error: `Erreur lors de la récupération de la clé: ${braveKeyError.message || 'Clé non trouvée'}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!braveKeyData || braveKeyData.trim() === '') {
      console.error("Brave API key is empty or null");
      return new Response(
        JSON.stringify({ error: "Clé API Brave non configurée. Ajoutez-la dans votre profil." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const BRAVE_API_KEY = braveKeyData;
    console.log(`[search-images-brave] Brave API key retrieved (length: ${BRAVE_API_KEY.length})`);
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");

    if (!GOOGLE_AI_API_KEY) {
      console.error("GOOGLE_AI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[search-images-brave] Scene ${sceneIndex}: Generating search query for text: "${sceneText.substring(0, 100)}..."`);

    // Step 1: Use Gemini to generate an optimized search query
    let searchQuery: string;
    try {
      searchQuery = await generateSearchQuery(sceneText, GOOGLE_AI_API_KEY);
      console.log(`[search-images-brave] Scene ${sceneIndex}: Generated search query: "${searchQuery}"`);
    } catch (error: any) {
      console.error(`[search-images-brave] Error generating search query:`, error);
      throw new Error(`Erreur lors de la génération de la requête: ${error.message || 'Erreur inconnue'}`);
    }

    // Step 2: Search images using Brave Search API
    let images: BraveImageResult[];
    try {
      images = await searchBraveImages(searchQuery, BRAVE_API_KEY);
      console.log(`[search-images-brave] Scene ${sceneIndex}: Found ${images.length} images`);
    } catch (error: any) {
      console.error(`[search-images-brave] Error searching images:`, error);
      throw new Error(`Erreur lors de la recherche d'images: ${error.message || 'Erreur inconnue'}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        query: searchQuery,
        images 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in search-images-brave:", error);
    console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue";
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Generate an optimized search query using Gemini
async function generateSearchQuery(sceneText: string, apiKey: string): Promise<string> {
  const prompt = `You are an expert at generating image search queries. Given a scene description from a video script, generate a SHORT and EFFECTIVE image search query (2-5 words in English) that will find relevant, high-quality stock images or photographs.

RULES:
1. Output ONLY the search query, nothing else
2. Use English keywords only
3. Be specific but concise (2-5 words maximum)
4. Focus on the main visual subject/concept
5. Avoid abstract concepts - prefer concrete, visual terms
6. Think about what image would best illustrate this scene

SCENE TEXT:
"${sceneText}"

SEARCH QUERY:`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 50,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Gemini API error:", errorData);
    throw new Error("Erreur lors de la génération de la requête de recherche");
  }

  const data = await response.json();
  const query = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  
  if (!query || query.length === 0) {
    console.error("Gemini returned empty query:", JSON.stringify(data));
    throw new Error("La génération de la requête de recherche a échoué");
  }
  
  // Clean up the query (remove quotes, extra punctuation)
  const cleanedQuery = query.replace(/['"]/g, '').trim();
  
  if (!cleanedQuery || cleanedQuery.length === 0) {
    throw new Error("La requête de recherche générée est vide");
  }
  
  return cleanedQuery;
}

// Search images using Brave Search API
async function searchBraveImages(query: string, apiKey: string): Promise<BraveImageResult[]> {
  const searchUrl = new URL('https://api.search.brave.com/res/v1/images/search');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('count', '20'); // Get more results for better filtering
  searchUrl.searchParams.set('safesearch', 'strict');
  searchUrl.searchParams.set('search_lang', 'en');

  const response = await fetch(searchUrl.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Brave Search API error:", response.status, errorText);
    if (response.status === 401 || response.status === 403) {
      throw new Error("Clé API Brave invalide ou expirée");
    }
    if (response.status === 429) {
      throw new Error("Limite de requêtes Brave Search atteinte. Réessayez plus tard.");
    }
    throw new Error("Erreur lors de la recherche d'images");
  }

  let data: any;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error("Failed to parse Brave API response:", parseError);
    throw new Error("Réponse invalide de l'API Brave Search");
  }
  
  const results = data.results || [];
  console.log(`[search-images-brave] Brave API returned ${results.length} raw results`);

  // Filter and transform results
  const filteredImages: BraveImageResult[] = results
    .filter((img: any) => {
      // Filter by size (minimum 800px width for quality)
      const width = img.properties?.width || img.width || 0;
      const height = img.properties?.height || img.height || 0;
      if (width < 800 || height < 400) return false;

      // Filter by format (only common image formats)
      const url = img.properties?.url || img.url || '';
      const validFormats = ['.jpg', '.jpeg', '.png', '.webp'];
      const hasValidFormat = validFormats.some(fmt => url.toLowerCase().includes(fmt));
      if (!hasValidFormat) return false;

      return true;
    })
    .slice(0, 8) // Return max 8 images
    .map((img: any) => ({
      url: img.properties?.url || img.url || '',
      thumbnail: img.thumbnail?.src || img.properties?.url || img.url || '',
      title: img.title || '',
      source: img.source || img.url?.split('/')[2] || '',
      width: img.properties?.width || img.width || 0,
      height: img.properties?.height || img.height || 0,
    }));

  return filteredImages;
}
