import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Keyboard, Image,
  ActivityIndicator, Linking, Alert, Modal, Animated, Easing, Dimensions, Clipboard,
  BackHandler
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Spacing, Radii } from '../../src/constants/theme';

const resolveStoreUrl = (rawUrl?: string, itemTitle?: string, platform?: string): string => {
  let url = (rawUrl || '').trim();

  // Clean itemTitle to eliminate noise words like "(42) by Myntra", "Online in India", etc.
  const rawTitle = itemTitle || 'fashion outfit';
  const cleanTitle = rawTitle
    .replace(/\([\s\S]*?\)/g, ' ')
    .replace(/\[[\s\S]*?\]/g, ' ')
    .replace(/(?:\bby\s+(?:myntra|ajio|amazon|flipkart|meesho|zara|h&m)\b|online\s+in\s+india|at\s+best\s+price|best\s+price|buy\s+now|mrp)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || rawTitle.trim();
  const encodedQ = encodeURIComponent(cleanTitle);

  // Check if url is a broken dummy placeholder path, bare homepage, or generic Google search link
  const isGoogle = /^https?:\/\/(?:www\.)?google\.(?:com|co\.in)/i.test(url);
  const isDummyPath = /\/product\/[^\/]+-\d{2}$/i.test(url) || /linen-shirt-01|chino-trousers|white-sneakers-03|anarkali-kurta-set-01/i.test(url);
  const isBareDomain = /^(https?:\/\/(?:www\.)?(myntra\.com|ajio\.com|amazon\.in))\/?$/i.test(url);

  if (!url || isGoogle || isDummyPath || isBareDomain) {
    const plat = (platform || (url.includes('ajio') ? 'ajio' : 'myntra')).toLowerCase();
    if (plat.includes('ajio')) {
      return `https://www.ajio.com/search/?text=${encodedQ}`;
    } else if (plat.includes('amazon')) {
      return `https://www.amazon.in/s?k=${encodedQ}`;
    } else if (plat.includes('flipkart')) {
      return `https://www.flipkart.com/search?q=${encodedQ}`;
    }
    return `https://www.myntra.com/search?q=${encodedQ}`;
  }

  return url;
};

const isDirectPdpUrl = (url?: string): boolean => {
  if (!url || !url.startsWith('http')) return false;
  const isSearchPage = /\/s\?|\/search|\/collections\/|\/category\//i.test(url);
  if (isSearchPage) return false;
  const isAmazonPdp = /\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(url);
  const isMyntraPdp = /\/buy(?:\?|$)/i.test(url);
  const isAjioPdp = /\/p\/\d+/i.test(url);
  const isFlipkartPdp = /\/p\/[a-zA-Z0-9]+/i.test(url);
  const isBrandPdp = /\/products?\/[a-zA-Z0-9\-]+/i.test(url);
  return isAmazonPdp || isMyntraPdp || isAjioPdp || isFlipkartPdp || isBrandPdp;
};

const openProductUrl = async (url?: string, itemTitle?: string, platform?: string) => {
  let targetUrl = (url || '').trim();

  // If not already a direct product page, resolve the exact direct merchant PDP on-demand
  if (!isDirectPdpUrl(targetUrl) && itemTitle) {
    try {
      const res = await resolveExactProductUrl(itemTitle, platform, targetUrl);
      if (res?.direct_url && res.direct_url.startsWith('http')) {
        targetUrl = res.direct_url;
      }
    } catch (_) {}
  }

  // Fallback to resolveStoreUrl if resolution failed or empty
  if (!targetUrl || !targetUrl.startsWith('http')) {
    targetUrl = resolveStoreUrl(url, itemTitle, platform);
  }

  if (!targetUrl) return;

  // Primary: Open in-app browser (SFSafariViewController on iOS / Chrome Custom Tabs on Android)
  // This is 100% reliable, never throws "Unable to open URL", and lets the user purchase directly.
  try {
    await WebBrowser.openBrowserAsync(targetUrl, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      toolbarColor: '#000000',
      controlsColor: '#FFFFFF',
    });
  } catch (webErr) {
    // Secondary fallback: Native System Linking
    try {
      const canOpen = await Linking.canOpenURL(targetUrl).catch(() => false);
      if (canOpen) {
        await Linking.openURL(targetUrl).catch(() => {});
      }
    } catch (_) {}
  }
};
import {
  sendAVAMessage,
  streamAVAMessage,
  abortActiveAVAChat,
  getAVAConversations,
  getAVAMessages,
  getLocalAVAMessages,
  deleteAVAConversation,
  renameAVAConversation,
  resolveExactProductUrl,
  AVAOutfitCard,
  AVAConversationSummary,
  AVAMessageItem,
} from '../../src/services/avaService';
import { useUserStore } from '../../src/services/userStore';
import { useAVAStore } from '../../src/services/avaStore';

const getCategoryFallbackImage = (title?: string) => {
  const lower = (title || '').toLowerCase();
  if (lower.includes('shoe') || lower.includes('sneaker') || lower.includes('boot') || lower.includes('loafer') || lower.includes('jutti')) {
    return 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=600&q=80';
  }
  if (lower.includes('chino') || lower.includes('pant') || lower.includes('jeans') || lower.includes('trouser') || lower.includes('bottomwear')) {
    return 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=600&q=80';
  }
  if (lower.includes('bag') || lower.includes('tote') || lower.includes('wallet') || lower.includes('clutch')) {
    return 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80';
  }
  if (lower.includes('kurta') || lower.includes('anarkali') || lower.includes('saree') || lower.includes('lehenga') || lower.includes('ethnic')) {
    return 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=80';
  }
  if (lower.includes('blazer') || lower.includes('suit') || lower.includes('coat')) {
    return 'https://images.unsplash.com/photo-1548883354-7622d03aca27?auto=format&fit=crop&w=600&q=80';
  }
  if (lower.includes('shirt') || lower.includes('tee') || lower.includes('t-shirt') || lower.includes('top')) {
    return 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80';
  }
  return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';
};

const CATEGORY_THUMBNAILS = {
  college: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=300',
  wedding: 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=300',
  suit: 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=300',
  groom: 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=300',
  office: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=300',
  capsule: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=300',
  blazer: 'https://images.unsplash.com/photo-1548883354-7622d03aca27?w=300',
  ethnic: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=300',
  lehenga: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=300',
  kurta: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=300',
  rate: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=300',
  selfie: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=300',
  streetwear: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=300',
  default: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=300',
};

function getConversationThumbnail(conv: AVAConversationSummary): string {
  const text = `${conv.title || ''} ${conv.last_message || ''}`.toLowerCase();
  if (text.includes('college') || text.includes('campus') || text.includes('streetwear')) {
    return CATEGORY_THUMBNAILS.college;
  }
  if (text.includes('wedding') || text.includes('groom') || text.includes('suit') || text.includes('navy')) {
    return CATEGORY_THUMBNAILS.wedding;
  }
  if (text.includes('office') || text.includes('capsule') || text.includes('work') || text.includes('blazer')) {
    return CATEGORY_THUMBNAILS.office;
  }
  if (text.includes('ethnic') || text.includes('lehenga') || text.includes('saree') || text.includes('kurta')) {
    return CATEGORY_THUMBNAILS.ethnic;
  }
  if (text.includes('rate') || text.includes('score') || text.includes('mirror') || text.includes('selfie')) {
    return CATEGORY_THUMBNAILS.rate;
  }
  return CATEGORY_THUMBNAILS.default;
}

