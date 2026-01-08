import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize project name - keep only letters, numbers, spaces, hyphens and underscores
 * Removes special characters like emojis, punctuation, etc.
 * @param name - The project name to sanitize
 * @returns Sanitized project name
 */
export function sanitizeProjectName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s\-_àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]/g, '')
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}
