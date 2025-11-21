import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { videoScript } = await req.json();
    
    if (!videoScript) {
      throw new Error("Le script vidéo est requis");
    }

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `Tu es un expert en création de descriptions YouTube. 

Ta mission est de générer 1 description de vidéo qui:
- Est rédigée dans la même langue que le script vidéo fourni
- Décrit factuellement et clairement le contenu de la vidéo
- Reste concise (150-250 caractères recommandés)
- Utilise un ton professionnel et informatif, pas sensationnel
- N'utilise AUCUN emoji
- Évite les superlatifs et l'exagération
- Capture l'essence du contenu de manière directe

IMPORTANT: La description doit être factuelle et informative, dans la langue du script.`;

    const userPrompt = `Génère 1 description YouTube factuelle pour cette vidéo. La description doit être dans la même langue que le script ci-dessous.

Script: ${videoScript}

Retourne uniquement la description sous format JSON strict:
{
  "description": "description factuelle"
}`;

    console.log('Calling Lovable AI Gateway for description generation...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte. Veuillez réessayer dans quelques instants." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits insuffisants. Veuillez recharger votre compte Lovable AI." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('Lovable AI Gateway error:', response.status, errorText);
      throw new Error(`Erreur API: ${response.status}`);
    }

    const data = await response.json();
    const aiContent = data.choices[0].message.content;
    
    console.log('AI Response:', aiContent);

    // Remove markdown code blocks if present
    let cleanedContent = aiContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Parse the JSON response
    const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Format de réponse invalide de l\'IA');
    }

    const parsedResponse = JSON.parse(jsonMatch[0]);
    const description = parsedResponse.description;

    if (!description || typeof description !== 'string') {
      throw new Error('Le format de la description est invalide');
    }

    return new Response(
      JSON.stringify({ description }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in generate-descriptions function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erreur lors de la génération des descriptions' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
