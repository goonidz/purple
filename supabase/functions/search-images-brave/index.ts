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

    const { sceneText, sceneIndex, previousScenes = [], nextScenes = [], summary, projectName, customSearchPrompt, manualQuery } = await req.json();

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

    // Get user's Replicate API key from Vault for DeepSeek R1
    console.log(`[search-images-brave] Fetching Replicate API key for user: ${user.id}`);
    const { data: replicateKeyData, error: replicateKeyError } = await supabaseService
      .rpc('get_user_api_key_for_service', {
        target_user_id: user.id,
        key_name: 'replicate'
      });

    if (replicateKeyError || !replicateKeyData || replicateKeyData.trim() === '') {
      console.error("Error getting Replicate API key:", replicateKeyError);
      return new Response(
        JSON.stringify({ error: "Clé API Replicate non configurée. Ajoutez-la dans votre profil." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const REPLICATE_API_KEY = replicateKeyData;
    console.log(`[search-images-brave] Replicate API key retrieved (length: ${REPLICATE_API_KEY.length})`);

    // Step 1: Use manual query if provided, otherwise generate with DeepSeek R1
    let searchQuery: string;
    if (manualQuery && manualQuery.trim()) {
      // User provided a manual query, use it directly
      searchQuery = manualQuery.trim();
      console.log(`[search-images-brave] Scene ${sceneIndex}: Using manual query: "${searchQuery}"`);
    } else {
      // Generate query with DeepSeek R1 via Replicate
      console.log(`[search-images-brave] Scene ${sceneIndex}: Generating search query with DeepSeek R1 for text: "${sceneText.substring(0, 100)}..."`);
      try {
        searchQuery = await generateSearchQueryWithDeepSeek(sceneText, previousScenes, nextScenes, summary, projectName, customSearchPrompt, REPLICATE_API_KEY);
        console.log(`[search-images-brave] Scene ${sceneIndex}: Generated search query: "${searchQuery}"`);
      } catch (error: any) {
        console.error(`[search-images-brave] Error generating search query:`, error);
        throw new Error(`Erreur lors de la génération de la requête: ${error.message || 'Erreur inconnue'}`);
      }
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

    // Step 3: If no images found, generate alternative queries with DeepSeek R1
    let alternativeQueries: string[] = [];
    if (images.length === 0) {
      console.log(`[search-images-brave] No images found, generating alternative queries with DeepSeek R1...`);
      try {
        alternativeQueries = await generateAlternativeQueriesWithDeepSeek(
          sceneText, 
          searchQuery, 
          previousScenes, 
          nextScenes, 
          summary, 
          projectName, 
          REPLICATE_API_KEY
        );
        console.log(`[search-images-brave] Generated ${alternativeQueries.length} alternative queries`);
      } catch (error: any) {
        console.error(`[search-images-brave] Error generating alternatives:`, error);
        // Don't fail, just continue without alternatives
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        query: searchQuery,
        images,
        alternativeQueries: alternativeQueries.length > 0 ? alternativeQueries : undefined
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

// Generate an optimized search query using DeepSeek R1 via Replicate
async function generateSearchQueryWithDeepSeek(
  sceneText: string, 
  previousScenes: string[], 
  nextScenes: string[], 
  summary: string | null, 
  projectName: string | null,
  customSearchPrompt: string | null | undefined,
  replicateApiKey: string
): Promise<string> {
  let contextSection = '';
  if (summary) {
    contextSection = `\n\nGLOBAL CONTEXT (video topic/theme):\n"${summary}"`;
  }
  if (projectName) {
    contextSection += `\n\nVIDEO TITLE: "${projectName}"`;
  }

  let temporalContext = '';
  if (previousScenes.length > 0) {
    temporalContext = `\n\nPREVIOUS SCENES (what happened before, for context):\n${previousScenes.map((s, i) => `${i + 1}. "${s}"`).join('\n')}`;
  }
  if (nextScenes.length > 0) {
    temporalContext += `\n\nNEXT SCENES (what happens after, for context):\n${nextScenes.map((s, i) => `${i + 1}. "${s}"`).join('\n')}`;
  }

  // Use custom prompt if provided, otherwise use default
  let prompt: string;
  if (customSearchPrompt && customSearchPrompt.trim()) {
    prompt = `${customSearchPrompt}

CURRENT SCENE TEXT:
"${sceneText}"${temporalContext}${contextSection}

Think carefully about the best way to illustrate this scene, then output ONLY the search query (2-6 words, English).`;
  } else {
    prompt = `You are an expert at generating image search queries for video production. Analyze this scene and decide the BEST way to illustrate it visually.

CURRENT SCENE TEXT:
"${sceneText}"${temporalContext}${contextSection}

YOUR TASK:
1. Understand what is happening in this scene (the event, mood, visual elements)
2. Consider the global context (video topic/theme) and temporal context (what happened before/after)
3. Decide: What image would BEST illustrate this scene? Think creatively - literal, symbolic, atmospheric?
4. Generate a search query that will find the perfect image

CRITICAL: Output ONLY the search query. 2-6 words, English only. No explanation, just the query.`;
  }

  console.log(`[DeepSeek R1] Starting prediction...`);
  
  // Start prediction with DeepSeek R1 via Replicate
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${replicateApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-ai/deepseek-r1',
      input: {
        prompt: prompt,
        max_tokens: 50,
        temperature: 0.5,
      },
    }),
  });

  if (!createResponse.ok) {
    const errorData = await createResponse.json();
    console.error("DeepSeek R1 API error:", errorData);
    throw new Error("Erreur lors de la création de la prédiction DeepSeek R1");
  }

  const prediction = await createResponse.json();
  console.log(`[DeepSeek R1] Prediction created: ${prediction.id}`);

  // Poll for result (max 60 seconds)
  let result = prediction;
  const maxAttempts = 30;
  let attempts = 0;

  while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: {
        'Authorization': `Bearer ${replicateApiKey}`,
      },
    });
    
    if (!pollResponse.ok) {
      throw new Error("Erreur lors de la vérification de la prédiction");
    }
    
    result = await pollResponse.json();
    attempts++;
    console.log(`[DeepSeek R1] Status: ${result.status} (attempt ${attempts})`);
  }

  if (result.status === 'failed') {
    console.error("DeepSeek R1 prediction failed:", result.error);
    throw new Error("La prédiction DeepSeek R1 a échoué");
  }

  if (result.status !== 'succeeded') {
    throw new Error("Timeout: la prédiction DeepSeek R1 a pris trop de temps");
  }

  // Extract the query from the output
  let output = '';
  if (Array.isArray(result.output)) {
    output = result.output.join('');
  } else if (typeof result.output === 'string') {
    output = result.output;
  }

  console.log(`[DeepSeek R1] Raw output: "${output}"`);

  // Clean up: extract just the search query
  // DeepSeek R1 might include thinking tags like <think>...</think>
  let cleanedOutput = output
    .replace(/<think>[\s\S]*?<\/think>/g, '') // Remove thinking tags
    .replace(/\n+/g, ' ')
    .trim();

  // If the output contains multiple lines, take the last non-empty one (likely the query)
  const lines = cleanedOutput.split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    cleanedOutput = lines[lines.length - 1].trim();
  }

  // Remove quotes and extra punctuation
  cleanedOutput = cleanedOutput.replace(/['"]/g, '').trim();
  
  // If still too long, take first 6 words
  const words = cleanedOutput.split(/\s+/);
  if (words.length > 6) {
    cleanedOutput = words.slice(0, 6).join(' ');
  }

  if (!cleanedOutput || cleanedOutput.length === 0) {
    throw new Error("La requête de recherche générée est vide");
  }

  console.log(`[DeepSeek R1] Final query: "${cleanedOutput}"`);
  return cleanedOutput;
}

// Generate alternative search queries when no images are found using DeepSeek R1
async function generateAlternativeQueriesWithDeepSeek(
  sceneText: string,
  originalQuery: string,
  previousScenes: string[],
  nextScenes: string[],
  summary: string | null,
  projectName: string | null,
  replicateApiKey: string
): Promise<string[]> {
  let contextSection = '';
  if (summary) {
    contextSection = `\n\nGLOBAL CONTEXT: "${summary}"`;
  }
  if (projectName) {
    contextSection += `\n\nVIDEO TITLE: "${projectName}"`;
  }

  let temporalContext = '';
  if (previousScenes.length > 0) {
    temporalContext = `\n\nPREVIOUS SCENES:\n${previousScenes.map((s, i) => `${i + 1}. "${s}"`).join('\n')}`;
  }
  if (nextScenes.length > 0) {
    temporalContext += `\n\nNEXT SCENES:\n${nextScenes.map((s, i) => `${i + 1}. "${s}"`).join('\n')}`;
  }

  const prompt = `The search query "${originalQuery}" found NO images. Generate 3 ALTERNATIVE search queries.

SCENE TEXT: "${sceneText}"${temporalContext}${contextSection}

Generate 3 different queries that might find better results:
1. A more general/broader query
2. A query with different keywords/synonyms  
3. A query focusing on different visual aspects

Output ONLY the 3 queries, one per line, 2-6 words each, English only:`;

  console.log(`[DeepSeek R1] Generating alternative queries...`);
  
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${replicateApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-ai/deepseek-r1',
      input: {
        prompt: prompt,
        max_tokens: 100,
        temperature: 0.7,
      },
    }),
  });

  if (!createResponse.ok) {
    console.error("DeepSeek R1 API error for alternatives:", await createResponse.json());
    return [];
  }

  const prediction = await createResponse.json();
  
  // Poll for result
  let result = prediction;
  const maxAttempts = 30;
  let attempts = 0;

  while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { 'Authorization': `Bearer ${replicateApiKey}` },
    });
    
    if (!pollResponse.ok) return [];
    
    result = await pollResponse.json();
    attempts++;
  }

  if (result.status !== 'succeeded') {
    return [];
  }

  let output = '';
  if (Array.isArray(result.output)) {
    output = result.output.join('');
  } else if (typeof result.output === 'string') {
    output = result.output;
  }

  // Clean up and extract queries
  output = output.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  const lines = output.split('\n').filter(line => line.trim());
  const queries: string[] = [];
  
  for (const line of lines) {
    const cleaned = line.replace(/^\d+\.\s*/, '').replace(/['"]/g, '').trim();
    if (cleaned && cleaned.length > 0 && cleaned.length < 50) {
      queries.push(cleaned);
    }
  }

  console.log(`[DeepSeek R1] Alternative queries: ${JSON.stringify(queries)}`);
  return queries.slice(0, 3);
}

// Search images using Brave Search API
async function searchBraveImages(query: string, apiKey: string): Promise<BraveImageResult[]> {
  const searchUrl = new URL('https://api.search.brave.com/res/v1/images/search');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('count', '30'); // Get 30 results - no filtering, user chooses
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

  // Transform all results - no filtering, let user choose
  const images: BraveImageResult[] = results
    .map((img: any) => ({
      url: img.properties?.url || img.url || '',
      thumbnail: img.thumbnail?.src || img.properties?.url || img.url || '',
      title: img.title || '',
      source: img.source || img.url?.split('/')[2] || '',
      width: img.properties?.width || img.width || 0,
      height: img.properties?.height || img.height || 0,
    }));

  return images;
}
