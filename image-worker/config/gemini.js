// Centralized Gemini model configuration for the image-worker Node service.
// To rotate to a new model, change the default value below (and optionally
// override at runtime via GEMINI_TEXT_MODEL / GEMINI_QA_VISION_MODEL env vars).

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-flash-lite-preview';

const GEMINI_QA_VISION_MODEL =
  process.env.GEMINI_QA_VISION_MODEL || 'gemini-3-flash-preview';

function geminiEndpoint(model, apiKey) {
  return apiKey
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

module.exports = {
  GEMINI_TEXT_MODEL,
  GEMINI_QA_VISION_MODEL,
  geminiEndpoint,
};
