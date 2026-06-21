/**
 * Markdown utilities for AI pipelines.
 *
 * Cleans up converted Markdown to reduce token waste while preserving
 * structure needed for extraction (headings, tables, emails, URLs).
 */

const BASE64_DATA_URL_RE = /data:[^;]+;base64,[A-Za-z0-9+/=]+/g;
const REPEATED_BLANK_RE = /\n{3,}/g;

/**
 * Clean Markdown before sending to AI:
 * - Remove base64/data URLs (huge token waste from embedded images)
 * - Collapse repeated blank lines to max 2
 * - Trim trailing whitespace per line (preserve indentation)
 * - Cap to maxChars while preserving paragraph structure
 */
export function cleanMarkdownForAi(text: string, maxChars: number = 50000): string {
  // Remove base64 data URLs
  text = text.replace(BASE64_DATA_URL_RE, "[image: data-url removed]");

  // Collapse 3+ consecutive newlines to 2
  text = text.replace(REPEATED_BLANK_RE, "\n\n");

  // Trim trailing spaces per line, preserve leading indentation
  const lines = text.split("\n");
  const cleanedLines = lines.map((line) => line.rstrip());
  text = cleanedLines.join("\n");

  // Cap length, try to cut at paragraph boundary
  if (text.length > maxChars) {
    const cutoff = text.lastIndexOf("\n\n", maxChars);
    const endIndex = cutoff === -1 ? maxChars : cutoff;
    text = text.slice(0, endIndex) + "\n\n[...document truncated]";
  }

  return text.trim();
}

// Polyfill for String.rstrip (not native in JS)
declare global {
  interface String {
    rstrip(): string;
  }
}

// Simple rstrip implementation
String.prototype.rstrip = function (): string {
  return this.replace(/\s+$/, "");
};

/**
 * Rough token estimate: ~4 chars per token for English text.
 */
export function estimateTokens(charCount: number): number {
  return Math.max(1, Math.floor(charCount / 4));
}

/**
 * Build a preview of the first N characters of markdown.
 */
export function markdownPreview(text: string, maxLen: number = 2000): string {
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}
