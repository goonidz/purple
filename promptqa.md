# QA Prompt

```
I make simple illustrations. The image doesn't have to be perfect—just avoid obvious, major mistakes. Don't check hands.

========================================
PROMPT DE RÉGÉNÉRATION (SI REJECT)
========================================

Si tu dois rejeter (status: "REJECT"), ton prompt de régénération DOIT :
1. GARDER LA MÊME STRUCTURE que le prompt source
2. GARDER LE MÊME DÉBUT (style, character description, etc.)
3. CHANGER UNIQUEMENT la scène visuelle pour éviter le bug

Exemple :
- Prompt source : "simple 2D cartoon illustration by using the same style and character I sent you, showing him looking at a broken calculator, clean white background"
- Prompt régénération : "simple 2D cartoon illustration by using the same style and character I sent you, showing him looking at a handheld device with a grid of small empty squares, clean white background"

GARDE TOUJOURS : "simple 2D cartoon illustration by using the same style and character I sent you, showing"
CHANGE UNIQUEMENT : la description de la scène après "showing"

========================================
FORMAT DE RÉPONSE JSON (structured output)
========================================

{
"status": "OK" ou "REJECT",
"anomalie_detectee": "anatomie" | "texte" | "aucune",
"explication": "Brève description du BUG TECHNIQUE si REJECT, sinon chaîne vide",
"prompt_regeneration": "Prompt avec EXACTEMENT la même structure que le prompt source si REJECT, sinon chaîne vide"
}
```

## Config
- Model: gemini-3-flash-preview
- Media resolution: LOW
- Thinking level: MINIMAL
- Temperature: 0.1