function SafeProductImage({ uri, title, style }: { uri?: string; title?: string; style: any }) {
  const [hasError, setHasError] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    setHasError(false);
    setTriedFallback(false);
  }, [uri]);

  const fallbackUri = getCategoryFallbackImage(title);
  const effectiveUri = (!uri || hasError) ? (!triedFallback ? fallbackUri : undefined) : uri;

  if (!effectiveUri) {
    const lowerTitle = (title || '').toLowerCase();
    let defaultIcon: any = 'shirt-outline';
    if (
      lowerTitle.includes('perfume') ||
      lowerTitle.includes('fragrance') ||
      lowerTitle.includes('cologne')
    ) {
      defaultIcon = 'flask-outline';
    } else if (
      lowerTitle.includes('shoe') ||
      lowerTitle.includes('sneaker') ||
      lowerTitle.includes('boot')
    ) {
      defaultIcon = 'footsteps-outline';
    } else if (lowerTitle.includes('bag') || lowerTitle.includes('tote')) {
      defaultIcon = 'bag-handle-outline';
    }

    return (
      <View style={[style, { backgroundColor: Colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name={defaultIcon} size={28} color={Colors.mutedForeground} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: effectiveUri }}
      style={style}
      resizeMode="cover"
      onError={() => {
        if (!hasError && uri) {
          setHasError(true);
        } else {
          setTriedFallback(true);
        }
      }}
    />
  );
}

type Msg = {
  id: string;
  role: 'user' | 'ava';
  text: string;
  imageUri?: string;
  outfits?: AVAOutfitCard[];
  actions?: string[];
  isError?: boolean;
};

function AvaIcon({ size = 20, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Image 
      source={require('../../assets/eva.png')}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
  );
}

// Sanitizer to eliminate creepy blog-style lecture headers, checklists, and vein/sunburn quizzes
export function cleanCreepyStylistText(text: string): string {
  if (!text) return '';
  let cleaned = text
    .replace(/I'm unable to analyze skin tone from images\.?\s*(However,\s*)?/gi, '')
    .replace(/(?:^|\n)#*\s*Explore Your Closet[\s\S]*?(?=(?:(?:^|\n)#*\s*Plan Your Next Outfit|(?:^|\n)#*\s*Accessorize Thoughtfully|(?:^|\n)#*\s*Shopping List|$))/gi, '')
    .replace(/(?:^|\n)#*\s*Plan Your Next Outfit[\s\S]*?(?=(?:(?:^|\n)#*\s*Accessorize Thoughtfully|(?:^|\n)#*\s*Shopping List|$))/gi, '')
    .replace(/(?:^|\n)#*\s*Accessorize Thoughtfully[\s\S]*?(?=(?:(?:^|\n)#*\s*Shopping List|$))/gi, '')
    .replace(/(?:^|\n)#*\s*Shopping List[\s\S]*?$/gi, '')
    .replace(/Finding Your Undertone[\s\S]*?(?=(?:Power Colors|Palette|Recommended Outfits|\*\*Power Colors|\n\n###|$))/gi, '')
    .replace(/\d+\.\s*\*\*Vein Test\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
    .replace(/\d+\.\s*\*\*Sun Reaction\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
    .replace(/\d+\.\s*\*\*Jewelry Test\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
    .replace(/\d+\.\s*\*\*Identify Key Pieces\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
    .replace(/\d+\.\s*\*\*Set Aside Non-Complementary Colors\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
    .trim();

  return cleaned;
}

// Inline Markdown Parser for bold (**text**), italics (*text*), and badges (`badge`)
function renderFormattedInlineText(text: string, baseStyle: any, boldStyle: any) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`txt_${lastIndex}`} style={baseStyle}>
          {text.substring(lastIndex, match.index)}
        </Text>
      );
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <Text key={`b_${match.index}`} style={[baseStyle, boldStyle]}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <Text key={`i_${match.index}`} style={[baseStyle, { fontStyle: 'italic', color: Colors.mutedForeground }]}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <Text key={`c_${match.index}`} style={[baseStyle, styles.inlineTagBadge]}>
          {token.slice(1, -1)}
        </Text>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(
      <Text key={`txt_${lastIndex}`} style={baseStyle}>
        {text.substring(lastIndex)}
      </Text>
    );
  }

  return parts;
}

// Authentic ChatGPT Recommendation Card Row (Clean ChatGPT Layout)
function ChatGPTRecommendationCard({
  index,
  title,
  slot,
  badge,
  description,
  bestFor,
  price,
  imageUrl,
  platform,
  onPressShop,
  onPressTryOn,
}: {
  index: number;
  title: string;
  slot?: string;
  badge?: string;
  description?: string;
  bestFor?: string;
  price?: number | string;
  imageUrl?: string;
  platform?: string;
  onPressShop?: () => void;
  onPressTryOn?: () => void;
}) {
  const storeName = platform ? platform.trim() : '';
  const itemSlot = slot || badge;
  const metaParts: string[] = [];
  if (price !== undefined && price !== null && Number(price) > 0) {
    metaParts.push(`₹${price}`);
  }
  if (storeName) {
    metaParts.push(storeName);
  }
  if (itemSlot) {
    metaParts.push(itemSlot);
  }
  const metaString = metaParts.join(' · ');

  return (
    <View style={styles.styleRow}>
      {/* Left Thumbnail Image */}
      {imageUrl ? (
        <View style={styles.styleRowImgWrap}>
          <SafeProductImage
            uri={imageUrl}
            title={title}
            style={styles.gptCardThumb}
          />
        </View>
      ) : null}

      {/* Right Details Column */}
      <View style={styles.styleRowContent}>
        <Text style={styles.styleRowTitle}>
          {index}. {title}
        </Text>

        {metaString ? (
          <Text style={styles.styleRowBudget}>
            {metaString}
          </Text>
        ) : null}

        {description ? <Text style={styles.styleRowDesc}>{description}</Text> : null}
        {bestFor ? <Text style={styles.styleRowWhy}>{bestFor}</Text> : null}

        {onPressShop ? (
          <TouchableOpacity activeOpacity={0.7} onPress={onPressShop}>
            <Text style={styles.styleRowLink} numberOfLines={1}>
              Shop {storeName ? `on ${storeName}` : 'product'} ↗
            </Text>
          </TouchableOpacity>
        ) : null}


      </View>
    </View>
  );
}


// ChatGPT-style outfit style row (borderless: photo left, details right)
function OutfitStyleRow({
  index,
  outfit,
  onTryOn,
}: {
  index: number;
  outfit: AVAOutfitCard;
  onTryOn: () => void;
}) {
  const heroItem = outfit.items[0];
  const heroUri = heroItem?.image || heroItem?.image_url;
  const lo = outfit.budget_min;
  const hi = outfit.budget_max;

  return (
    <View style={styles.styleRow}>
      <View style={styles.styleRowImgWrap}>
        <SafeProductImage uri={heroUri} title={heroItem?.title || outfit.name} style={styles.gptCardThumb} />
      </View>
      <View style={styles.styleRowContent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <View style={styles.gptBadgePill}>
            <Text style={styles.gptBadgeText}>LOOK 0{index}{outfit.tag ? ` • ${outfit.tag.toUpperCase()}` : ""}</Text>
          </View>
        </View>
        <Text style={styles.styleRowTitle}>{outfit.name}</Text>
        {outfit.description ? <Text style={styles.styleRowDesc}>{outfit.description}</Text> : null}
        {outfit.why ? <Text style={styles.styleRowWhy}>{outfit.why}</Text> : null}
        {hi ? (
          <Text style={styles.styleRowBudget}>
            Budget: ₹{lo && lo !== hi ? `${Math.round(lo).toLocaleString("en-IN")}–₹${Math.round(hi).toLocaleString("en-IN")}` : Math.round(hi).toLocaleString("en-IN")}
          </Text>
        ) : null}
        <View style={{ marginTop: 4, gap: 4 }}>
          {outfit.items.slice(0, 3).map((item, i) => {
            const url = item.affiliate_url || item.canonical_product_url;
            const label = item.title || item.name || "product";
            return (
              <TouchableOpacity
                key={i}
                activeOpacity={0.7}
                onPress={() => openProductUrl(url, label, item.seller || item.retailer)}
              >
                <Text style={styles.styleRowLink} numberOfLines={1}>Shop {label} ↗</Text>
              </TouchableOpacity>
            );
          })}
        </View>

      </View>
    </View>
  );
}

// ChatGPT-style tappable follow-up question card
function FollowUpQuestionCard({
  outfits,
  onContinue,
}: {
  outfits: AVAOutfitCard[];
  onContinue: (message: string) => void;
}) {
  const looks = outfits.map((o) => o.name);
  const budgetCap = Math.max(...outfits.map((o) => o.budget_max || 0));
  const coverOptions = ['Full outfit including shoes', 'Clothes only — I already have shoes'];
  const [look, setLook] = useState(looks[0]);
  const [cover, setCover] = useState(coverOptions[0]);

  const renderGroup = (title: string, options: string[], value: string, set: (v: string) => void) => (
    <View style={styles.followUpGroup}>
      <Text style={styles.followUpGroupTitle}>{title}</Text>
      {options.map((opt) => (
        <TouchableOpacity key={opt} style={styles.followUpOption} activeOpacity={0.7} onPress={() => set(opt)}>
          <View style={styles.followUpRadio}>
            {value === opt ? <View style={styles.followUpRadioDot} /> : null}
          </View>
          <Text style={styles.followUpOptionText}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.chatGptSectionHeading}>Want me to pick the actual products?</Text>
      <View style={styles.followUpCard}>
        {renderGroup('Choose your preferred look', looks, look, setLook)}
        <View style={styles.followUpDivider} />
        {renderGroup(budgetCap ? `What should ₹${budgetCap} cover?` : 'What should the budget cover?', coverOptions, cover, setCover)}
        <TouchableOpacity
          style={styles.followUpContinue}
          activeOpacity={0.85}
          onPress={() => onContinue(`I'd like the ${look} look. Please pick the actual products — ${cover}.`)}
        >
          <Text style={styles.followUpContinueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Markdown and Structured Message Renderer for Assistant turns
function ChatMessageRenderer({
  text,
  isStreaming,
  streamingMsgId,
  msgId,
  streamStatus,
  isError,
}: {
  text: string;
  isStreaming: boolean;
  streamingMsgId: string | null;
  msgId: string;
  streamStatus: string | null;
  isError?: boolean;
}) {
  if (!text) {
    if (isStreaming && msgId === streamingMsgId) {
      return (
        <View style={styles.typingIndicatorRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.typingIndicatorText}>{streamStatus || 'Ava is styling...'}</Text>
        </View>
      );
    }
    return (
      <View style={{ gap: 6 }}>
        <Text style={styles.chatGptAvaText}>
          Here are curated pieces styled especially for you based on our live catalog.
        </Text>
      </View>
    );
  }

  // Split text by double line-breaks into distinct blocks
  const sanitizedText = cleanCreepyStylistText(text);
  const rawParagraphs = sanitizedText.split(/\n\s*\n/);
  const isCurrentStreaming = isStreaming && msgId === streamingMsgId;

  return (
    <View style={{ gap: 10 }}>
      {rawParagraphs.map((para, pIdx) => {
        const trimmed = para.trim();
        if (!trimmed) return null;
        const isLastBlock = pIdx === rawParagraphs.length - 1;

        // 1. Level 1 Heading (# Title)
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
          return (
            <Text key={`h1_${pIdx}`} style={styles.chatGptH1}>
              {trimmed.replace(/^#\s+/, '')}
            </Text>
          );
        }

        // 2. Level 2 Heading (## Title)
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          return (
            <Text key={`h2_${pIdx}`} style={styles.chatGptH2}>
              {trimmed.replace(/^##\s+/, '')}
            </Text>
          );
        }

        // 3. Level 3 Heading (### Title or **Bold Title**)
        if (
          trimmed.startsWith('### ') ||
          (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 60 && !trimmed.includes('\n')) ||
          trimmed.toLowerCase().includes('my top recommendations') ||
          trimmed.toLowerCase().includes('curated recommendations')
        ) {
          const cleanHeading = trimmed.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '');
          return (
            <Text key={`h3_${pIdx}`} style={styles.chatGptH3}>
              {cleanHeading}
            </Text>
          );
        }

        // 4. Blockquotes (> text)
        if (trimmed.startsWith('>')) {
          const quoteContent = trimmed.replace(/^>\s*/, '');
          return (
            <View key={`bq_${pIdx}`} style={styles.chatGptBlockquote}>
              <Text style={styles.chatGptBlockquoteText}>
                {renderFormattedInlineText(quoteContent, styles.chatGptBlockquoteText, styles.chatGptBoldText)}
                {isCurrentStreaming && isLastBlock ? (
                  <Text style={styles.streamingCursor}> ▊</Text>
                ) : null}
              </Text>
            </View>
          );
        }

        // 5. Multi-line or single-line list detection (bullet or numbered)
        const lines = trimmed.split('\n');
        const hasListItems = lines.some((l) => /^\s*([-*•]|\d+\.)\s+/.test(l));

        if (hasListItems) {
          return (
            <View key={`list_${pIdx}`} style={styles.chatGptListBlock}>
              {lines.map((line, lIdx) => {
                const lTrimmed = line.trim();
                if (!lTrimmed) return null;
                const isLastLine = isLastBlock && lIdx === lines.length - 1;

                const bulletMatch = lTrimmed.match(/^[-*•]\s+(.*)$/);
                const numMatch = lTrimmed.match(/^(\d+\.)\s+(.*)$/);

                if (bulletMatch) {
                  return (
                    <View key={`li_${lIdx}`} style={styles.chatGptListItemRow}>
                      <Text style={styles.chatGptBulletSymbol}>•</Text>
                      <Text style={[styles.chatGptListItemText, isError && styles.errorBubbleText]}>
                        {renderFormattedInlineText(bulletMatch[1], styles.chatGptListItemText, styles.chatGptBoldText)}
                        {isCurrentStreaming && isLastLine ? (
                          <Text style={styles.streamingCursor}> ▊</Text>
                        ) : null}
                      </Text>
                    </View>
                  );
                }

                if (numMatch) {
                  return (
                    <View key={`num_${lIdx}`} style={styles.chatGptListItemRow}>
                      <Text style={styles.chatGptListNumSymbol}>{numMatch[1]}</Text>
                      <Text style={[styles.chatGptListItemText, isError && styles.errorBubbleText]}>
                        {renderFormattedInlineText(numMatch[2], styles.chatGptListItemText, styles.chatGptBoldText)}
                        {isCurrentStreaming && isLastLine ? (
                          <Text style={styles.streamingCursor}> ▊</Text>
                        ) : null}
                      </Text>
                    </View>
                  );
                }

                return (
                  <Text key={`sub_${lIdx}`} style={[styles.chatGptAvaText, isError && styles.errorBubbleText]}>
                    {renderFormattedInlineText(lTrimmed, styles.chatGptAvaText, styles.chatGptBoldText)}
                    {isCurrentStreaming && isLastLine ? (
                      <Text style={styles.streamingCursor}> ▊</Text>
                    ) : null}
                  </Text>
                );
              })}
            </View>
          );
        }

        // 6. Regular markdown paragraph with bold/italic styling
        return (
          <Text key={`p_${pIdx}`} style={[styles.chatGptAvaText, isError && styles.errorBubbleText]}>
            {renderFormattedInlineText(trimmed, styles.chatGptAvaText, styles.chatGptBoldText)}
            {isCurrentStreaming && isLastBlock ? (
              <Text style={styles.streamingCursor}> ▊</Text>
            ) : null}
          </Text>
        );
      })}
    </View>
  );
}

const ACTION_CHIPS = [
  'Open my tryon history',
  'Recommend products to my recent tryon',
  'College outfit from Myntra under ₹2500',
  'Only AJIO. Ethnic wedding outfit under ₹5000',
  'Make the outfit cheaper',
  'Where is this cheapest?',
];

const WELCOME_MSG: Msg = {
  id: 'msg_welcome',
  role: 'ava',
  text: "Hi — I'm AVA, your FitMe AI fashion agent. What look are we curating today? Ask for college, wedding, ethnic, or office outfits from Myntra or AJIO, compare prices, or try looks on!",
};

export default function Ava() {
  const router = useRouter();
  const navigation = useNavigation();
  const { initialQuery } = useLocalSearchParams<{ initialQuery?: string }>();
  const [currentView, setCurrentView] = useState<'hub' | 'chat'>('hub');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeOutfit, setActiveOutfit] = useState<AVAOutfitCard | undefined>(undefined);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);

  // Selected Image State for Photo Picker
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);
  // Recent Conversations State (from local Zustand store backed by SQLite + AsyncStorage)
  const conversations = useAVAStore((s) => s.conversations);
  const loadingHistory = useAVAStore((s) => s.loading);
  const fetchConversations = useAVAStore((s) => s.fetchConversations);
  const removeConversation = useAVAStore((s) => s.removeConversation);
  const renameConversationInStore = useAVAStore((s) => s.renameConversationInStore);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Rename Conversation Modal State
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [convToRename, setConvToRename] = useState<AVAConversationSummary | null>(null);
  const [renameText, setRenameText] = useState('');

  // Safe area insets for iOS status bar / Dynamic Island positioning
  const insets = useSafeAreaInsets();

  // Keyboard & Layout State
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const typewriterTimerRef = useRef<any>(null);

  const triggerSmoothScroll = (force = false) => {
    const now = Date.now();
    if (force || now - lastScrollTimeRef.current > 110) {
      lastScrollTimeRef.current = now;
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  };

  useEffect(() => {
    return () => {
      if (typewriterTimerRef.current) {
        clearInterval(typewriterTimerRef.current);
        typewriterTimerRef.current = null;
      }
    };
  }, []);

  const handleStopStream = () => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    abortActiveAVAChat();
    setLoading(false);
    setIsStreaming(false);
    setStreamingMsgId(null);
    setStreamStatus(null);
  };

  const handleUserMessageLongPress = (msg: Msg) => {
    if (loading || isStreaming) return;
    Alert.alert(
      'Message Options',
      undefined,
      [
        {
          text: 'Edit Message',
          onPress: () => {
            setEditingMessageId(msg.id);
            setInput(msg.text);
            setTimeout(() => inputRef.current?.focus(), 100);
          },
        },
        {
          text: 'Copy Text',
          onPress: () => {
            if (msg.text) {
              Clipboard.setString(msg.text);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  // Floating custom bottom tab bar clearance (matching CustomTabBar in _layout.tsx)
  const floatingTabBarHeight = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 14) + 76;

  // Toggle tab bar display: hidden in chat view, visible in hub view
  useEffect(() => {
    if (currentView === 'chat') {
      navigation.setOptions({ tabBarStyle: { display: 'none' } });
    } else {
      navigation.setOptions({ tabBarStyle: { display: 'flex' } });
    }
  }, [currentView, navigation]);

  // Handle hardware back button on Android to return to Hub
  useEffect(() => {
    const onBackPress = () => {
      if (currentView === 'chat') {
        setCurrentView('hub');
        loadHistoryList();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [currentView]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const currentUserId = useUserStore((s) => s.profile?.user_id);
  const currentUserEmail = useUserStore((s) => s.profile?.email);

  // When user switches or logs in/out, clear active thread and sync fresh
  useEffect(() => {
    setConversationId(undefined);
    setMessages([]);
    setCurrentView('hub');
    loadInitialChatHistory();
  }, [currentUserId, currentUserEmail]);

  // Handle deep link / navigation with initialQuery
  useEffect(() => {
    if (initialQuery && typeof initialQuery === 'string' && initialQuery.trim()) {
      setCurrentView('chat');
      handleSend(initialQuery.trim());
    }
  }, [initialQuery]);

  const loadInitialChatHistory = async () => {
    try {
      await fetchConversations();
    } catch (err: any) {
      console.warn('[AVA UI] Initial history load note:', err.message);
    }
  };

  const loadHistoryList = async () => {
    try {
      setHistoryError(null);
      await fetchConversations();
    } catch (err: any) {
      console.error('[AVA UI] Error loading conversations:', err);
      setHistoryError(err.message || 'Unable to load conversations.');
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      removeConversation(convId);
      await deleteAVAConversation(convId);
      if (conversationId === convId) {
        handleNewChat();
        setCurrentView('hub');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to delete conversation.');
      fetchConversations().catch(() => {});
    }
  };

  const handleRenameConversation = async (convId: string, newTitle: string) => {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    try {
      renameConversationInStore(convId, cleanTitle);
      setRenameModalVisible(false);
      setConvToRename(null);
      await renameAVAConversation(convId, cleanTitle);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to rename conversation.');
      fetchConversations().catch(() => {});
    }
  };

  const handleCardMenu = (conv: AVAConversationSummary) => {
    Alert.alert(
      conv.title || 'Conversation Options',
      'Choose an action for this conversation:',
      [
        {
          text: 'Rename Chat',
          onPress: () => {
            setConvToRename(conv);
            setRenameText(conv.title);
            setRenameModalVisible(true);
          },
        },
        {
          text: 'Delete Chat',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Conversation',
              'Are you sure you want to permanently delete this conversation?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => handleDeleteConversation(conv.id),
                },
              ]
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const mapAVAMessageItemsToUI = (items: AVAMessageItem[]): Msg[] => {
    return items.map((m: AVAMessageItem) => {
      const payload = m.structured_payload || {};
      let rawText = m.text || payload.message || '';
      let cleanedText = rawText.replace(/^\[Photo attached\]\s*/i, '');

      // Sanitize any legacy robotic refusals or creepy blog headers/questionnaires
      if (m.sender !== 'user') {
        cleanedText = cleanCreepyStylistText(cleanedText);

        if (!cleanedText && rawText) {
          cleanedText = "Based on your portrait, you have a beautiful warm, radiant complexion with stunning natural contrast. Earthy jewel tones like terracotta, royal emerald, olive, mustard, and warm cream flatter your features effortlessly!";
        }
      }

      const imgUri =
        (m as any).image_url ||
        payload.image_url ||
        (m as any).imageUri ||
        payload.imageUri ||
        undefined;

      return {
        id: m.id,
        role: m.sender === 'user' ? 'user' : 'ava',
        text: cleanedText,
        imageUri: imgUri,
        outfits: payload.outfits || undefined,
        actions: payload.suggested_actions || undefined,
      };
    });
  };

  const selectConversation = async (convId: string) => {
    try {
      setConversationId(convId);

      // 1. Instant 0ms RAM lookup from Zustand + AsyncStorage
      const ramMsgs = useAVAStore.getState().messagesByConversationId[convId];
      if (ramMsgs && ramMsgs.length > 0) {
        const loadedMsgs = mapAVAMessageItemsToUI(ramMsgs);
        setMessages(loadedMsgs);
        for (let i = loadedMsgs.length - 1; i >= 0; i--) {
          if (loadedMsgs[i].outfits && loadedMsgs[i].outfits!.length > 0) {
            setActiveOutfit(loadedMsgs[i].outfits![0]);
            break;
          }
        }
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);

        // Silent non-blocking background sync
        getAVAMessages(convId).then((res) => {
          if (res.messages && res.messages.length > 0) {
            const freshMsgs = mapAVAMessageItemsToUI(res.messages);
            setMessages(freshMsgs);
          }
        }).catch(() => {});
        return;
      }

      // 2. Instant SQLite fallback lookup (0ms local disk)
      const localMsgs = await getLocalAVAMessages(convId);
      if (localMsgs && localMsgs.length > 0) {
        useAVAStore.getState().setConversationMessages(convId, localMsgs);
        const loadedMsgs = mapAVAMessageItemsToUI(localMsgs);
        setMessages(loadedMsgs);
        for (let i = loadedMsgs.length - 1; i >= 0; i--) {
          if (loadedMsgs[i].outfits && loadedMsgs[i].outfits!.length > 0) {
            setActiveOutfit(loadedMsgs[i].outfits![0]);
            break;
          }
        }
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);

        // Silent non-blocking background sync
        getAVAMessages(convId).then((res) => {
          if (res.messages && res.messages.length > 0) {
            useAVAStore.getState().setConversationMessages(convId, res.messages);
            const freshMsgs = mapAVAMessageItemsToUI(res.messages);
            setMessages(freshMsgs);
          }
        }).catch(() => {});
        return;
      }

      // 3. Fallback for cache-miss (brand-new installation): fetch remote with loading indicator
      setLoading(true);
      const res = await getAVAMessages(convId);

      if (res.messages && res.messages.length > 0) {
        useAVAStore.getState().setConversationMessages(convId, res.messages);
        const loadedMsgs = mapAVAMessageItemsToUI(res.messages);
        setMessages(loadedMsgs);

        for (let i = loadedMsgs.length - 1; i >= 0; i--) {
          if (loadedMsgs[i].outfits && loadedMsgs[i].outfits!.length > 0) {
            setActiveOutfit(loadedMsgs[i].outfits![0]);
            break;
          }
        }
      } else {
        setMessages([]);
      }
    } catch (err: any) {
      console.error(`[AVA UI] Error loading conversation ${convId}:`, err);
      if (messages.length === 0) {
        Alert.alert('Conversation Error', `Failed to load conversation messages: ${err.message}`);
      }
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  const handleNewChat = () => {
    setConversationId(undefined);
    setActiveOutfit(undefined);
    setSelectedImageUri(null);
    setSelectedImageBase64(null);
    setInput('');
    setMessages([]);
    setCurrentView('chat');
  };

  const handleBackToHub = () => {
    setCurrentView('hub');
    setMessages([]);
    setConversationId(undefined);
    setActiveOutfit(undefined);
    loadHistoryList();
  };

  const handleOpenConversation = async (convId: string) => {
    setActiveOutfit(undefined);
    // Instant 0ms local hydration & state isolation to prevent chat bleeding
    const ramMsgs = useAVAStore.getState().messagesByConversationId[convId];
    if (ramMsgs && ramMsgs.length > 0) {
      setMessages(mapAVAMessageItemsToUI(ramMsgs));
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }
    setCurrentView('chat');
    await selectConversation(convId);
  };

  const handleSuggestionCardPress = (cardType: 'rate' | 'college' | 'ethnic' | 'office') => {
    setConversationId(undefined);
    setActiveOutfit(undefined);
    setMessages([]);
    setCurrentView('chat');

    if (cardType === 'rate') {
      setTimeout(() => {
        handleImageAttachment();
      }, 100);
    } else if (cardType === 'college') {
      handleSend('Can you suggest some college outfits under ₹2500?');
    } else if (cardType === 'ethnic') {
      handleSend('Show me some lehengas, sarees and kurtas for a wedding.');
    } else if (cardType === 'office') {
      handleSend('Help me build an office capsule wardrobe with versatile blazers.');
    }
  };

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim();
    if ((!prompt && !selectedImageUri) || loading) return;

    setCurrentView('chat');

    const currentImgUri = selectedImageUri;
    const currentImgBase64 = selectedImageBase64;
    const targetEditId = editingMessageId;

    // Reset local input & photo state immediately for smooth UI transition
    setSelectedImageUri(null);
    setSelectedImageBase64(null);
    setEditingMessageId(null);
    if (!textToSend) setInput('');

    const displayPrompt = prompt || (currentImgUri ? 'Analyze this outfit photo' : '');
    const userMsgId = `usr_${Date.now()}`;
    const userMsg: Msg = {
      id: userMsgId,
      role: 'user',
      text: displayPrompt,
      imageUri: currentImgUri || undefined,
    };

    const tempAvaMsgId = `ava_${Date.now()}`;
    const initialAvaMsg: Msg = {
      id: tempAvaMsgId,
      role: 'ava',
      text: '',
      outfits: [],
      actions: [],
    };

    // If editing a previous message (Option 1-A), truncate history from that message forward
    if (targetEditId) {
      setMessages((prev) => {
        const editIdx = prev.findIndex((m) => m.id === targetEditId);
        const base = editIdx !== -1 ? prev.slice(0, editIdx) : prev;
        return [...base, userMsg, initialAvaMsg];
      });
    } else {
      setMessages((prev) => [...prev, userMsg, initialAvaMsg]);
    }

    setLoading(true);
    setIsStreaming(true);
    setStreamingMsgId(tempAvaMsgId);
    setStreamStatus('Thinking...');

    setTimeout(() => triggerSmoothScroll(true), 80);

    let targetFullText = '';
    let displayedText = '';
    let collectedOutfits: AVAOutfitCard[] = [];

    const stopTypewriter = () => {
      if (typewriterTimerRef.current) {
        clearInterval(typewriterTimerRef.current);
        typewriterTimerRef.current = null;
      }
    };

    const startTypewriter = () => {
      if (typewriterTimerRef.current) return;
      typewriterTimerRef.current = setInterval(() => {
        if (displayedText.length < targetFullText.length) {
          const backlog = targetFullText.length - displayedText.length;
          // Smooth letter/word pacing: 1-2 chars normally, speeding up if buffer builds up
          const step = backlog > 50 ? 6 : backlog > 20 ? 3 : backlog > 8 ? 2 : 1;
          displayedText = targetFullText.substring(0, displayedText.length + step);
          const sanitized = cleanCreepyStylistText(displayedText);
          setMessages((prev) =>
            prev.map((m) => (m.id === tempAvaMsgId ? { ...m, text: sanitized } : m))
          );
          triggerSmoothScroll();
        }
      }, 16);
    };

    try {
      await streamAVAMessage(
        displayPrompt,
        {
          onToken: (chunk) => {
            targetFullText += chunk;
            startTypewriter();
          },
          onStatus: (status) => {
            setStreamStatus(status);
          },
          onOutfit: (outfit) => {
            collectedOutfits.push(outfit);
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAvaMsgId ? { ...m, outfits: [...collectedOutfits] } : m))
            );
          },
          onDone: (resp) => {
            stopTypewriter();
            if (resp.conversation_id) {
              setConversationId(resp.conversation_id);
            }
            if (resp.outfits && resp.outfits.length > 0) {
              setActiveOutfit(resp.outfits[0]);
            }
            const sanitizedFull = cleanCreepyStylistText(resp.message || targetFullText || "Here are curated pieces styled especially for you based on our live catalog.");

            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAvaMsgId
                  ? {
                      ...m,
                      text: sanitizedFull,
                      outfits: resp.outfits && resp.outfits.length > 0 ? resp.outfits : collectedOutfits,
                      actions: resp.suggested_actions,
                    }
                  : m
              )
            );
            triggerSmoothScroll(true);
            fetchConversations().catch(() => {});
          },
        },
        conversationId,
        activeOutfit,
        currentImgBase64 || undefined,
        currentImgUri || undefined
      );
    } catch (err: any) {
      stopTypewriter();
      console.error('[AVA UI] BACKEND_API_ERROR:', err);
      const errMsg = err?.message || (typeof err === 'string' ? err : 'Network request failed');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAvaMsgId
            ? {
                ...m,
                text: `Connection Error: Unable to reach Ava styling service (${errMsg}).`,
                isError: true,
              }
            : m
        )
      );
    } finally {
      stopTypewriter();
      setLoading(false);
      setIsStreaming(false);
      setStreamingMsgId(null);
      setStreamStatus(null);
      setTimeout(() => triggerSmoothScroll(true), 150);
    }
  };

  const handleAction = (actionText: string, outfit?: AVAOutfitCard) => {
    if (actionText === 'OPEN_HISTORY' || actionText.toLowerCase().includes('open full history') || actionText.toLowerCase().includes('full history')) {
      router.push('/history');
    } else if (actionText === 'STYLE_THIS' || actionText.toLowerCase().includes('style my latest try-on') || actionText.toLowerCase().includes('style this')) {
      handleSend('Recommend some products to to my recent tryon');
    } else if (actionText === 'TRY_ON' || actionText.toLowerCase().includes('try')) {
      Alert.alert('Virtual Try-On', `Launching Try-On for ${outfit?.name || 'this outfit'}...`, [
        { text: 'OK', onPress: () => handleSend('Try the first outfit on me') },
      ]);
    } else if (actionText === 'SHOP' || actionText.toLowerCase().includes('shop')) {
      const firstItem = outfit?.items[0];
      const finalOpenUrl = firstItem?.affiliate_url || firstItem?.canonical_product_url;
      const isShoppable =
        firstItem?.is_shoppable !== false &&
        finalOpenUrl &&
        !finalOpenUrl.includes('google.') &&
        !finalOpenUrl.includes('bing.') &&
        finalOpenUrl !== 'https://www.myntra.com' &&
        finalOpenUrl !== 'https://www.ajio.com';

      console.log(
        `[AVA SHOP CLICK] product='${firstItem?.title || firstItem?.name}', retailer='${firstItem?.seller || firstItem?.retailer}', ` +
        `canonical_product_url='${firstItem?.canonical_product_url}', affiliate_url='${firstItem?.affiliate_url}', final_open_url='${finalOpenUrl}'`
      );

      if (finalOpenUrl || firstItem?.title) {
        openProductUrl(finalOpenUrl, firstItem?.title || firstItem?.name, firstItem?.seller || firstItem?.retailer);
      } else {
        Alert.alert('Shop Outfit', 'Direct shopping link is currently unavailable for this outfit.');
      }
    } else if (actionText === 'SAVE' || actionText.toLowerCase().includes('save')) {
      handleSend('Save this look');
    } else if (actionText === 'MAKE_CHEAPER' || actionText.toLowerCase().includes('cheaper')) {
      handleSend('Make the first outfit cheaper');
    } else {
      handleSend(actionText);
    }
  };

  const handleImageAttachment = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'FitMe needs photo gallery permission so you can pick garment or outfit images for AVA to analyze.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImageUri(asset.uri);
        setSelectedImageBase64(asset.base64 || null);
      }
    } catch (err: any) {
      console.error('[AVA UI] Error launching photo picker:', err);
      Alert.alert('Photo Library Error', err.message || 'Unable to open photo gallery.');
    }
  };

  const renderSuggestionCards = () => (
    <View style={styles.chatGptEmptyState}>
      <View style={styles.chatGptLargeAvatar}>
        <AvaIcon size={34} color={Colors.primary} />
      </View>
      <Text style={styles.chatGptGreetingTitle}>How can I style you today?</Text>
      <Text style={styles.chatGptGreetingSub}>
        Ask for personal outfits, color analysis, mirror critique, or live retailer deals
      </Text>

      <View style={styles.chatGptPromptGrid}>
        <TouchableOpacity
          style={styles.chatGptPromptCard}
          activeOpacity={0.8}
          onPress={() => handleSuggestionCardPress('rate')}
        >
          <View style={styles.chatGptPromptIcon}>
            <Ionicons name="camera-outline" size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.chatGptPromptCardTitle}>Rate my outfit</Text>
            <Text style={styles.chatGptPromptCardSub}>Upload mirror selfie for score & tips</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.chatGptPromptCard}
          activeOpacity={0.8}
          onPress={() => handleSuggestionCardPress('college')}
        >
          <View style={styles.chatGptPromptIcon}>
            <Ionicons name="school-outline" size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.chatGptPromptCardTitle}>College look under ₹2500</Text>
            <Text style={styles.chatGptPromptCardSub}>Relaxed everyday streetwear</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.chatGptPromptCard}
          activeOpacity={0.8}
          onPress={() => handleSuggestionCardPress('ethnic')}
        >
          <View style={styles.chatGptPromptIcon}>
            <Ionicons name="sparkles-outline" size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.chatGptPromptCardTitle}>Ethnic wedding outfit</Text>
            <Text style={styles.chatGptPromptCardSub}>Festive lehengas, sarees & kurtas</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.chatGptPromptCard}
          activeOpacity={0.8}
          onPress={() => handleSuggestionCardPress('office')}
        >
          <View style={styles.chatGptPromptIcon}>
            <Ionicons name="briefcase-outline" size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.chatGptPromptCardTitle}>Office capsule wardrobe</Text>
            <Text style={styles.chatGptPromptCardSub}>Versatile blazers & tailored pieces</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Dynamic Header matching Image 1, Image 2, and Image 3 */}
      <View style={styles.headerBar}>
        {currentView === 'hub' ? (
          <TouchableOpacity
            style={styles.headerRoundBtn}
            onPress={handleNewChat}
            accessibilityLabel="New Chat"
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="add" size={22} color={Colors.foreground} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={handleBackToHub}
            accessibilityLabel="Back to Conversations"
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
          </TouchableOpacity>
        )}

        <Text style={styles.headerTitle} numberOfLines={1}>
          AVA Fashion Agent
        </Text>

        <View
          style={styles.headerRoundBtn}
          accessibilityLabel="AVA Fashion Agent"
        >
          <AvaIcon size={20} color={Colors.accent} />
        </View>
      </View>

      {/* VIEW 1 & 2: HUB VIEW (Tab bar visible, Composer hidden) */}
      {currentView === 'hub' ? (
        conversations.length === 0 ? (
          /* STATE 1: Empty Hub View (Image 1) */
          <ScrollView
            style={styles.msgScroll}
            contentContainerStyle={[styles.msgContent, { paddingBottom: floatingTabBarHeight + 20 }]}
            showsVerticalScrollIndicator={false}
          >
            {renderSuggestionCards()}
          </ScrollView>
        ) : (
          /* STATE 2: Recent Chats Hub View (Image 2) */
          <ScrollView
            style={styles.hubScroll}
            contentContainerStyle={[styles.hubListContent, { paddingBottom: floatingTabBarHeight + 20 }]}
            showsVerticalScrollIndicator={false}
          >
            {conversations.map((conv) => {
              const snippetText = conv.last_message
                ? conv.last_message.startsWith('You: ')
                  ? conv.last_message
                  : `You: ${conv.last_message}`
                : 'Tap to continue conversation';

              return (
                <TouchableOpacity
                  key={conv.id}
                  style={styles.recentChatCard}
                  activeOpacity={0.75}
                  onPress={() => handleOpenConversation(conv.id)}
                >
                  <View style={styles.recentChatAvatarWrap}>
                    <AvaIcon size={24} color={Colors.primary} />
                  </View>
                  <View style={styles.recentChatInfo}>
                    <Text style={styles.recentChatTitle} numberOfLines={1}>
                      {conv.title || 'Outfit styling session'}
                    </Text>
                    <Text style={styles.recentChatSnippet} numberOfLines={2}>
                      {snippetText}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.recentChatMenuBtn}
                    onPress={() => handleCardMenu(conv)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel="Conversation options"
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={Colors.mutedForeground} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )
      ) : (
        /* VIEW 3: CHAT VIEW (Image 3) (Tab bar hidden, Composer visible) */
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={{ flex: 1 }}>
            {messages.length === 0 ? (
              /* Blank Chat (Image 3 with 4 cards & input bar) */
              <ScrollView
                style={styles.msgScroll}
                contentContainerStyle={styles.msgContent}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
              >
                {renderSuggestionCards()}
                <View style={{ height: 16 }} />
              </ScrollView>
            ) : (
              /* Active Chat with Message Thread */
              <ScrollView
                ref={scrollRef}
                style={styles.msgScroll}
                contentContainerStyle={styles.msgContent}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyboardShouldPersistTaps="handled"
              >
                {messages.map((m) => (
                  <View key={m.id} style={{ gap: 8 }}>
                    {m.role === 'user' ? (
                      <View style={styles.chatGptUserRow}>
                        <TouchableOpacity
                          style={styles.chatGptUserBubble}
                          activeOpacity={0.85}
                          onLongPress={() => handleUserMessageLongPress(m)}
                          delayLongPress={280}
                        >
                          {m.imageUri ? (
                            <Image
                              source={{ uri: m.imageUri }}
                              style={styles.chatGptUserAttachedImage}
                              resizeMode="cover"
                            />
                          ) : null}
                          {m.text ? <Text style={styles.chatGptUserText}>{m.text}</Text> : null}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.chatGptAvaRow}>
                        <View style={styles.chatGptAvatarWrap}>
                          <AvaIcon size={16} color={Colors.primary} />
                        </View>
                        <View style={styles.chatGptAvaContent}>
                          <ChatMessageRenderer
                            text={m.text}
                            isStreaming={isStreaming}
                            streamingMsgId={streamingMsgId}
                            msgId={m.id}
                            streamStatus={streamStatus}
                            isError={m.isError}
                          />


                        </View>
                      </View>
                    )}

                    {/* Outfit Style Rows */}
                    {m.outfits && m.outfits.length > 0 && m.outfits.some((o) => !!o.description) && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={styles.chatGptSectionHeading}>
                          Curated Lookbook • {m.outfits.length} Styles
                        </Text>
                        {m.outfits.map((outfit, oIdx) => (
                          <OutfitStyleRow
                            key={outfit.id}
                            index={oIdx + 1}
                            outfit={outfit}
                            onTryOn={() => handleAction('TRY_ON', outfit)}
                          />
                        ))}
                        {!isStreaming && messages[messages.length - 1]?.id === m.id ? (
                          <FollowUpQuestionCard
                            outfits={m.outfits}
                            onContinue={(msg) => handleSend(msg)}
                          />
                        ) : null}
                      </View>
                    )}

                    {/* Curated Piece Cards */}
                    {m.outfits && m.outfits.length > 0 && !m.outfits.some((o) => !!o.description) && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={styles.chatGptSectionHeading}>
                          {m.outfits.reduce((acc, o) => acc + (o.items?.length || 0), 0) || m.outfits.length} recommended pieces to consider
                        </Text>
                        {m.outfits.map((outfit) => (
                          <View key={outfit.id}>
                            {(outfit as any).tryon_image_url && (
                              <View style={styles.tryonPreviewContainer}>
                                <Text style={styles.tryonPreviewHeader}>✨ 3D VIRTUAL TRY-ON PREVIEW</Text>
                                <SafeProductImage
                                  uri={(outfit as any).tryon_image_url}
                                  title="Virtual Try-On Preview"
                                  style={styles.tryonPreviewImage}
                                />
                              </View>
                            )}

                            {outfit.items.map((item, idx) => {
                              const finalOpenUrl = item.affiliate_url || item.canonical_product_url;

                              return (
                                <ChatGPTRecommendationCard
                                  key={idx}
                                  index={idx + 1}
                                  title={item.title || item.name || 'Fashion Piece'}
                                  slot={(item as any).slot || 'Garment'}
                                  price={item.price}
                                  imageUrl={item.image || item.image_url}
                                  platform={item.seller || item.retailer}
                                  onPressShop={() => openProductUrl(finalOpenUrl, item.title || item.name, item.seller || item.retailer)}

                                />
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    )}


                  </View>
                ))}

                {loading && !streamingMsgId && (
                  <View style={styles.typingIndicatorRow}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={styles.typingIndicatorText}>Ava is styling...</Text>
                  </View>
                )}

                <View style={{ height: 20 }} />
              </ScrollView>
            )}

            {/* Selected Image Thumbnail Preview Bar */}
            {selectedImageUri && (
              <View style={styles.imagePreviewBar}>
                <View style={styles.imagePreviewWrap}>
                  <Image source={{ uri: selectedImageUri }} style={styles.imagePreviewThumb} />
                  <TouchableOpacity
                    style={styles.imagePreviewRemoveBtn}
                    onPress={() => {
                      setSelectedImageUri(null);
                      setSelectedImageBase64(null);
                    }}
                    accessibilityLabel="Remove selected image"
                    accessibilityRole="button"
                  >
                    <Ionicons name="close-circle" size={18} color={Colors.foreground} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Editing Message Banner (Option 1-A) */}
            {editingMessageId && (
              <View style={styles.editingBanner}>
                <View style={styles.editingBannerLeft}>
                  <Ionicons name="pencil" size={13} color={Colors.primary} />
                  <Text style={styles.editingBannerText} numberOfLines={1}>
                    Editing message
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setEditingMessageId(null);
                    setInput('');
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Cancel edit"
                >
                  <Ionicons name="close" size={16} color={Colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            )}

            {/* ChatGPT-Style Modern Composer Row */}
            <View style={[styles.chatGptComposerContainer, { paddingBottom: isKeyboardVisible ? 6 : Math.max(insets.bottom, 14) }]}>
              <View style={styles.chatGptComposerBar}>
                <TouchableOpacity
                  style={styles.chatGptAttachBtn}
                  onPress={handleImageAttachment}
                  accessibilityLabel="Attach photo"
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={22} color={Colors.foreground} />
                </TouchableOpacity>

                <TextInput
                  ref={inputRef}
                  style={styles.chatGptInput}
                  placeholder="Message Ava..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={input}
                  onChangeText={setInput}
                  multiline={true}
                  textAlignVertical="center"
                  accessibilityLabel="Message Ava"
                />

                <TouchableOpacity
                  style={[
                    styles.chatGptSendBtn,
                    (input.trim().length > 0 || !!selectedImageUri) ? styles.chatGptSendBtnActive : null,
                    (loading || isStreaming) ? styles.chatGptSendBtnLoading : null,
                  ]}
                  onPress={() => {
                    if (loading || isStreaming) {
                      handleStopStream();
                    } else {
                      handleSend();
                    }
                  }}
                  activeOpacity={0.85}
                  disabled={!loading && !isStreaming && input.trim().length === 0 && !selectedImageUri}
                  accessibilityLabel={(loading || isStreaming) ? "Stop generating" : "Send message"}
                  accessibilityRole="button"
                >
                  {(loading || isStreaming) ? (
                    <Ionicons name="square" size={12} color={Colors.primaryForeground} />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={18}
                      color={input.trim().length > 0 || selectedImageUri ? Colors.primaryForeground : Colors.mutedForeground}
                    />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Rename Conversation Modal */}
      <Modal
        visible={renameModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.renameModalOverlay}
        >
          <View style={styles.renameModalCard}>
            <Text style={styles.renameModalTitle}>Rename Conversation</Text>
            <TextInput
              style={styles.renameModalInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Enter chat title..."
              placeholderTextColor={Colors.mutedForeground}
              autoFocus={true}
              selectTextOnFocus={true}
            />
            <View style={styles.renameModalActions}>
              <TouchableOpacity
                style={styles.renameCancelBtn}
                onPress={() => {
                  setRenameModalVisible(false);
                  setConvToRename(null);
                }}
              >
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.renameSaveBtn}
                onPress={() => {
                  if (convToRename) {
                    handleRenameConversation(convToRename.id, renameText);
                  }
                }}
              >
                <Text style={styles.renameSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // AVA Fashion Agent Header matching Image 1, Image 2, Image 3
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.background,
  },
  headerRoundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E4D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  // Hub Scroll and Content
  hubScroll: {
    flex: 1,
  },
  hubEmptyContent: {
    paddingHorizontal: 20,
    paddingTop: 32,
    alignItems: 'center',
  },
  hubListContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // Recent Conversation Card (Image 2)
  recentChatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 12,
    gap: 14,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  recentChatAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3E4D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentChatInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  recentChatTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: Colors.foreground,
    lineHeight: 20,
  },
  recentChatSnippet: {
    fontSize: 13,
    color: Colors.mutedForeground,
    lineHeight: 18,
    marginTop: 4,
  },
  recentChatMenuBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Rename Conversation Modal
  renameModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  renameModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  renameModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 14,
  },
  renameModalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.foreground,
    backgroundColor: Colors.background,
    marginBottom: 18,
  },
  renameModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  renameCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  renameCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.mutedForeground,
  },
  renameSaveBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  renameSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primaryForeground,
  },

  // ChatGPT Empty State
  chatGptEmptyState: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 36,
    paddingHorizontal: 0,
    marginBottom: 20,
  },
  chatGptLargeAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  chatGptGreetingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foreground,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  chatGptGreetingSub: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  chatGptPromptGrid: {
    width: '100%',
    gap: 12,
  },
  chatGptPromptCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  chatGptPromptIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F3E4D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatGptPromptCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
  },
  chatGptPromptCardSub: {
    fontSize: 12.5,
    color: Colors.mutedForeground,
    marginTop: 2,
  },

  // ChatGPT User Message (Warm Terracotta Bronze Pill)
  chatGptUserRow: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    marginVertical: 4,
  },
  chatGptUserBubble: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  chatGptUserAttachedImage: {
    width: 220,
    height: 180,
    borderRadius: 14,
    marginBottom: 8,
  },
  chatGptUserText: {
    fontSize: 15,
    color: Colors.primaryForeground,
    lineHeight: 22,
  },

  // ChatGPT Assistant Response
  chatGptAvaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginVertical: 6,
    width: '100%',
  },
  chatGptAvatarWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chatGptAvaContent: {
    flex: 1,
  },
  chatGptAvaText: {
    fontSize: 15,
    color: Colors.foreground,
    lineHeight: 23,
  },
  chatGptBoldText: {
    fontWeight: '700',
    color: Colors.foreground,
  },
  chatGptSectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
    marginTop: 14,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  chatGptH1: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.foreground,
    marginTop: 16,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  chatGptH2: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginTop: 14,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  chatGptH3: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
    marginTop: 12,
    marginBottom: 4,
    letterSpacing: -0.1,
  },
  chatGptBlockquote: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    paddingLeft: 12,
    marginVertical: 6,
  },
  chatGptBlockquoteText: {
    fontSize: 14.5,
    fontStyle: 'italic',
    color: Colors.mutedForeground,
    lineHeight: 22,
  },
  chatGptListBlock: {
    marginVertical: 4,
    gap: 6,
  },
  chatGptListItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 2,
  },
  chatGptBulletSymbol: {
    fontSize: 16,
    lineHeight: 22,
    color: Colors.primary,
    fontWeight: '700',
  },
  chatGptListNumSymbol: {
    fontSize: 14.5,
    lineHeight: 22,
    color: Colors.primary,
    fontWeight: '700',
    minWidth: 18,
  },
  chatGptListItemText: {
    flex: 1,
    fontSize: 15,
    color: Colors.foreground,
    lineHeight: 22,
  },
  chatGptMessageActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    paddingTop: 4,
  },
  chatGptActionIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  chatGptActionCopiedText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  inlineTagBadge: {
    backgroundColor: Colors.secondary,
    color: Colors.foreground,
    fontSize: 12,
    fontWeight: '600',
  },
  streamingCursor: {
    color: Colors.primary,
    fontWeight: '700',
  },
  typingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  typingIndicatorText: {
    fontSize: 13,
    color: Colors.mutedForeground,
    fontStyle: 'italic',
  },

  // Authentic ChatGPT Recommendation Cards (Vertical List)
  gptCardRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginVertical: 4,
    gap: 12,
    alignItems: 'center',
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  gptCardImgWrap: {
    width: 88,
    height: 100,
    borderRadius: 10,
    backgroundColor: Colors.muted,
    overflow: 'hidden',
    position: 'relative',
  },
  gptCardThumb: {
    width: '100%',
    height: '100%',
  },
  gptPlatformTag: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: 'rgba(44, 37, 32, 0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gptPlatformTagText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#FAF7F4',
    letterSpacing: 0.5,
  },
  gptCardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  gptCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
    lineHeight: 20,
  },
  gptCardMetaText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  gptBadgePill: {
    backgroundColor: "#F3E4D9",
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  gptBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  gptCardDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  gptCardBestFor: {
    fontSize: 12.5,
    lineHeight: 17,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  gptCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  gptPriceTag: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gptPriceText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  gptActionBtnTryOn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  gptActionBtnTryOnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primaryForeground,
  },
  gptActionBtnShop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  gptActionBtnShopText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.foreground,
  },

  // ChatGPT-style outfit style rows
  styleRow: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignItems: 'flex-start',
  },
  styleRowImgWrap: {
    width: 120,
    height: 150,
    borderRadius: 16,
    backgroundColor: Colors.muted,
    overflow: 'hidden',
  },
  styleRowContent: {
    flex: 1,
  },
  styleRowTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
    lineHeight: 22,
  },
  styleRowDesc: {
    fontSize: 14.5,
    lineHeight: 21,
    color: Colors.foreground,
    marginTop: 4,
  },
  styleRowWhy: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  styleRowBudget: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foreground,
    marginTop: 6,
  },
  styleRowLink: {
    fontSize: 14,
    color: Colors.foreground,
    textDecorationLine: 'underline',
    marginTop: 5,
  },

  // ChatGPT-style follow-up question card
  followUpCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    padding: 16,
    marginTop: 6,
  },
  followUpGroup: {
    paddingVertical: 4,
  },
  followUpGroupTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
    marginBottom: 8,
  },
  followUpOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  followUpRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.mutedForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followUpRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.foreground,
  },
  followUpOptionText: {
    flex: 1,
    fontSize: 14.5,
    color: Colors.foreground,
  },
  followUpDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 10,
  },
  followUpContinue: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
    marginTop: 12,
  },
  followUpContinueText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primaryForeground,
  },

  // Vertical Outfits Wrap
  outfitsVerticalWrap: {
    gap: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  outfitBlock: {
    marginVertical: 4,
    paddingVertical: 2,
  },
  outfitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 6,
    marginTop: 4,
  },
  outfitSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
  },
  outfitOccasionSub: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.mutedForeground,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  outfitTryOnAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  outfitTryOnAllText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.primaryForeground,
  },
  outfitActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  saveBtnDark: {
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardBtnDarkText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.foreground,
  },
  cheaperBtnDark: {
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cheaperBtnDarkText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.primary,
  },

  // ChatGPT Bottom Composer Bar
  chatGptComposerContainer: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: Colors.background,
  },
  chatGptComposerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  chatGptAttachBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatGptInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.foreground,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxHeight: 110,
  },
  chatGptSendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatGptSendBtnActive: {
    backgroundColor: Colors.primary,
  },
  chatGptSendBtnLoading: {
    backgroundColor: Colors.primary,
  },
  chatGptDisclaimer: {
    fontSize: 11,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginTop: 6,
  },



  // Message List
  msgScroll: { flex: 1, paddingHorizontal: Spacing.xl },
  msgContent: { paddingTop: Spacing.md, gap: 12 },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radii.xl,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avaBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#222225',
    borderBottomLeftRadius: 4,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#2D1515',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#0A357E',
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 14, color: '#FFFFFF', lineHeight: 22 },
  errorBubbleText: { color: '#FCA5A5', fontSize: 13 },
  userBubbleText: { color: '#FFFFFF' },

  // Outfit Cards
  outfitsWrap: { gap: 12, marginTop: 4, marginBottom: 8 },
  outfitCard: {
    backgroundColor: '#0D0D0D',
    borderRadius: Radii.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: '#222225',
    gap: 10,
  },
  outfitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  outfitTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  outfitOccasion: { fontSize: 10, letterSpacing: 1.2, color: '#71717A', marginTop: 2 },
  priceBadge: { backgroundColor: '#18181B', borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 4 },
  priceText: { fontSize: 13, fontWeight: '700', color: '#10A37F' },
  reasonText: { fontSize: 12, color: '#A1A1AA', fontStyle: 'italic' },
  // Horizontal Fashion Products Carousel
  productsCarouselScroll: {
    marginTop: 6,
    marginBottom: 4,
    marginHorizontal: -4,
  },
  productsCarouselContent: {
    gap: 12,
    paddingHorizontal: 4,
  },
  productVisualCard: {
    width: 140,
    backgroundColor: '#0D0D0D',
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  productVisualImage: {
    width: 140,
    height: 170,
    borderRadius: Radii.lg,
    backgroundColor: '#18181B',
  },
  productVisualMeta: {
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  productVisualTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  productVisualSub: {
    fontSize: 11,
    color: '#A1A1AA',
    marginTop: 2,
  },
  slotBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: Radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 10,
  },
  slotBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tryonPreviewContainer: {
    marginTop: 8,
    marginBottom: 6,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#7C3AED40',
  },
  tryonPreviewHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#A78BFA',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#2E1065',
  },
  tryonPreviewImage: {
    width: '100%',
    height: 280,
    backgroundColor: '#18181B',
  },

  cardActionsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  cardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radii.full },
  tryOnBtn: { backgroundColor: '#7C3AED' },
  tryOnBtnText: { fontSize: 11, fontWeight: '600', color: '#FFF' },
  shopBtn: { backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A' },
  shopBtnText: { fontSize: 11, fontWeight: '600', color: '#ECECEC' },
  saveBtn: { backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A' },
  saveBtnText: { fontSize: 11, fontWeight: '600', color: '#ECECEC' },
  cheaperBtn: { backgroundColor: '#064E3B' },
  cheaperBtnText: { fontSize: 11, fontWeight: '600', color: '#6EE7B7' },

  // Prompt Chips
  chipsScroll: { maxHeight: 44, marginBottom: 12 },
  chipsContent: { paddingHorizontal: Spacing.xl, gap: 8, alignItems: 'center' },
  chip: {
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 12, color: Colors.foreground },

  // Selected Image Thumbnail Preview Bar
  imagePreviewBar: {
    marginHorizontal: 28,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  imagePreviewWrap: {
    position: 'relative',
  },
  imagePreviewThumb: {
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  imagePreviewRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: Colors.background,
    borderRadius: 10,
  },

  // Modern AI Composer Row (Multi-Line Upward Expansion with Pinned Bottom Controls)
  modernComposerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 28,
    marginBottom: 8,
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingLeft: 10,
    paddingRight: 6,
    paddingTop: 6,
    paddingBottom: 6,
    minHeight: 52,
    maxHeight: 130,
  },
  modernTextInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 4,
    maxHeight: 110,
    alignSelf: 'center',
  },
  composerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    alignSelf: 'center',
  },
  modernSendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  // Drawer Overlay Styles
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  drawerContent: {
    width: 300,
    height: '100%',
    backgroundColor: Colors.background,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingHorizontal: 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  drawerBrandText: { fontSize: 16, fontWeight: '600', color: Colors.foreground },
  drawerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginVertical: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.full,
    paddingVertical: 10,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  newChatBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  drawerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  drawerSearchInput: { flex: 1, fontSize: 13, color: Colors.foreground, paddingVertical: 4 },

  drawerCenter: { paddingVertical: 30, alignItems: 'center', justifyContent: 'center' },
  retryBtn: { marginTop: 8, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radii.md },

  sectionWrap: { marginBottom: 16 },
  sectionHeader: { fontSize: 10, letterSpacing: 1.2, color: Colors.mutedForeground, fontWeight: '700', marginBottom: 6, paddingLeft: 6 },
  drawerItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: Radii.md,
    marginBottom: 2,
  },
  drawerItemActive: { backgroundColor: Colors.secondary },
  drawerItemTitle: { fontSize: 13, color: Colors.foreground, flex: 1 },
  drawerItemTitleActive: { fontWeight: '700', color: Colors.primary },

  // Hero Banner Style (Restored to spacious size as requested)
  heroBannerCard: {
    backgroundColor: '#EDE4DA',
    borderRadius: 24,
    height: 170,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 22,
    marginBottom: 20,
    overflow: 'hidden',
  },
  heroBannerTextWrap: {
    flex: 1,
    paddingRight: 4,
    justifyContent: 'center',
  },
  heroBannerLine: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.2,
    lineHeight: 24,
  },
  heroBannerImg: {
    width: '44%',
    height: '100%',
  },

  exploreHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  exploreHeaderTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foreground,
  },
  exploreViewAll: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C86D51',
  },

  exploreGrid: {
    gap: 8,
  },
  exploreGridRow: {
    flexDirection: 'row',
    gap: 8,
  },
  exploreCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
  },
  exploreCardImg: {
    width: '100%',
    height: 95,
    backgroundColor: '#FFFFFF',
    paddingTop: 2,
  },
  exploreCardMeta: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#a86248',
  },
  exploreCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 1,
  },
  exploreCardSub: {
    fontSize: 10,
    color: Colors.mutedForeground,
  },

  // Smart Suggestions For You Section Styles
  smartSectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foreground,
    marginBottom: 10,
  },
  smartSuggestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
  },
  smartSuggestionImg: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  smartSuggestionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 1,
  },
  smartSuggestionSub: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  smartSuggestionChevronBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E2E2',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  editingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: '#F7EDE8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECD4C9',
  },
  editingBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  editingBannerText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#a86248',
  },
});

