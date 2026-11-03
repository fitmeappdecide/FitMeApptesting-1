import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Keyboard, Image,
  ActivityIndicator, Linking, Alert, Modal, Animated, Easing, Dimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, Radii } from '../../src/constants/theme';

const resolveStoreUrl = (rawUrl?: string, itemTitle?: string, platform?: string): string => {
  let url = (rawUrl || '').trim();
  const searchTitle = itemTitle || 'fashion outfit';
  const encodedQ = encodeURIComponent(searchTitle.trim());

  // Check if url is a broken dummy placeholder path (e.g. /product/linen-shirt-01) or bare homepages
  const isDummyPath = /\/product\/[^\/]+-\d{2}$/i.test(url) || /linen-shirt-01|chino-trousers|white-sneakers-03|anarkali-kurta-set-01/i.test(url);
  const isBareDomain = /^(https?:\/\/(?:www\.)?(myntra\.com|ajio\.com|amazon\.in))\/?$/i.test(url);

  if (!url || isDummyPath || isBareDomain) {
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

const openProductUrl = async (url?: string, itemTitle?: string, platform?: string) => {
  const targetUrl = resolveStoreUrl(url, itemTitle, platform);
  if (!targetUrl) return;
  try {
    const canOpen = await Linking.canOpenURL(targetUrl).catch(() => false);
    if (canOpen) {
      await Linking.openURL(targetUrl);
    } else {
      await Linking.openURL(targetUrl).catch(() => {
        Alert.alert('Store Link', 'Unable to open merchant store page on this device.');
      });
    }
  } catch (err) {
    console.warn('[AVA SHOP] Linking.openURL failed:', err);
    Alert.alert('Store Link', 'Unable to open merchant store page.');
  }
};
import {
  sendAVAMessage,
  streamAVAMessage,
  getAVAConversations,
  getAVAMessages,
  deleteAVAConversation,
  AVAOutfitCard,
  AVAConversationSummary,
  AVAMessageItem,
  getAVAPreferences,
  updateAVAPreferences,
  AVAPreferences,
} from '../../src/services/avaService';
import { useUserStore } from '../../src/services/userStore';

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
    return 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=600&q=80';
  }
  if (lower.includes('shirt') || lower.includes('tee') || lower.includes('t-shirt') || lower.includes('top')) {
    return 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80';
  }
  return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';
};

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

// Inline Markdown Parser for bold (**text**), italics (*text*), and badges (`badge`)
function renderFormattedInlineText(text: string, baseStyle: any, boldStyle: any) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
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
        <Text key={`i_${match.index}`} style={[baseStyle, { fontStyle: 'italic', color: '#D4D4D8' }]}>
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

