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

    const systemPrompt = `Tu es un expert en création de descriptions YouTube optimisées pour le référencement et l'engagement. 

Ta mission est de générer 3 descriptions de vidéo qui:
- Sonnent naturelles et authentiques (PAS comme de l'IA)
- Sont concises mais engageantes (150-250 caractères recommandés)
- Utilisent un langage conversationnel et humain
- Incluent des émotions et de la personnalité
- Évitent les formulations génériques ou robotiques
- Capturent l'essence du contenu de manière captivante
- Incluent un appel à l'action subtil si approprié

IMPORTANT: Les descriptions doivent sembler écrites par un vrai humain passionné, pas par une IA. Varie le ton et le style entre les 3 versions.`;

    const userPrompt = `Génère 3 descriptions YouTube réalistes et engageantes pour cette vidéo:

Script: ${videoScript}

Retourne uniquement les 3 descriptions sous format JSON strict:
{
  "descriptions": ["description 1", "description 2", "description 3"]
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

    // Parse the JSON response
    const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Format de réponse invalide de l\'IA');
    }

    const parsedResponse = JSON.parse(jsonMatch[0]);
    const descriptions = parsedResponse.descriptions;

    if (!Array.isArray(descriptions) || descriptions.length !== 3) {
      throw new Error('Le format des descriptions est invalide');
    }

    return new Response(
      JSON.stringify({ descriptions }),
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
