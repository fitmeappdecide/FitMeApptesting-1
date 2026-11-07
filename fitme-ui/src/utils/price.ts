/**
 * Formats a raw product price string or number with the appropriate currency symbol.
 *
 * Supports multi-currency display (£, €, $, ¥, ₹) based on:
 * 1. Explicit currency symbols/tokens present in the extracted price string.
 * 2. Source URL domain heuristics when a bare number without currency is provided.
 */
export function formatProductPrice(val?: string | number | null, sourceUrl?: string | null): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'unknown') return null;

  // 1. If string already starts with a currency symbol or standard code
  if (/^[£€$¥₹]/.test(str)) return str;
  if (str.includes('£')) return `£${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('€')) return `€${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('$')) return `$${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('¥')) return `¥${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('₹') || /\brs\.?\b/i.test(str) || /\binr\b/i.test(str)) {
    const n = parseFloat(str.replace(/[^0-9.]/g, ''));
    return !isNaN(n) && n > 0 ? `₹${n.toLocaleString('en-IN')}` : `₹${str.replace(/[^0-9.]/g, '')}`;
  }

  // 2. If it is a bare numeric string:
  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (isNaN(num) || num <= 0) return str;

  // Domain & platform detection based on source URL
  const url = (sourceUrl || '').toLowerCase();
  if (url.includes('.co.uk')) return `£${num.toLocaleString('en-GB')}`;
  if (url.includes('.eu') || url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es')) {
    return `€${num.toLocaleString('de-DE')}`;
  }
  if (!url || url.includes('.in') || url.includes('myntra') || url.includes('ajio') || url.includes('nykaa') || url.includes('meesho') || url.includes('tata')) {
    return `₹${num.toLocaleString('en-IN')}`;
  }

  // International default (.com etc.)
  return `$${num.toLocaleString('en-US')}`;
}
