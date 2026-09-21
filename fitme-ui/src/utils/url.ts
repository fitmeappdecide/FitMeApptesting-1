/**
 * URL normalization utility for product links.
 *
 * Safely extracts clean HTTP/HTTPS URLs from clipboard, share sheets,
 * markdown-formatted strings, or plain text containing embedded links.
 *
 * Invariants:
 * - Valid URLs and all query parameters, paths, and fragments are 100% preserved.
 * - No URL re-encoding or stripping of retailer query params.
 * - Does not alter retailer-specific structures.
 */

export function normalizeProductUrl(input?: string | null): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  // 1. Markdown link format: [Label](https://...) or [https://...](https://...)
  // Extracts the target URL inside the parentheses
  const markdownMatch = trimmed.match(/\[.*?\]\((https?:\/\/[^\s\)]+)\)/i);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }

  // 2. Bracketed or angle-bracketed format: [https://...] or <https://...>
  const bracketMatch = trimmed.match(/[<\[](https?:\/\/[^\s>\]]+)[>\]]/i);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1].trim();
  }

  // 3. Clean standalone URL (starts with http:// or https:// and contains no whitespace)
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    let clean = trimmed;
    // Strip surrounding quotes or parentheses if present
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1).trim();
    }
    if (clean.startsWith('(') && clean.endsWith(')')) {
      clean = clean.slice(1, -1).trim();
    }
    return clean;
  }

  // 4. Embedded URL in plain text: "Check this product https://example.com/product/123"
  const urlMatch = trimmed.match(/https?:\/\/[^\s<>'"`]+/i);
  if (urlMatch && urlMatch[0]) {
    let extracted = urlMatch[0];
    // Remove trailing punctuation commonly attached at sentence boundaries (. , ; : ! ? ) ])
    extracted = extracted.replace(/[.,;:!?)\]]+$/, '');
    return extracted.trim();
  }

  // Fallback: return original trimmed string so existing downstream validation handles it cleanly
  return trimmed;
}
