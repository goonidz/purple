// Centralized Gemini model configuration for the video-render-service Node
// service. To rotate to a new model, change the default value below (and
// optionally override at runtime via the GEMINI_TEXT_MODEL env var).

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-flash-lite';

function geminiEndpoint(model, apiKey) {
  return apiKey
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

module.exports = {
  GEMINI_TEXT_MODEL,
  geminiEndpoint,
};
