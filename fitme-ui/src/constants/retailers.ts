/**
 * Centralized Retailer Registry for the FitMe Application.
 *
 * Single source of truth for:
 * - Canonical retailer IDs
 * - Display names
 * - Domains and aliases
 * - Curated brand logo assets
 * - Deterministic normalization
 * - Neutral shopping fallback for unknown retailers (zero random letter icons)
 */

export interface RetailerDefinition {
  id: string;
  name: string;
  aliases: string[];
  domains: string[];
  logoAsset: any | null;
  brandColor: string;
  isSupported: boolean;
}

export const RETAILER_REGISTRY: Record<string, RetailerDefinition> = {
  myntra: {
    id: 'myntra',
    name: 'Myntra',
    aliases: ['myntra', 'myntra fashion', 'myntra india', 'myntassets'],
    domains: ['myntra.com', 'myntassets.com'],
    logoAsset: require('../../assets/retailers/myntra.png'),
    brandColor: '#FF3F6C',
    isSupported: true,
  },
  nykaa: {
    id: 'nykaa',
    name: 'Nykaa',
    aliases: ['nykaa', 'nykaa fashion', 'nykaafashion', 'nykaaman'],
    domains: ['nykaa.com', 'nykaafashion.com', 'nykaaman.com'],
    logoAsset: require('../../assets/retailers/nykaa.png'),
    brandColor: '#E80071',
    isSupported: true,
  },
  ajio: {
    id: 'ajio',
    name: 'AJIO',
    aliases: ['ajio', 'ajio luxe', 'ajioluxe', 'jiocdn'],
    domains: ['ajio.com', 'ajioluxe.com', 'jiocdn.com'],
    logoAsset: require('../../assets/retailers/ajio.png'),
    brandColor: '#2C4152',
    isSupported: true,
  },
  amazon: {
    id: 'amazon',
    name: 'Amazon',
    aliases: ['amazon', 'amazon india', 'amazon fashion', 'amazon in', 'amzn'],
    domains: ['amazon.in', 'amazon.com', 'amzn.to', 'amzn.in'],
    logoAsset: require('../../assets/retailers/amazon.png'),
    brandColor: '#232F3E',
    isSupported: true,
  },
  flipkart: {
    id: 'flipkart',
    name: 'Flipkart',
    aliases: ['flipkart', 'flipkart fashion'],
    domains: ['flipkart.com'],
    logoAsset: require('../../assets/retailers/flipkart.png'),
    brandColor: '#2874F0',
    isSupported: true,
  },
  meesho: {
    id: 'meesho',
    name: 'Meesho',
    aliases: ['meesho', 'meesho store'],
    domains: ['meesho.com'],
    logoAsset: require('../../assets/retailers/meesho.png'),
    brandColor: '#581347',
    isSupported: true,
  },
  hm: {
    id: 'hm',
    name: 'H&M',
    aliases: ['hm', 'h&m', 'h and m', 'h & m'],
    domains: ['hm.com', 'www2.hm.com'],
    logoAsset: require('../../assets/retailers/hm.png'),
    brandColor: '#E50010',
    isSupported: true,
  },
  zara: {
    id: 'zara',
    name: 'Zara',
    aliases: ['zara', 'zara india'],
    domains: ['zara.com'],
    logoAsset: require('../../assets/retailers/zara.png'),
    brandColor: '#000000',
    isSupported: true,
  },
  westside: {
    id: 'westside',
    name: 'Westside',
    aliases: ['westside', 'westside stores'],
    domains: ['westside.com'],
    logoAsset: require('../../assets/retailers/westside.png'),
    brandColor: '#1E1E1E',
    isSupported: true,
  },
  tatacliq: {
    id: 'tatacliq',
    name: 'Tata CLiQ',
    aliases: ['tatacliq', 'tata cliq', 'tatacliq luxury', 'cliq'],
    domains: ['tatacliq.com', 'luxury.tatacliq.com'],
    logoAsset: require('../../assets/retailers/tatacliq.png'),
    brandColor: '#1A1A1A',
    isSupported: true,
  },
  lifestyle: {
    id: 'lifestyle',
    name: 'Lifestyle',
    aliases: ['lifestyle', 'lifestyle stores', 'lifestylestores'],
    domains: ['lifestylestores.com'],
    logoAsset: require('../../assets/retailers/lifestyle.png'),
    brandColor: '#8E1538',
    isSupported: true,
  },
  urbanic: {
    id: 'urbanic',
    name: 'Urbanic',
    aliases: ['urbanic', 'urbanic india'],
    domains: ['urbanic.com'],
    logoAsset: null,
    brandColor: '#FF4081',
    isSupported: true,
  },
  bewakoof: {
    id: 'bewakoof',
    name: 'Bewakoof',
    aliases: ['bewakoof', 'bewakoof brands'],
    domains: ['bewakoof.com'],
    logoAsset: null,
    brandColor: '#FFD700',
    isSupported: true,
  },
  shoppersstop: {
    id: 'shoppersstop',
    name: 'Shoppers Stop',
    aliases: ['shoppers stop', 'shoppersstop'],
    domains: ['shoppersstop.com'],
    logoAsset: null,
    brandColor: '#111111',
    isSupported: true,
  },
};

/** Neutral fallback definition for unrecognized retailers. */
export const UNKNOWN_RETAILER: RetailerDefinition = {
  id: 'unknown',
  name: 'FitMe',
  aliases: [],
  domains: [],
  logoAsset: null,
  brandColor: '#7A402B',
  isSupported: false,
};

/**
 * Deterministically normalizes any raw retailer name, URL, alias, or ID into a canonical RetailerDefinition.
 *
 * Guarantees:
 * - Deterministic resolution for all alias/domain variations.
 * - Safe fallback for unrecognized or custom boutiques (FitMe with NO icon).
 * - Zero letter-initial generation or fake branding.
 */
export function normalizeRetailer(raw?: string | null): RetailerDefinition {
  if (!raw || typeof raw !== 'string') {
    return UNKNOWN_RETAILER;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return UNKNOWN_RETAILER;
  }

  const lower = trimmed.toLowerCase();

  // 1. Direct canonical ID lookup
  if (RETAILER_REGISTRY[lower]) {
    return RETAILER_REGISTRY[lower];
  }

  // 2. Lookup across all registered retailers (aliases & domain matches)
  for (const definition of Object.values(RETAILER_REGISTRY)) {
    // Check aliases
    if (definition.aliases.some((alias) => lower === alias || lower.includes(alias))) {
      return definition;
    }
    // Check domains
    if (definition.domains.some((domain) => lower.includes(domain))) {
      return definition;
    }
  }

  // 3. Fallback for unrecognized, missing, or unmapped boutique stores -> FitMe
  return UNKNOWN_RETAILER;
}

/**
 * Returns the polished human-readable display name for any retailer string or URL.
 */
export function formatRetailerName(raw?: string | null): string {
  return normalizeRetailer(raw).name;
}

/**
 * Returns the bundled logo asset for a retailer, or null if none is bundled.
 */
export function getRetailerLogoAsset(raw?: string | null): any | null {
  return normalizeRetailer(raw).logoAsset;
}

/**
 * Returns whether a retailer is officially registered and supported.
 */
export function isKnownRetailer(raw?: string | null): boolean {
  return normalizeRetailer(raw).isSupported;
}

export const supportedPlatforms: string[] = [
  'Myntra',
  'AJIO',
  'Amazon',
  'Flipkart',
  'Nykaa',
  'Meesho',
  'H&M',
  'Zara',
  'Westside',
  'Tata CLiQ',
  'Lifestyle',
];
