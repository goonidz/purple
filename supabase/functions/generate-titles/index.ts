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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { videoScript } = await req.json();

    if (!videoScript) {
      return new Response(
        JSON.stringify({ error: "Le script vidéo est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a YouTube title optimization expert focused on maximizing CTR (click-through rate).

Your role is to use the 45 PROVEN TITLE STRUCTURES below to generate 5 OPTIMIZED titles based on the provided video script.

# 45 PROVEN YOUTUBE TITLE STRUCTURES:

## Curiosity and Contrast Structures:
1. This Is What ALWAYS Happens Before (Dramatic Event)
2. Weirdest (Entities) Ever Made…
3. (Objection). (Objection). Then (Action)... You Won't Believe It!
4. When "(Fake)" join the real (Entity)
5. (Action) Done in Front of the (Original Creator)
6. (Activity) by being (Unexpected or Opposite Activity)
7. (Person) Reacts to (Adjacent Person Doing Contrasted Activity)
8. [Person] Does [Unexpected Thing] (Tutorial [Activity])
9. (Person) tries (Strange Thing) for the first time
10. We Put a (Expensive Thing) in our (Cheap Thing)
11. What Happens When You (Absurd Action)?

## Authority and Revelation Structures:
12. What (Authority Figures) Understood About (Problem) That We Forgot
13. The TRUTH about (Activity) that the PROS know
14. What (Authority Figures) Understand That Most People Don't

## List and Completeness Structures:
15. I Tested Every FREE (Tools)
16. (Entity) Explained in 8 Minutes
17. 5 (Seasonal Entities) that (Authority Figures) (Action) Always
18. 9 Strange Habits You Pick Up in (Entity)
19. 7 Beginner (Entity) Mistakes to Avoid
20. 10 Free AI (Tools)
21. 24 HOURS WITH a [New Entity]
22. Our Daily Routine (As First [Profession])
23. 10 (Desirable Entities)
24. 11 of the Most Counterfeited (Items) In The World

## Negativity and Warning Structures:
25. Never Say These 4 Things at (Place)
26. Yes, Your (Asset) IS (Undesirable Result)! 8 Mistakes and how to fix them
27. Always (Action) Your (Asset) (never [Similar Action])
28. The ONE Sign (Something Scary is True)
29. Struggles of (Specific Situation)
30. If You're (Best Practice), You Need to Watch This
31. The Hunt for the King of the (Negative Entity)
32. The (Named Principle) If You Don't Change This, (Entity) Will Never Change
33. 5 Warning Signs (Something Needs to Improve)
34. What I Wish I Knew BEFORE (Action)

## Desire and Goal Structures:
35. The Only (Entity) They Ever Made That (Achieves Major Goal)
36. The ONLY (Object) with NO LIMITS
37. How (Simple Action) (Major Result)
38. 6 (Easy Things) that make EVERYTHING (Difficult Goal)!
39. Top 11 No (Difficult Thing) (Desirable Things) for (Specific Audience)
40. The Fastest Way to (Major Goal) (From Any Starting Point)
41. These SMALL SHIFTS cut 90% of the (Problems)

## Trending and Follow-up Structures:
42. This 1-Minute (Entity) Makes You (Desired State)
43. I Created an Anonymous (Entity) to "Prove its not Luck"
44. I Tried (Trend) for 3 Months. This Happened
45. (New Product) Leaks - 10 Reasons to Upgrade THIS year!
46. (Polarizing Entity) FINALLY has a Competitor

# CRITICAL INSTRUCTIONS:
- Analyze the video script language and generate titles in THE SAME LANGUAGE
- Use the structures above as frameworks, not literal translations
- Adapt the structures to fit the script content naturally
- Keep titles between 50-70 characters when possible
- Create strong curiosity gaps and emotional hooks
- Use power words and contrast to maximize CTR

You must return ONLY valid JSON in this exact format:
{
  "titles": [
    "Title 1 optimized...",
    "Title 2 with variation...",
    "Title 3 different...",
    "Title 4 unique...",
    "Title 5 creative..."
  ]
}`;
    const userMessage = `VIDEO SCRIPT:\n${videoScript}\n\nGenerate 5 optimized YouTube titles using the 45 proven title structures above. The titles MUST be in the SAME LANGUAGE as the video script. Adapt the structures to match the script content and maximize CTR.`;

    console.log("Generating titles with Gemini...");
    console.log("Using 45 proven title structures in script language");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes dépassée, veuillez réessayer plus tard" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédit insuffisant, veuillez ajouter des crédits à votre workspace" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Erreur lors de la génération des titres" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in AI response");
      return new Response(
        JSON.stringify({ error: "Réponse invalide de l'IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON response
    let titles;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        titles = parsed.titles;
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      console.log("Raw content:", content);
      return new Response(
        JSON.stringify({ error: "Erreur lors du parsing de la réponse" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(titles) || titles.length === 0) {
      console.error("Invalid titles array:", titles);
      return new Response(
        JSON.stringify({ error: "Format de réponse invalide" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully generated ${titles.length} titles`);

    return new Response(
      JSON.stringify({ titles }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in generate-titles function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erreur interne du serveur" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
