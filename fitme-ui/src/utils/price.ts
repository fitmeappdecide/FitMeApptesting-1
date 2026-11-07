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

  const url = (sourceUrl || '').toLowerCase();
  const isIndianStore = url.includes('.in') || url.includes('myntra') || url.includes('ajio') || 
                        url.includes('nykaa') || url.includes('meesho') || url.includes('tata') ||
                        url.includes('flipkart');

  const isInternationalStore = url.length > 0 && !isIndianStore && (
    url.includes('.com') || url.includes('.eu') || url.includes('.co.uk') || 
    url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es') ||
    url.includes('.org') || url.includes('.net') || url.includes('samsoe') || url.includes('zara') ||
    url.includes('hm.com') || url.includes('asos') || url.includes('farfetch')
  );

  // If price has a rupee symbol but the store is clearly international (legacy Android extractor artifact):
  if (str.startsWith('₹') && isInternationalStore) {
    const cleanNum = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(cleanNum) && cleanNum > 0) {
      if (url.includes('.co.uk')) return `£${cleanNum.toLocaleString('en-GB')}`;
      if (url.includes('.eu') || url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es')) {
        return `€${cleanNum.toLocaleString('de-DE')}`;
      }
      return `$${cleanNum.toLocaleString('en-US')}`;
    }
  }

  // 1. If string already starts with a currency symbol or standard code
  if (/^[£€$¥]/.test(str)) return str;
  if (str.startsWith('₹') && (isIndianStore || !url)) return str;

  if (str.includes('£')) return `£${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('€')) return `€${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('$')) return `$${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('¥')) return `¥${str.replace(/[^0-9.]/g, '')}`;
  if (str.includes('₹') || /\brs\.?\b/i.test(str) || /\binr\b/i.test(str)) {
    if (isInternationalStore) {
      const cleanNum = parseFloat(str.replace(/[^0-9.]/g, ''));
      if (!isNaN(cleanNum) && cleanNum > 0) return `$${cleanNum.toLocaleString('en-US')}`;
    }
    const n = parseFloat(str.replace(/[^0-9.]/g, ''));
    return !isNaN(n) && n > 0 ? `₹${n.toLocaleString('en-IN')}` : `₹${str.replace(/[^0-9.]/g, '')}`;
  }

  // 2. If it is a bare numeric string:
  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (isNaN(num) || num <= 0) return str;

  // Domain & platform detection based on source URL
  if (url.includes('.co.uk')) return `£${num.toLocaleString('en-GB')}`;
  if (url.includes('.eu') || url.includes('.de') || url.includes('.fr') || url.includes('.it') || url.includes('.es')) {
    return `€${num.toLocaleString('de-DE')}`;
  }
  if (isIndianStore) {
    return `₹${num.toLocaleString('en-IN')}`;
  }

  // International default (.com etc.)
  return `$${num.toLocaleString('en-US')}`;
}
