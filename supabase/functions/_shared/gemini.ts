// Centralized Gemini model configuration for Supabase Edge Functions.
// To rotate to a new model, change the default value below (and optionally
// override at runtime via the GEMINI_TEXT_MODEL / GEMINI_QA_VISION_MODEL
// Supabase secrets).

// Default fast text model — used for tags, titles, descriptions, summaries,
// prompts, axes, continuity analysis, and the "describe" branch of QA.
export const GEMINI_TEXT_MODEL =
  Deno.env.get('GEMINI_TEXT_MODEL') || 'gemini-3.1-flash-lite-preview';

// Premium vision model — used by the QA analysis branch of qa-image-gemini,
// where we need richer visual reasoning than the lite model can offer.
export const GEMINI_QA_VISION_MODEL =
  Deno.env.get('GEMINI_QA_VISION_MODEL') || 'gemini-3-flash-preview';

export function geminiEndpoint(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}