// Authentic ChatGPT Recommendation Card Row (Exact layout from ChatGPT screenshots)
function ChatGPTRecommendationCard({
  index,
  title,
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
  badge?: string;
  description?: string;
  bestFor?: string;
  price?: number | string;
  imageUrl?: string;
  platform?: string;
  onPressShop?: () => void;
  onPressTryOn?: () => void;
}) {
  return (
    <View style={styles.gptCardRow}>
      {/* Left Thumbnail Image */}
      <View style={styles.gptCardImgWrap}>
        <SafeProductImage
          uri={imageUrl}
          title={title}
          style={styles.gptCardThumb}
        />
        {platform && (
          <View style={styles.gptPlatformTag}>
            <Text style={styles.gptPlatformTagText}>{platform.toUpperCase()}</Text>
          </View>
        )}
      </View>

      {/* Right Details Column */}
      <View style={styles.gptCardContent}>
        <TouchableOpacity
          activeOpacity={onPressShop ? 0.75 : 1}
          onPress={onPressShop}
        >
          <Text style={styles.gptCardTitle} numberOfLines={2}>
            {index}. {title}
          </Text>
        </TouchableOpacity>

        {badge ? (
          <View style={styles.gptBadgePill}>
            <Text style={styles.gptBadgeText}>{badge}</Text>
          </View>
        ) : null}

        {description ? (
          <Text style={styles.gptCardDesc} numberOfLines={3}>
            {description}
          </Text>
        ) : null}

        {bestFor ? (
          <Text style={styles.gptCardBestFor} numberOfLines={2}>
            <Text style={{ fontWeight: '700', color: Colors.foreground }}>Best for: </Text>
            {bestFor}
          </Text>
        ) : null}

        {/* Action Row */}
        <View style={styles.gptCardActions}>
          {price !== undefined && price !== null && Number(price) > 0 ? (
            <View style={styles.gptPriceTag}>
              <Text style={styles.gptPriceText}>₹{price}</Text>
            </View>
          ) : null}

          {onPressTryOn ? (
            <TouchableOpacity
              style={styles.gptActionBtnTryOn}
              onPress={onPressTryOn}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles" size={12} color={Colors.primaryForeground} />
              <Text style={styles.gptActionBtnTryOnText}>Try On</Text>
            </TouchableOpacity>
          ) : null}

          {onPressShop ? (
            <TouchableOpacity
              style={styles.gptActionBtnShop}
              onPress={onPressShop}
              activeOpacity={0.8}
            >
              <Ionicons name="open-outline" size={12} color={Colors.foreground} />
              <Text style={styles.gptActionBtnShopText}>View</Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
          <Text style={styles.typingIndicatorText}>{streamStatus || 'Ava 4o is styling...'}</Text>
        </View>
      );
    }
    return null;
  }

  // Split text by double line-breaks into distinct paragraphs
  const rawParagraphs = text.split(/\n\s*\n/);
  let cardCount = 0;

  return (
    <View style={{ gap: 8 }}>
      {rawParagraphs.map((para, pIdx) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        // 1. Check if paragraph is a section heading (### Heading, **Heading**)
        if (
          trimmed.startsWith('###') ||
          trimmed.startsWith('##') ||
          (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 60 && !trimmed.includes('\n')) ||
          trimmed.toLowerCase().includes('my top recommendations') ||
          trimmed.toLowerCase().includes('curated recommendations')
        ) {
          const cleanHeading = trimmed.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '');
          return (
            <Text key={`head_${pIdx}`} style={styles.chatGptSectionHeading}>
              {cleanHeading}
            </Text>
          );
        }

        // 2. Check if paragraph starts with a numbered item (e.g. "1. " or "### 1. ")
        const numberedMatch = trimmed.match(/^(?:###\s*)?(\d+)\.\s+([^\n]+)/);
        if (numberedMatch) {
          cardCount++;
          const itemNum = parseInt(numberedMatch[1], 10);
          const rawTitle = numberedMatch[2].replace(/\*\*/g, '').trim();
          const restOfPara = trimmed.substring(numberedMatch[0].length).trim();

          let badge: string | undefined = undefined;
          let description = '';
          let bestFor: string | undefined = undefined;

          const lines = restOfPara.split('\n').map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (line.startsWith('`') && line.endsWith('`')) {
              badge = line.slice(1, -1);
            } else if (line.toLowerCase().startsWith('best for:') || line.toLowerCase().startsWith('**best for:**')) {
              bestFor = line.replace(/^\*{0,2}best for:\*{0,2}\s*/i, '').trim();
            } else if (!badge && line.startsWith('**') && line.includes(':')) {
              badge = line.replace(/\*\*/g, '').replace(':', '').trim();
            } else {
              description = description ? `${description} ${line}` : line;
            }
          }

          if (!description && restOfPara && !bestFor) {
            description = restOfPara;
          }

          description = description.replace(/\*\*/g, '').trim();

          return (
            <ChatGPTRecommendationCard
              key={`card_${pIdx}`}
              index={itemNum || cardCount}
              title={rawTitle}
              badge={badge}
              description={description}
              bestFor={bestFor}
            />
          );
        }

        // 3. Regular markdown paragraph with bold/italic styling
        return (
          <Text key={`p_${pIdx}`} style={[styles.chatGptAvaText, isError && styles.errorBubbleText]}>
            {renderFormattedInlineText(trimmed, styles.chatGptAvaText, styles.chatGptBoldText)}
            {isStreaming && msgId === streamingMsgId && pIdx === rawParagraphs.length - 1 ? (
              <Text style={styles.streamingCursor}> ▌</Text>
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

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.8, 320);

export default function Ava() {
  const router = useRouter();
  const { initialQuery } = useLocalSearchParams<{ initialQuery?: string }>();
  const [messages, setMessages] = useState<Msg[]>([WELCOME_MSG]);
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

  // Drawer & Search State
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [conversations, setConversations] = useState<AVAConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Style DNA & Memory Profile State
  const [styleDnaVisible, setStyleDnaVisible] = useState(false);
  const [stylePreferences, setStylePreferences] = useState<AVAPreferences | null>(null);
  const [loadingStylePreferences, setLoadingStylePreferences] = useState(false);

  // Safe area insets for iOS status bar / Dynamic Island positioning
  const insets = useSafeAreaInsets();

  // Animation values for smooth drawer sliding
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  // Keyboard & Layout State
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Floating custom bottom tab bar clearance (matching CustomTabBar in _layout.tsx)
  // barWrapper bottom = Math.max(insets.bottom, 20/14) + bar height (60) + camera dome (16)
  const floatingTabBarHeight = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 14) + 76;

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

  // Whenever the active authenticated user switches or logs in/out, purge local state and load fresh
  useEffect(() => {
    setStylePreferences(null);
    setConversationId(undefined);
    setConversations([]);
    setMessages([
      {
        id: 'msg_welcome',
        role: 'ava',
        text: "Hi! I'm Ava, your AI personal stylist and shopping assistant. Ask me to style an outfit, find clothes for any event, or critique a look!",
      },
    ]);
    loadInitialChatHistory();
  }, [currentUserId, currentUserEmail]);

  // Handle deep link / navigation with initialQuery
  useEffect(() => {
    if (initialQuery && typeof initialQuery === 'string' && initialQuery.trim()) {
      handleSend(initialQuery.trim());
    }
  }, [initialQuery]);

  const loadInitialChatHistory = async () => {
    try {
      setLoadingHistory(true);
      const convList = await getAVAConversations();
      setConversations(convList);

      if (convList && convList.length > 0) {
        const latest = convList[0];
        await selectConversation(latest.id, false);
      }
    } catch (err: any) {
      console.warn('[AVA UI] Initial history load note:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadHistoryList = async () => {
    try {
      setLoadingHistory(true);
      setHistoryError(null);
      const convList = await getAVAConversations();
      setConversations(convList);
    } catch (err: any) {
      console.error('[AVA UI] Error loading conversations:', err);
      setHistoryError(err.message || 'Unable to load conversations.');
    } finally {
      setLoadingHistory(false);
    }
  };

  const openDrawer = () => {
    setDrawerVisible(true);
    loadHistoryList();
    Animated.parallel([
      Animated.timing(drawerAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.poly(4)),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeDrawer = () => {
    Animated.parallel([
      Animated.timing(drawerAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        easing: Easing.in(Easing.poly(4)),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setDrawerVisible(false));
  };

  const openStyleDnaModal = async () => {
    setStyleDnaVisible(true);
    setLoadingStylePreferences(true);
    try {
      const data = await getAVAPreferences();
      setStylePreferences(data);
    } catch (err) {
      console.warn('[AVA STYLE DNA] Failed to load preferences:', err);
    } finally {
      setLoadingStylePreferences(false);
    }
  };

  const closeStyleDnaModal = () => {
    setStyleDnaVisible(false);
  };

  const handleRemovePreferenceItem = async (
    key: 'preferred_fits' | 'preferred_colors' | 'disliked_colors' | 'disliked_items' | 'favorite_brands',
    itemToRemove: string
  ) => {
    if (!stylePreferences) return;
    const currentList = stylePreferences[key] || [];
    const updatedList = currentList.filter((item) => item !== itemToRemove);
    const updated = { ...stylePreferences, [key]: updatedList };
    setStylePreferences(updated);
    try {
      await updateAVAPreferences({ [key]: updatedList });
    } catch (err) {
      console.warn('[AVA STYLE DNA] Failed to update preference:', err);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      await deleteAVAConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (conversationId === convId) {
        handleNewChat();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to delete conversation.');
    }
  };

  const selectConversation = async (convId: string, shouldCloseDrawer = true) => {
    try {
      setLoading(true);
      setConversationId(convId);

      const res = await getAVAMessages(convId);

      if (res.messages && res.messages.length > 0) {
        const loadedMsgs: Msg[] = res.messages.map((m: AVAMessageItem) => {
          const payload = m.structured_payload || {};
          return {
            id: m.id,
            role: m.sender === 'user' ? 'user' : 'ava',
            text: m.text || payload.message || '',
            outfits: payload.outfits || undefined,
            actions: payload.suggested_actions || undefined,
          };
        });
        setMessages(loadedMsgs);

        // Find last active outfit context
        for (let i = loadedMsgs.length - 1; i >= 0; i--) {
          if (loadedMsgs[i].outfits && loadedMsgs[i].outfits!.length > 0) {
            setActiveOutfit(loadedMsgs[i].outfits![0]);
            break;
          }
        }
      } else {
        setMessages([WELCOME_MSG]);
      }
      if (shouldCloseDrawer) closeDrawer();
    } catch (err: any) {
      console.error(`[AVA UI] Error loading conversation ${convId}:`, err);
      Alert.alert('Conversation Error', `Failed to load conversation messages: ${err.message}`);
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
    setMessages([WELCOME_MSG]);
    closeDrawer();
  };

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim();
    if ((!prompt && !selectedImageUri) || loading) return;

    const currentImgUri = selectedImageUri;
    const currentImgBase64 = selectedImageBase64;

    // Reset local input & photo state immediately for smooth UI transition
    setSelectedImageUri(null);
    setSelectedImageBase64(null);
    if (!textToSend) setInput('');

    const displayPrompt = prompt || 'Analyze this outfit photo';
    const userMsgId = `usr_${Date.now()}`;
    const userMsg: Msg = {
      id: userMsgId,
      role: 'user',
      text: currentImgUri ? `[Photo attached] ${displayPrompt}` : displayPrompt,
    };

    const tempAvaMsgId = `ava_${Date.now()}`;
    const initialAvaMsg: Msg = {
      id: tempAvaMsgId,
      role: 'ava',
      text: '',
      outfits: [],
      actions: [],
    };

    setMessages((prev) => [...prev, userMsg, initialAvaMsg]);
    setLoading(true);
    setIsStreaming(true);
    setStreamingMsgId(tempAvaMsgId);
    setStreamStatus('Thinking...');

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      let currentFullText = '';
      let collectedOutfits: AVAOutfitCard[] = [];

      await streamAVAMessage(
        displayPrompt,
        {
          onToken: (chunk) => {
            currentFullText += chunk;
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAvaMsgId ? { ...m, text: currentFullText } : m))
            );
            scrollRef.current?.scrollToEnd({ animated: true });
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
            if (resp.conversation_id) {
              setConversationId(resp.conversation_id);
            }
            if (resp.outfits && resp.outfits.length > 0) {
              setActiveOutfit(resp.outfits[0]);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAvaMsgId
                  ? {
                      ...m,
                      text: resp.message || currentFullText,
                      outfits: resp.outfits && resp.outfits.length > 0 ? resp.outfits : collectedOutfits,
                      actions: resp.suggested_actions,
                    }
                  : m
              )
            );
          },
        },
        conversationId,
        activeOutfit,
        currentImgBase64 || undefined
      );
    } catch (err: any) {
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
      setLoading(false);
      setIsStreaming(false);
      setStreamingMsgId(null);
      setStreamStatus(null);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
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

  // Filter conversations for Search input
  const filteredConversations = conversations.filter((c) =>
    (c.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.last_message || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group conversations by date (Today, Yesterday, Older)
  const now = new Date();
  const todayStr = now.toDateString();
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const yestStr = yest.toDateString();

  const todayList: AVAConversationSummary[] = [];
  const yestList: AVAConversationSummary[] = [];
  const olderList: AVAConversationSummary[] = [];

  filteredConversations.forEach((c) => {
    const d = new Date(c.updated_at || c.created_at);
    if (d.toDateString() === todayStr) todayList.push(c);
    else if (d.toDateString() === yestStr) yestList.push(c);
    else olderList.push(c);
  });

  const bottomContainerPadding = isKeyboardVisible ? (Platform.OS === 'ios' ? 6 : 4) : floatingTabBarHeight + 10;
  const drawerTopPadding = Math.max(insets.top, 24);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* AVA Fashion Agent Header matching Image-2 */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.headerLeftBtn}
          onPress={openDrawer}
          accessibilityLabel="Open conversations drawer"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="menu-outline" size={26} color={Colors.foreground} />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          AVA Fashion Agent
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity
            style={styles.headerDnaBadge}
            onPress={openStyleDnaModal}
            accessibilityLabel="Style DNA & Memory Profile"
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="sparkles" size={17} color="#BA7B5E" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerAvaBadge}
            onPress={handleNewChat}
            accessibilityLabel="New chat with Ava"
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <AvaIcon size={20} color="#BA7B5E" />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={{ flex: 1, paddingBottom: bottomContainerPadding }}>
          {/* Messages ScrollView */}
          <ScrollView
            ref={scrollRef}
            style={styles.msgScroll}
            contentContainerStyle={styles.msgContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((m) => (
              <View key={m.id} style={{ gap: 8 }}>
                {m.id === 'msg_welcome' ? (
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
                        onPress={() => handleImageAttachment()}
                      >
                        <View style={styles.chatGptPromptIcon}>
                          <Ionicons name="camera-outline" size={18} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.chatGptPromptCardTitle}>Rate my outfit</Text>
                          <Text style={styles.chatGptPromptCardSub}>Upload mirror selfie for score & tips</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.chatGptPromptCard}
                        activeOpacity={0.8}
                        onPress={() => handleSend('College outfit from Myntra under ₹2500')}
                      >
                        <View style={styles.chatGptPromptIcon}>
                          <Ionicons name="school-outline" size={18} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.chatGptPromptCardTitle}>College look under ₹2500</Text>
                          <Text style={styles.chatGptPromptCardSub}>Relaxed everyday streetwear</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.chatGptPromptCard}
                        activeOpacity={0.8}
                        onPress={() => handleSend('Only AJIO. Ethnic wedding outfit under ₹5000')}
                      >
                        <View style={styles.chatGptPromptIcon}>
                          <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.chatGptPromptCardTitle}>Ethnic wedding outfit</Text>
                          <Text style={styles.chatGptPromptCardSub}>Festive lehengas, sarees & kurtas</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.chatGptPromptCard}
                        activeOpacity={0.8}
                        onPress={() => handleSend('Capsule wardrobe for smart-casual office')}
                      >
                        <View style={styles.chatGptPromptIcon}>
                          <Ionicons name="briefcase-outline" size={18} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.chatGptPromptCardTitle}>Office capsule wardrobe</Text>
                          <Text style={styles.chatGptPromptCardSub}>Versatile blazers & tailored pieces</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  m.role === 'user' ? (
                    <View style={styles.chatGptUserRow}>
                      <View style={styles.chatGptUserBubble}>
                        <Text style={styles.chatGptUserText}>{m.text}</Text>
                      </View>
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
                  )
                )}

                {/* Real Curated Outfit / Product Cards in ChatGPT Vertical Order */}
                {m.outfits && m.outfits.length > 0 && (
                  <View style={styles.outfitsVerticalWrap}>
                    {m.outfits.map((outfit) => (
                      <View key={outfit.id} style={styles.outfitBlock}>
                        {/* Section Header for the Curated Look */}
                        <View style={styles.outfitHeaderRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.outfitSectionTitle}>{outfit.name || 'Curated Look'}</Text>
                            <Text style={styles.outfitOccasionSub}>
                              {(outfit.occasion || 'CASUAL').toUpperCase()} · ₹{outfit.total_price}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.outfitTryOnAllBtn}
                            onPress={() => handleAction('TRY_ON', outfit)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="sparkles" size={13} color="#FFFFFF" />
                            <Text style={styles.outfitTryOnAllText}>Try On Look</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Inline Virtual Try-On Result Preview if generated */}
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

                        {/* Vertical Ordered Recommendation Cards (Exact match to ChatGPT in Image 1 and 2) */}
                        <View style={{ gap: 8, marginTop: 4 }}>
                          {outfit.items.map((item, idx) => {
                            const finalOpenUrl = item.affiliate_url || item.canonical_product_url;
                            const isShoppable =
                              item.is_shoppable !== false &&
                              finalOpenUrl &&
                              !finalOpenUrl.includes('google.') &&
                              !finalOpenUrl.includes('bing.');

                            return (
                              <ChatGPTRecommendationCard
                                key={idx}
                                index={idx + 1}
                                title={item.title || item.name || 'Fashion Piece'}
                                badge={`${(item as any).slot || 'Piece'} · ${item.seller || item.retailer || 'Catalog'}`}
                                description={(item as any).reason || outfit.reason || `Handpicked ${(item as any).slot || 'piece'} for this ${outfit.occasion || 'style'} silhouette.`}
                                bestFor={outfit.occasion ? `${outfit.occasion.toUpperCase()} & everyday wear` : undefined}
                                price={item.price}
                                imageUrl={item.image || item.image_url}
                                platform={item.seller || item.retailer}
                                onPressShop={() => openProductUrl(finalOpenUrl, item.title || item.name, item.seller || item.retailer)}
                                onPressTryOn={() => handleAction('TRY_ON', outfit)}
                              />
                            );
                          })}
                        </View>

                        {/* Outfit Quick Actions Bar */}
                        <View style={styles.outfitActionsRow}>
                          <TouchableOpacity
                            style={[styles.cardBtn, styles.saveBtnDark]}
                            onPress={() => handleAction('SAVE', outfit)}
                          >
                            <Ionicons name="bookmark-outline" size={13} color={Colors.foreground} />
                            <Text style={styles.cardBtnDarkText}>Save Look</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.cardBtn, styles.cheaperBtnDark]}
                            onPress={() => handleAction('MAKE_CHEAPER', outfit)}
                          >
                            <Ionicons name="pricetag-outline" size={13} color={Colors.primary} />
                            <Text style={styles.cheaperBtnDarkText}>Make Cheaper</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Suggested Action Pills returned by AVA */}
                {m.actions && m.actions.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 10 }}
                    contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
                  >
                    {m.actions.map((act, actIdx) => (
                      <TouchableOpacity
                        key={actIdx}
                        style={{
                          backgroundColor: Colors.card,
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: Radii.pill,
                          borderWidth: 1,
                          borderColor: Colors.border,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                        }}
                        onPress={() => handleAction(act)}
                      >
                        <Ionicons
                          name={act.toLowerCase().includes('history') ? 'time-outline' : (act.toLowerCase().includes('try') ? 'body-outline' : 'sparkles-outline')}
                          size={13}
                          color={Colors.foreground}
                        />
                        <Text style={{ fontSize: 12, color: Colors.foreground, fontWeight: '500' }}>
                          {act}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            ))}

            {loading && !streamingMsgId && (
              <View style={styles.typingIndicatorRow}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.typingIndicatorText}>Ava 4o is styling...</Text>
              </View>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Selected Image Thumbnail Preview Bar (Positioned cleanly above composer) */}
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

          {/* ChatGPT-Style Modern Composer Row */}
          <View style={styles.chatGptComposerContainer}>
            <View style={styles.chatGptComposerBar}>
              {/* Attachment Button */}
              <TouchableOpacity
                style={styles.chatGptAttachBtn}
                onPress={handleImageAttachment}
                accessibilityLabel="Attach photo"
                accessibilityRole="button"
              >
                <Ionicons name="add" size={22} color={Colors.foreground} />
              </TouchableOpacity>

              {/* Central Text Input */}
              <TextInput
                style={styles.chatGptInput}
                placeholder="Message Ava..."
                placeholderTextColor={Colors.mutedForeground}
                value={input}
                onChangeText={setInput}
                multiline={true}
                textAlignVertical="center"
                accessibilityLabel="Message Ava"
              />

              {/* Circular Send / Stop Button */}
              <TouchableOpacity
                style={[
                  styles.chatGptSendBtn,
                  (input.trim().length > 0 || !!selectedImageUri) ? styles.chatGptSendBtnActive : null,
                  loading ? styles.chatGptSendBtnLoading : null,
                ]}
                onPress={() => handleSend()}
                activeOpacity={0.85}
                disabled={loading && !isStreaming}
                accessibilityLabel="Send message"
                accessibilityRole="button"
              >
                {loading ? (
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

      {/* ChatGPT-Style Side Conversation Drawer Modal with iOS Status-Bar Safe Area Insets */}
      {drawerVisible && (
        <Modal visible={drawerVisible} transparent={true} animationType="none" onRequestClose={closeDrawer}>
          <View style={styles.drawerOverlay}>
            {/* Animated Backdrop */}
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeDrawer}>
              <Animated.View style={[styles.drawerBackdrop, { opacity: backdropAnim }]} />
            </TouchableOpacity>

            {/* Slide-out Left Drawer with Safe Top Inset */}
            <Animated.View
              style={[
                styles.drawerContent,
                { transform: [{ translateX: drawerAnim }], paddingTop: drawerTopPadding },
              ]}
            >
              {/* Drawer Header Row: Logo left, AVA Fashion Agent center, Close button right */}
              <View style={styles.drawerHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AvaIcon size={20} color={Colors.accent} />
                  <Text style={styles.drawerBrandText}>AVA Fashion Agent</Text>
                </View>
                <TouchableOpacity onPress={closeDrawer} accessibilityLabel="Close drawer" style={styles.drawerCloseBtn}>
                  <Ionicons name="close" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>

              {/* + New Chat Action Button */}
              <TouchableOpacity
                style={styles.newChatBtn}
                onPress={handleNewChat}
                activeOpacity={0.7}
                accessibilityLabel="Start new AVA conversation"
              >
                <Ionicons name="add" size={18} color={Colors.accent} />
                <Text style={styles.newChatBtnText}>New Chat</Text>
              </TouchableOpacity>

              {/* Style DNA & Memory Profile Drawer Button */}
              <TouchableOpacity
                style={styles.styleDnaDrawerBtn}
                onPress={() => {
                  closeDrawer();
                  openStyleDnaModal();
                }}
                activeOpacity={0.7}
                accessibilityLabel="View Style DNA and Memory Profile"
              >
                <Ionicons name="sparkles" size={16} color="#BA7B5E" />
                <Text style={styles.styleDnaDrawerBtnText}>Style DNA & Memory</Text>
              </TouchableOpacity>

              {/* Search Bar */}
              <View style={styles.drawerSearchBox}>
                <Ionicons name="search-outline" size={16} color={Colors.mutedForeground} />
                <TextInput
                  style={styles.drawerSearchInput}
                  placeholder="Search conversations..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  accessibilityLabel="Search AVA conversations"
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle" size={16} color={Colors.mutedForeground} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Conversations List */}
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
                {loadingHistory ? (
                  <View style={styles.drawerCenter}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={{ marginTop: 8, fontSize: 12, color: Colors.mutedForeground }}>
                      Loading sessions…
                    </Text>
                  </View>
                ) : historyError ? (
                  <View style={styles.drawerCenter}>
                    <Text style={{ color: '#C62828', fontSize: 12, textAlign: 'center' }}>{historyError}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={loadHistoryList}>
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600' }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : conversations.length === 0 ? (
                  <View style={styles.drawerCenter}>
                    <Text style={{ fontSize: 12, color: Colors.mutedForeground }}>No saved conversations yet.</Text>
                  </View>
                ) : (
                  <>
                    {todayList.length > 0 && (
                      <View style={styles.sectionWrap}>
                        <Text style={styles.sectionHeader}>TODAY</Text>
                        {todayList.map((item) => (
                          <View
                            key={item.id}
                            style={[
                              styles.drawerItemRow,
                              item.id === conversationId && styles.drawerItemActive,
                              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                            ]}
                          >
                            <TouchableOpacity
                              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 }}
                              onPress={() => selectConversation(item.id)}
                              accessibilityLabel={`Open conversation ${item.title}`}
                            >
                              <Ionicons
                                name="chatbubble-outline"
                                size={15}
                                color={item.id === conversationId ? Colors.primary : Colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  { flex: 1, fontSize: 13, color: item.id === conversationId ? Colors.primary : Colors.foreground },
                                  item.id === conversationId && styles.drawerItemTitleActive,
                                ]}
                                numberOfLines={1}
                              >
                                {item.title}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={{ padding: 6, opacity: 0.7 }}
                              onPress={() => handleDeleteConversation(item.id)}
                              accessibilityLabel={`Delete conversation ${item.title}`}
                              activeOpacity={0.5}
                            >
                              <Ionicons name="trash-outline" size={16} color={Colors.mutedForeground} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}

                    {yestList.length > 0 && (
                      <View style={styles.sectionWrap}>
                        <Text style={styles.sectionHeader}>YESTERDAY</Text>
                        {yestList.map((item) => (
                          <View
                            key={item.id}
                            style={[
                              styles.drawerItemRow,
                              item.id === conversationId && styles.drawerItemActive,
                              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                            ]}
                          >
                            <TouchableOpacity
                              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 }}
                              onPress={() => selectConversation(item.id)}
                              accessibilityLabel={`Open conversation ${item.title}`}
                            >
                              <Ionicons
                                name="chatbubble-outline"
                                size={15}
                                color={item.id === conversationId ? Colors.primary : Colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  { flex: 1, fontSize: 13, color: item.id === conversationId ? Colors.primary : Colors.foreground },
                                  item.id === conversationId && styles.drawerItemTitleActive,
                                ]}
                                numberOfLines={1}
                              >
                                {item.title}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={{ padding: 6, opacity: 0.7 }}
                              onPress={() => handleDeleteConversation(item.id)}
                              accessibilityLabel={`Delete conversation ${item.title}`}
                              activeOpacity={0.5}
                            >
                              <Ionicons name="trash-outline" size={16} color={Colors.mutedForeground} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}

                    {olderList.length > 0 && (
                      <View style={styles.sectionWrap}>
                        <Text style={styles.sectionHeader}>PREVIOUS CONVERSATIONS</Text>
                        {olderList.map((item) => (
                          <View
                            key={item.id}
                            style={[
                              styles.drawerItemRow,
                              item.id === conversationId && styles.drawerItemActive,
                              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                            ]}
                          >
                            <TouchableOpacity
                              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 }}
                              onPress={() => selectConversation(item.id)}
                              accessibilityLabel={`Open conversation ${item.title}`}
                            >
                              <Ionicons
                                name="chatbubble-outline"
                                size={15}
                                color={item.id === conversationId ? Colors.primary : Colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  { flex: 1, fontSize: 13, color: item.id === conversationId ? Colors.primary : Colors.foreground },
                                  item.id === conversationId && styles.drawerItemTitleActive,
                                ]}
                                numberOfLines={1}
                              >
                                {item.title}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={{ padding: 6, opacity: 0.7 }}
                              onPress={() => handleDeleteConversation(item.id)}
                              accessibilityLabel={`Delete conversation ${item.title}`}
                              activeOpacity={0.5}
                            >
                              <Ionicons name="trash-outline" size={16} color={Colors.mutedForeground} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
            </Animated.View>
          </View>
        </Modal>
      )}

      {/* Style DNA & Memory Profile Modal */}
      {styleDnaVisible && (
        <Modal
          visible={styleDnaVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={closeStyleDnaModal}
        >
          <View style={styles.styleDnaOverlay}>
            <TouchableOpacity
              style={styles.styleDnaBackdrop}
              activeOpacity={1}
              onPress={closeStyleDnaModal}
            />
            <View style={styles.styleDnaSheet}>
              {/* Header */}
              <View style={styles.styleDnaHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={styles.styleDnaIconWrap}>
                    <Ionicons name="sparkles" size={17} color="#BA7B5E" />
                  </View>
                  <View>
                    <Text style={styles.styleDnaTitle}>Style DNA & Memory</Text>
                    <Text style={styles.styleDnaSubtitle}>
                      What AVA learns and remembers to tailor recommendations
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={closeStyleDnaModal}
                  style={styles.drawerCloseBtn}
                  accessibilityLabel="Close Style DNA modal"
                >
                  <Ionicons name="close" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>

              {loadingStylePreferences ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#BA7B5E" />
                  <Text style={{ marginTop: 12, fontSize: 13, color: Colors.mutedForeground }}>
                    Retrieving your Style DNA...
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={{ maxHeight: 440 }}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 16 }}
                >
                  {/* Preferred Fits */}
                  <View style={styles.dnaSection}>
                    <View style={styles.dnaSectionTitleRow}>
                      <Ionicons name="body-outline" size={14} color="#BA7B5E" />
                      <Text style={styles.dnaSectionTitle}>Preferred Fits & Silhouettes</Text>
                    </View>
                    <View style={styles.tagWrap}>
                      {(stylePreferences?.preferred_fits || []).length > 0 ? (
                        stylePreferences?.preferred_fits?.map((fit) => (
                          <View key={fit} style={styles.dnaTag}>
                            <Text style={styles.dnaTagText}>{fit}</Text>
                            <TouchableOpacity
                              onPress={() => handleRemovePreferenceItem('preferred_fits', fit)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="close" size={13} color={Colors.mutedForeground} />
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.dnaEmptyText}>No specific fit preferences yet.</Text>
                      )}
                    </View>
                  </View>

                  {/* Favorite Colors */}
                  <View style={styles.dnaSection}>
                    <View style={styles.dnaSectionTitleRow}>
                      <Ionicons name="color-palette-outline" size={14} color="#BA7B5E" />
                      <Text style={styles.dnaSectionTitle}>Favorite Colors</Text>
                    </View>
                    <View style={styles.tagWrap}>
                      {(stylePreferences?.preferred_colors || []).length > 0 ? (
                        stylePreferences?.preferred_colors?.map((col) => (
                          <View key={col} style={styles.dnaTag}>
                            <Text style={styles.dnaTagText}>{col}</Text>
                            <TouchableOpacity
                              onPress={() => handleRemovePreferenceItem('preferred_colors', col)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="close" size={13} color={Colors.mutedForeground} />
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.dnaEmptyText}>No preferred colors stored yet.</Text>
                      )}
                    </View>
                  </View>

                  {/* Avoid / Disliked Colors */}
                  <View style={styles.dnaSection}>
                    <View style={styles.dnaSectionTitleRow}>
                      <Ionicons name="close-circle-outline" size={14} color="#DC2626" />
                      <Text style={[styles.dnaSectionTitle, { color: '#DC2626' }]}>Colors to Avoid</Text>
                    </View>
                    <View style={styles.tagWrap}>
                      {(stylePreferences?.disliked_colors || []).length > 0 ? (
                        stylePreferences?.disliked_colors?.map((col) => (
                          <View key={col} style={[styles.dnaTag, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
                            <Text style={[styles.dnaTagText, { color: '#DC2626' }]}>{col}</Text>
                            <TouchableOpacity
                              onPress={() => handleRemovePreferenceItem('disliked_colors', col)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="close" size={13} color="#DC2626" />
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.dnaEmptyText}>No disliked colors.</Text>
                      )}
                    </View>
                  </View>

                  {/* Dealbreakers & Disliked Items */}
                  <View style={styles.dnaSection}>
                    <View style={styles.dnaSectionTitleRow}>
                      <Ionicons name="ban-outline" size={14} color="#DC2626" />
                      <Text style={[styles.dnaSectionTitle, { color: '#DC2626' }]}>Disliked Styles & Dealbreakers</Text>
                    </View>
                    <View style={styles.tagWrap}>
                      {(stylePreferences?.disliked_items || []).length > 0 ? (
                        stylePreferences?.disliked_items?.map((item) => (
                          <View key={item} style={[styles.dnaTag, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
                            <Text style={[styles.dnaTagText, { color: '#DC2626' }]}>{item}</Text>
                            <TouchableOpacity
                              onPress={() => handleRemovePreferenceItem('disliked_items', item)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="close" size={13} color="#DC2626" />
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.dnaEmptyText}>No dealbreakers logged yet.</Text>
                      )}
                    </View>
                  </View>

                  {/* Favorite Brands & Stores */}
                  <View style={styles.dnaSection}>
                    <View style={styles.dnaSectionTitleRow}>
                      <Ionicons name="pricetag-outline" size={14} color="#BA7B5E" />
                      <Text style={styles.dnaSectionTitle}>Preferred Brands & Stores</Text>
                    </View>
                    <View style={styles.tagWrap}>
                      {[...(stylePreferences?.favorite_retailers || []), ...(stylePreferences?.favorite_brands || [])].length > 0 ? (
                        [...(stylePreferences?.favorite_retailers || []), ...(stylePreferences?.favorite_brands || [])].map((b) => (
                          <View key={b} style={styles.dnaTag}>
                            <Text style={styles.dnaTagText}>{b}</Text>
                            <TouchableOpacity
                              onPress={() => handleRemovePreferenceItem('favorite_brands', b)}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="close" size={13} color={Colors.mutedForeground} />
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.dnaEmptyText}>No brand preferences logged.</Text>
                      )}
                    </View>
                  </View>

                  {/* Budget Ceiling */}
                  {stylePreferences?.budget_range_max ? (
                    <View style={styles.dnaSection}>
                      <View style={styles.dnaSectionTitleRow}>
                        <Ionicons name="wallet-outline" size={14} color="#BA7B5E" />
                        <Text style={styles.dnaSectionTitle}>Budget Comfort Zone</Text>
                      </View>
                      <Text style={{ fontSize: 13, color: Colors.foreground, fontWeight: '600', marginTop: 4 }}>
                        Up to ₹{stylePreferences.budget_range_max.toLocaleString('en-IN')}
                      </Text>
                    </View>
                  ) : null}

                  {/* Style Archetypes */}
                  {stylePreferences?.style_dna && Object.keys(stylePreferences.style_dna).length > 0 ? (
                    <View style={styles.dnaSection}>
                      <View style={styles.dnaSectionTitleRow}>
                        <Ionicons name="finger-print-outline" size={14} color="#BA7B5E" />
                        <Text style={styles.dnaSectionTitle}>Aesthetic Affinities</Text>
                      </View>
                      <View style={{ gap: 6, marginTop: 6 }}>
                        {Object.entries(stylePreferences.style_dna).map(([styleName, score]) => (
                          <View key={styleName} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 12, color: Colors.foreground, textTransform: 'capitalize' }}>
                              {styleName}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <View style={{ width: 100, height: 6, backgroundColor: Colors.secondary, borderRadius: 3, overflow: 'hidden' }}>
                                <View style={{ width: `${Math.round(score * 100)}%`, height: 6, backgroundColor: '#BA7B5E', borderRadius: 3 }} />
                              </View>
                              <Text style={{ fontSize: 11, color: Colors.mutedForeground, width: 34, textAlign: 'right' }}>
                                {Math.round(score * 100)}%
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.dnaNoticeBox}>
                    <Ionicons name="shield-checkmark-outline" size={14} color="#BA7B5E" />
                    <Text style={styles.dnaNoticeText}>
                      AVA continuously updates your Style DNA as you converse, remembering your unique tastes across all chats without extra cost.
                    </Text>
                  </View>
                </ScrollView>
              )}

              <TouchableOpacity
                style={styles.dnaDoneBtn}
                onPress={closeStyleDnaModal}
                activeOpacity={0.8}
              >
                <Text style={styles.dnaDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // AVA Fashion Agent Header matching Image-2
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.background,
  },
  headerLeftBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.foreground,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  headerAvaBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E4D9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ChatGPT Empty State
  chatGptEmptyState: {
    alignItems: 'center',
    paddingTop: 36,
    paddingHorizontal: 8,
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
    gap: 10,
  },
  chatGptPromptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  chatGptPromptIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatGptPromptCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  chatGptPromptCardSub: {
    fontSize: 12,
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
    padding: 12,
    marginVertical: 4,
    gap: 12,
    alignItems: 'flex-start',
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  gptCardImgWrap: {
    width: 96,
    height: 116,
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
    textDecorationLine: 'underline',
    textDecorationColor: Colors.border,
    lineHeight: 20,
  },
  gptBadgePill: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  gptBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.foreground,
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

  // Vertical Outfits Wrap
  outfitsVerticalWrap: {
    gap: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  outfitBlock: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  outfitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 8,
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
    width: DRAWER_WIDTH,
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

  // Style DNA & Persistent Memory Profile UI
  headerDnaBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3E4D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleDnaDrawerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
    backgroundColor: '#F7EFE7',
    borderWidth: 1,
    borderColor: '#E8DED1',
    borderRadius: Radii.full,
    paddingVertical: 10,
  },
  styleDnaDrawerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#BA7B5E',
  },
  styleDnaOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  styleDnaBackdrop: {
    flex: 1,
  },
  styleDnaSheet: {
    backgroundColor: '#F7EFE7',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 18,
    paddingBottom: 28,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  styleDnaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  styleDnaIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3E4D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleDnaTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
  },
  styleDnaSubtitle: {
    fontSize: 11,
    color: Colors.mutedForeground,
    marginTop: 1,
  },
  dnaSection: {
    marginTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dnaSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  dnaSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.foreground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  dnaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8DED1',
    borderRadius: Radii.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dnaTagText: {
    fontSize: 12,
    color: Colors.foreground,
    textTransform: 'capitalize',
  },
  dnaEmptyText: {
    fontSize: 12,
    color: Colors.mutedForeground,
    fontStyle: 'italic',
    marginTop: 2,
  },
  dnaNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
    padding: 10,
    backgroundColor: '#F3E4D9',
    borderRadius: Radii.md,
  },
  dnaNoticeText: {
    flex: 1,
    fontSize: 11,
    color: '#7C4A31',
    lineHeight: 15,
  },
  dnaDoneBtn: {
    backgroundColor: '#BA7B5E',
    borderRadius: Radii.full,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  dnaDoneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

