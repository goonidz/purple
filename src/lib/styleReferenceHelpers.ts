/**
 * Helper functions for handling style reference URLs
 * Supports both legacy single URL (string) and new multiple URLs (JSON array)
 */

/**
 * Parse style_reference_url from database
 * Returns an array of URLs, handling both string and JSON array formats
 */
export const parseStyleReferenceUrls = (value: string | null | undefined): string[] => {
  if (!value) return [];
  
  // Try to parse as JSON array
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // If parsing fails, it's a legacy single URL string
    return [value];
  }
  
  // If parsed but not an array, treat as single URL
  return [value];
};

/**
 * Serialize style reference URLs for database storage
 * Always returns JSON stringified array or null
 */
export const serializeStyleReferenceUrls = (urls: string[]): string | null => {
  if (urls.length === 0) return null;
  return JSON.stringify(urls);
};
