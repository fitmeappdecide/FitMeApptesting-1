import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Keyboard, Image,
  ActivityIndicator, Linking, Alert, Modal, Animated, Easing, Dimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, Radii } from '../../src/constants/theme';

const openProductUrl = async (url: string) => {
  if (!url) return;
  try {
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      await Linking.openURL(url).catch(() => {
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
  getAVAConversations,
  getAVAMessages,
  deleteAVAConversation,
  AVAOutfitCard,
  AVAConversationSummary,
  AVAMessageItem,
} from '../../src/services/avaService';

function SafeProductImage({ uri, style }: { uri?: string; style: any }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [uri]);

  if (!uri || hasError) {
    return (
      <View style={[style, { backgroundColor: '#EFEBE4', justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="shirt-outline" size={28} color="#A89F91" />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode="cover"
      onError={() => setHasError(true)}
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

function AvaIcon({ size = 20, color = Colors.accent }: { size?: number; color?: string }) {
  return (
    <Image 
      source={require('../../assets/eva.png')}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
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

  // Selected Image State for Photo Picker
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);

  // Drawer & Search State
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [conversations, setConversations] = useState<AVAConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Safe area insets for iOS status bar / Dynamic Island positioning
  const insets = useSafeAreaInsets();

  // Animation values for smooth drawer sliding
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  // Keyboard & Layout State
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  let tabBarHeight = 85;
  try {
    tabBarHeight = useBottomTabBarHeight();
  } catch (e) {
    tabBarHeight = 85;
  }

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

  // On App Mount: Load previous conversations and restore latest session from DB
  useEffect(() => {
    loadInitialChatHistory();
  }, []);

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
    console.log(`[AVA UI] USER_MESSAGE: "${displayPrompt}" (conv_id: ${conversationId || 'NEW'})`);
    const userMsgId = `usr_${Date.now()}`;
    const userMsg: Msg = {
      id: userMsgId,
      role: 'user',
      text: currentImgUri ? `[Photo attached] ${displayPrompt}` : displayPrompt,
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      console.log(`[AVA UI] CALLING_BACKEND for: "${displayPrompt}"`);
      const resp = await sendAVAMessage(
        displayPrompt,
        conversationId,
        activeOutfit,
        currentImgBase64 || undefined
      );
      console.log(`[AVA UI] BACKEND_RESPONSE_RECEIVED: intent=${resp.intent}, outfits=${resp.outfits?.length || 0}`);

      if (resp.conversation_id) {
        setConversationId(resp.conversation_id);
      }

      if (resp.outfits && resp.outfits.length > 0) {
        setActiveOutfit(resp.outfits[0]);
      }

      const avaMsg: Msg = {
        id: `ava_${Date.now()}`,
        role: 'ava',
        text: resp.message,
        outfits: resp.outfits,
        actions: resp.suggested_actions,
      };

      setMessages((prev) => [...prev, avaMsg]);
    } catch (err: any) {
      console.error('[AVA UI] BACKEND_API_ERROR:', err);
      const errMsg = err?.message || (typeof err === 'string' ? err : 'Network request failed');
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'ava',
          text: `Backend Connection Error: Unable to reach AVA FastAPI server at http://localhost:8000 (${errMsg}).`,
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
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

      if (isShoppable && finalOpenUrl) {
        openProductUrl(finalOpenUrl);
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

  const bottomContainerPadding = isKeyboardVisible ? 6 : tabBarHeight + 8;
  const drawerTopPadding = Math.max(insets.top, 24);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Custom AVA Main Header: Hamburger left, centered "AVA Fashion Agent" (NO Subtitle), AvaIcon right */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.hamburgerBtn}
          onPress={openDrawer}
          accessibilityLabel="Open AVA conversations"
          accessibilityRole="button"
        >
          <Ionicons name="menu-outline" size={24} color={Colors.foreground} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>AVA Fashion Agent</Text>
        </View>

        <View style={styles.avaIconWrap}>
          <AvaIcon size={20} color={Colors.accent} />
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
                  /* Visual Hero Banner & Explore Ideas Grid (Replaces text welcome bubble) */
                  <View style={{ marginBottom: 16 }}>
                    {/* Hero Banner Card (Exact Image-2 Target Replica) */}
                    <View style={styles.heroBannerCard}>
                      <View style={styles.heroBannerTextWrap}>
                        <Text style={styles.heroBannerLine}>Ask AVA.</Text>
                        <Text style={styles.heroBannerLine}>Get your perfect look.</Text>
                      </View>
                      <Image
                        source={require('../../assets/images/cover-ava.png')}
                        style={styles.heroBannerImg}
                        resizeMode="cover"
                      />
                    </View>

                    {/* Explore Ideas Section Header */}
                    <View style={styles.exploreHeaderRow}>
                      <Text style={styles.exploreHeaderTitle}>Explore ideas</Text>
                    </View>

                    {/* 2x2 Visual Category Grid (Side-by-Side) */}
                    <View style={styles.exploreGrid}>
                      {/* Row 1: College Looks & Date Night */}
                      <View style={styles.exploreGridRow}>
                        <TouchableOpacity
                          style={styles.exploreCard}
                          activeOpacity={0.85}
                          onPress={() => handleSend('Suggest a College outfit from Myntra under ₹2500')}
                        >
                          <Image
                            source={require('../../assets/images/college.png')}
                            style={styles.exploreCardImg}
                            resizeMode="contain"
                          />
                          <View style={styles.exploreCardMeta}>
                            <Text style={styles.exploreCardTitle}>College Looks</Text>
                          </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.exploreCard}
                          activeOpacity={0.85}
                          onPress={() => handleSend('Find a Date Night outfit under ₹3000')}
                        >
                          <Image
                            source={require('../../assets/images/party.png')}
                            style={styles.exploreCardImg}
                            resizeMode="contain"
                          />
                          <View style={styles.exploreCardMeta}>
                            <Text style={styles.exploreCardTitle}>Date Night</Text>
                          </View>
                        </TouchableOpacity>
                      </View>

                      {/* Row 2: Weekend Casual & Ethnic Wear */}
                      <View style={styles.exploreGridRow}>
                        <TouchableOpacity
                          style={styles.exploreCard}
                          activeOpacity={0.85}
                          onPress={() => handleSend('Suggest a Weekend Casual look')}
                        >
                          <Image
                            source={require('../../assets/images/casual.png')}
                            style={styles.exploreCardImg}
                            resizeMode="contain"
                          />
                          <View style={styles.exploreCardMeta}>
                            <Text style={styles.exploreCardTitle}>Weekend Casual</Text>
                          </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.exploreCard}
                          activeOpacity={0.85}
                          onPress={() => handleSend('Only AJIO. Ethnic wedding outfit under ₹5000')}
                        >
                          <Image
                            source={require('../../assets/images/ethnic.png')}
                            style={styles.exploreCardImg}
                            resizeMode="contain"
                          />
                          <View style={styles.exploreCardMeta}>
                            <Text style={styles.exploreCardTitle}>Ethnic Wear</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Smart Suggestions For You Section */}
                    <View style={{ marginTop: 18 }}>
                      <Text style={styles.smartSectionTitle}>Smart suggestions for you</Text>
                      <TouchableOpacity
                        style={styles.smartSuggestionCard}
                        activeOpacity={0.85}
                        onPress={() => handleSend('College fit under ₹2000')}
                      >
                        <Image
                          source={require('../../assets/images/college.png')}
                          style={styles.smartSuggestionImg}
                          resizeMode="contain"
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.smartSuggestionTitle}>College fit under ₹2000</Text>
                          <Text style={styles.smartSuggestionSub}>Budget-friendly & stylish picks</Text>
                        </View>
                        <View style={styles.smartSuggestionChevronBtn}>
                          <Ionicons name="chevron-forward" size={18} color="#1A1A1A" />
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={[styles.bubble, m.role === 'ava' ? (m.isError ? styles.errorBubble : styles.avaBubble) : styles.userBubble]}>
                    <Text style={[styles.bubbleText, m.role === 'user' && styles.userBubbleText, m.isError && styles.errorBubbleText]}>
                      {m.text}
                    </Text>
                  </View>
                )}

                {/* Real Outfit Cards returned by Backend */}
                {m.outfits && m.outfits.length > 0 && (
                  <View style={styles.outfitsWrap}>
                    {m.outfits.map((outfit) => (
                      <View key={outfit.id} style={styles.outfitCard}>
                        <View style={styles.outfitHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.outfitTitle}>{outfit.name}</Text>
                            <Text style={styles.outfitOccasion}>
                              {(outfit.occasion || 'CASUAL').toUpperCase()} · {(outfit.style || 'MINIMAL').toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.priceBadge}>
                            <Text style={styles.priceText}>₹{outfit.total_price}</Text>
                          </View>
                        </View>

                        {outfit.reason && <Text style={styles.reasonText}>{outfit.reason}</Text>}

                        {/* Inline Virtual Try-On Result Preview */}
                        {(outfit as any).tryon_image_url && (
                          <View style={styles.tryonPreviewContainer}>
                            <Text style={styles.tryonPreviewHeader}>✨ VIRTUAL TRY-ON PREVIEW</Text>
                            <SafeProductImage
                              uri={(outfit as any).tryon_image_url}
                              style={styles.tryonPreviewImage}
                            />
                          </View>
                        )}

                        {/* Horizontal Fashion Products Visual Cards Carousel */}
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          style={styles.productsCarouselScroll}
                          contentContainerStyle={styles.productsCarouselContent}
                        >
                          {outfit.items.map((item, idx) => (
                            <TouchableOpacity
                              key={idx}
                              style={styles.productVisualCard}
                              activeOpacity={0.85}
                              onPress={() => {
                                const finalOpenUrl = item.affiliate_url || item.canonical_product_url;
                                const isShoppable =
                                  item.is_shoppable !== false &&
                                  finalOpenUrl &&
                                  !finalOpenUrl.includes('google.') &&
                                  !finalOpenUrl.includes('bing.') &&
                                  finalOpenUrl !== 'https://www.myntra.com' &&
                                  finalOpenUrl !== 'https://www.ajio.com';

                                console.log(
                                  `[AVA SHOP CLICK] product='${item.title || item.name}', retailer='${item.seller || item.retailer}', ` +
                                  `canonical_product_url='${item.canonical_product_url}', affiliate_url='${item.affiliate_url}', final_open_url='${finalOpenUrl}'`
                                );

                                if (isShoppable && finalOpenUrl) {
                                  openProductUrl(finalOpenUrl);
                                } else {
                                  Alert.alert('Store Link', 'Direct shopping link is currently unavailable for this specific product.');
                                }
                              }}
                            >
                              <View style={{ position: 'relative' }}>
                                <SafeProductImage
                                  uri={item.image || item.image_url}
                                  style={styles.productVisualImage}
                                />
                                {(item as any).slot && (
                                  <View style={styles.slotBadge}>
                                    <Text style={styles.slotBadgeText}>{(item as any).slot}</Text>
                                  </View>
                                )}
                              </View>
                              <View style={styles.productVisualMeta}>
                                <Text style={styles.productVisualTitle} numberOfLines={1}>
                                  {item.title || item.name || 'Fashion Item'}
                                </Text>
                                <Text style={styles.productVisualSub} numberOfLines={1}>
                                  {item.seller || item.retailer || 'Retailer'} · ₹{item.price}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>

                        {/* Outfit Actions */}
                        <View style={styles.cardActionsRow}>
                          {outfit.actions?.includes('STYLE_THIS') && (
                            <TouchableOpacity
                              style={[styles.cardBtn, { backgroundColor: '#1A1A1A' }]}
                              onPress={() => handleAction('STYLE_THIS', outfit)}
                            >
                              <Ionicons name="sparkles" size={14} color="#FFF" />
                              <Text style={styles.tryOnBtnText}>Style This</Text>
                            </TouchableOpacity>
                          )}

                          {outfit.actions?.includes('OPEN_HISTORY') && (
                            <TouchableOpacity
                              style={[styles.cardBtn, { backgroundColor: '#F0EAE1', borderColor: '#D9CEBF', borderWidth: 1 }]}
                              onPress={() => handleAction('OPEN_HISTORY', outfit)}
                            >
                              <Ionicons name="time-outline" size={14} color={Colors.foreground} />
                              <Text style={[styles.shopBtnText, { color: Colors.foreground }]}>Full History</Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            style={[styles.cardBtn, styles.tryOnBtn]}
                            onPress={() => handleAction('TRY_ON', outfit)}
                          >
                            <Ionicons name="body" size={14} color="#FFF" />
                            <Text style={styles.tryOnBtnText}>Try On</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.cardBtn, styles.shopBtn]}
                            onPress={() => handleAction('SHOP', outfit)}
                          >
                            <Ionicons name="cart" size={14} color={Colors.foreground} />
                            <Text style={styles.shopBtnText}>Shop</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.cardBtn, styles.saveBtn]}
                            onPress={() => handleAction('SAVE', outfit)}
                          >
                            <Ionicons name="bookmark" size={14} color={Colors.foreground} />
                            <Text style={styles.saveBtnText}>Save</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.cardBtn, styles.cheaperBtn]}
                            onPress={() => handleAction('MAKE_CHEAPER', outfit)}
                          >
                            <Ionicons name="pricetag" size={14} color={Colors.accent} />
                            <Text style={styles.cheaperBtnText}>Cheaper</Text>
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
                          backgroundColor: '#FFFFFF',
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: Radii.pill,
                          borderWidth: 1,
                          borderColor: '#E8E1D5',
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

            {loading && (
              <View style={[styles.bubble, styles.avaBubble, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.bubbleText}>AVA is searching live retailer catalogs…</Text>
              </View>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>



          {/* Selected Image Thumbnail Preview Bar (Positioned cleanly above the composer) */}
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

          {/* Modern AI Composer Row (Multi-Line Upward Expansion with Pinned Bottom Controls) */}
          <View style={styles.modernComposerRow}>
            {/* Left Image Button */}
            <TouchableOpacity
              style={styles.composerIconBtn}
              onPress={handleImageAttachment}
              accessibilityLabel="Attach image"
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={25} color={Colors.mutedForeground} />
            </TouchableOpacity>

            {/* Central Multi-Line Text Input */}
            <TextInput
              style={styles.modernTextInput}
              placeholder="Ask anything..."
              placeholderTextColor={Colors.mutedForeground}
              value={input}
              onChangeText={setInput}
              multiline={true}
              textAlignVertical="center"
              accessibilityLabel="Ask AVA fashion agent"
            />

            {/* Right Control: Circular Send Button */}
            <TouchableOpacity
              style={styles.modernSendBtn}
              onPress={() => handleSend()}
              activeOpacity={0.85}
              disabled={loading}
              accessibilityLabel="Send message"
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.primaryForeground} />
              ) : (
                <Ionicons name="arrow-up" size={18} color={Colors.primaryForeground} />
              )}
            </TouchableOpacity>
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
                                color={item.id === conversationId ? Colors.accent : Colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  { flex: 1, fontSize: 13, color: Colors.foreground },
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
                              <Ionicons name="trash-outline" size={16} color={Colors.foreground} />
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
                                color={item.id === conversationId ? Colors.accent : Colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  { flex: 1, fontSize: 13, color: Colors.foreground },
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
                              <Ionicons name="trash-outline" size={16} color={Colors.foreground} />
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
                                color={item.id === conversationId ? Colors.accent : Colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  { flex: 1, fontSize: 13, color: Colors.foreground },
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
                              <Ionicons name="trash-outline" size={16} color={Colors.foreground} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header Bar
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '60',
    backgroundColor: Colors.background,
  },
  hamburgerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foreground,
    textAlign: 'center',
  },
  avaIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.accent + '1A',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 14, color: Colors.foreground, lineHeight: 22 },
  errorBubbleText: { color: '#C62828', fontSize: 13 },
  userBubbleText: { color: Colors.primaryForeground },

  // Outfit Cards
  outfitsWrap: { gap: 12, marginTop: 4, marginBottom: 8 },
  outfitCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  outfitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  outfitTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  outfitOccasion: { fontSize: 10, letterSpacing: 1.2, color: Colors.mutedForeground, marginTop: 2 },
  priceBadge: { backgroundColor: Colors.accent + '1F', borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 4 },
  priceText: { fontSize: 13, fontWeight: '700', color: Colors.accent },
  reasonText: { fontSize: 12, color: Colors.mutedForeground, fontStyle: 'italic' },
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
    backgroundColor: Colors.card,
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  productVisualImage: {
    width: 140,
    height: 170,
    borderRadius: Radii.lg,
    backgroundColor: Colors.muted,
  },
  productVisualMeta: {
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  productVisualTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.foreground,
  },
  productVisualSub: {
    fontSize: 11,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  slotBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(28, 25, 23, 0.78)',
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
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.accent + '40',
  },
  tryonPreviewHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: Colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.accent + '15',
  },
  tryonPreviewImage: {
    width: '100%',
    height: 280,
    backgroundColor: Colors.muted,
  },

  cardActionsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  cardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radii.full },
  tryOnBtn: { backgroundColor: Colors.primary },
  tryOnBtnText: { fontSize: 11, fontWeight: '600', color: '#FFF' },
  shopBtn: { backgroundColor: Colors.muted },
  shopBtnText: { fontSize: 11, fontWeight: '600', color: Colors.foreground },
  saveBtn: { backgroundColor: Colors.muted },
  saveBtnText: { fontSize: 11, fontWeight: '600', color: Colors.foreground },
  cheaperBtn: { backgroundColor: Colors.accent + '15' },
  cheaperBtnText: { fontSize: 11, fontWeight: '600', color: Colors.accent },

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
    borderBottomColor: Colors.border + '60',
  },
  drawerBrandText: { fontSize: 16, fontWeight: '500', color: Colors.foreground },
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
    borderColor: Colors.accent + '60',
    borderRadius: Radii.full,
    paddingVertical: 10,
  },
  newChatBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },

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
  drawerItemActive: { backgroundColor: Colors.accent + '15' },
  drawerItemTitle: { fontSize: 13, color: Colors.foreground, flex: 1 },
  drawerItemTitleActive: { fontWeight: '700', color: Colors.accent },

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
});
