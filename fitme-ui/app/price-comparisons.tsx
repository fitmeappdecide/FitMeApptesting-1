import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, Link, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppHeader } from "../src/components/AppHeader";
import { Colors, Spacing, Radii } from "../src/constants/theme";
import { productIntelligenceApi, PIHistoryItem } from "../src/services/api";

const tabs = ["Compared", "Liked"] as const;
type TabType = (typeof tabs)[number];

import { formatRetailerName } from "../src/constants/retailers";
import { RetailerLogo } from "../src/components/RetailerLogo";

function getComparisonImageUri(item: PIHistoryItem): string {
  if (!item) return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';

  // 1. Candidate product image matching the best retailer
  if (item.candidates && item.candidates.length > 0) {
    const bestCand = item.candidates.find(
      (c) => c.retailer?.toLowerCase() === item.best_retailer?.toLowerCase()
    );
    const bestImg = bestCand?.image_url || (bestCand as any)?.imageUrl || (bestCand as any)?.image;
    if (bestImg && typeof bestImg === 'string' && bestImg.trim().length > 0) {
      return bestImg.trim();
    }

    // Any candidate with a valid image URL
    for (const c of item.candidates) {
      const candImg = c.image_url || (c as any)?.imageUrl || (c as any)?.image;
      if (candImg && typeof candImg === 'string' && candImg.trim().length > 0) {
        return candImg.trim();
      }
    }
  }

  // 2. User's original uploaded image thumbnail (Base64)
  if (item.thumbnail_b64 && typeof item.thumbnail_b64 === 'string' && item.thumbnail_b64.trim().length > 0) {
    const b64 = item.thumbnail_b64.trim();
    return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
  }

  // 3. User's original uploaded image (stored on Storage CDN or local)
  if (item.profile?.image_cdn_url && typeof item.profile.image_cdn_url === 'string') {
    return item.profile.image_cdn_url;
  }
  if (item.profile?.image_url && typeof item.profile.image_url === 'string') {
    return item.profile.image_url;
  }

  // 4. Direct item image fields
  if ((item as any).image_url && typeof (item as any).image_url === 'string') {
    return (item as any).image_url;
  }
  if ((item as any).thumbnail_url && typeof (item as any).thumbnail_url === 'string') {
    return (item as any).thumbnail_url;
  }
  if ((item as any).garment_image_url && typeof (item as any).garment_image_url === 'string') {
    return (item as any).garment_image_url;
  }

  // 5. High-quality fashion fallback
  return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';
}

function getComparisonTitle(item: PIHistoryItem): string {
  if (item.candidates && item.candidates.length > 0) {
    const bestCand = item.candidates.find(
      (c) => c.retailer?.toLowerCase() === item.best_retailer?.toLowerCase()
    );
    if (bestCand?.title) return bestCand.title;
    if (item.candidates[0]?.title) return item.candidates[0].title;
  }
  return item.profile?.detected_title || item.match_label || "Garment Item";
}

export default function PriceComparisonsScreen() {
  const [tab, setTab] = useState<TabType>("Compared");
  const [items, setItems] = useState<PIHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const res = await productIntelligenceApi.getHistory({
        status: "done",
        saved_only: tab === "Liked",
        limit: 50,
      });
      if (Array.isArray(res)) {
        setItems(res);
      }
    } catch (err) {
      console.warn("Could not load price comparisons history:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleToggleSave = async (scanId: string) => {
    try {
      // Optimistic update
      setItems((prev) =>
        prev
          .map((item) =>
            item.scan_id === scanId ? { ...item, is_saved: !item.is_saved } : item
          )
          .filter((item) => (tab === "Liked" ? item.is_saved : true))
      );
      await productIntelligenceApi.toggleSave(scanId);
    } catch (err) {
      console.warn("Could not toggle save on comparison:", err);
      loadData();
    }
  };

  const handlePromptClearAll = () => {
    Alert.alert(
      "Clear all comparisons?",
      "This will remove all of your price comparison history. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await productIntelligenceApi.clearAllHistory();
              setItems([]);
            } catch (err) {
              console.warn("Could not clear comparisons history:", err);
              Alert.alert("Error", "Could not clear history. Please try again.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handlePromptDeleteIndividual = (scanId: string) => {
    Alert.alert(
      "Delete this comparison?",
      "This will remove this price comparison from your history. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const previousItems = [...items];
            setItems((prev) => prev.filter((item) => item.scan_id !== scanId));
            try {
              const res = await productIntelligenceApi.deleteHistory(scanId);
              if (!res || (res.deleted !== undefined && res.deleted === 0)) {
                setItems(previousItems);
              }
            } catch (err) {
              console.warn("Could not delete comparison item:", err);
              setItems(previousItems);
              Alert.alert("Error", "Could not delete comparison. Please try again.");
            }
          },
        },
      ]
    );
  };

  const leftItems = items.filter((_, i) => i % 2 === 0);
  const rightItems = items.filter((_, i) => i % 2 === 1);

  const ComparisonCard = ({ item }: { item: PIHistoryItem }) => (
    <Link href={`/find-product/results?scanId=${item.scan_id}` as any} asChild>
      <TouchableOpacity
        style={styles.masonryCard}
        activeOpacity={0.85}
        onLongPress={() => handlePromptDeleteIndividual(item.scan_id)}
        delayLongPress={400}
      >
        <Image
          source={{ uri: getComparisonImageUri(item) }}
          style={styles.masonryImg}
        />
        <View style={styles.masonryInfo}>
          <View style={styles.titleRow}>
            <Text style={styles.masonryTitle} numberOfLines={1}>
              {getComparisonTitle(item)}
            </Text>
            <TouchableOpacity
              onPress={() => handleToggleSave(item.scan_id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={item.is_saved ? "heart" : "heart-outline"}
                size={16}
                color={item.is_saved ? Colors.destructive : Colors.accent}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.retailerRow}>
            <RetailerLogo retailer={item.best_retailer} size={13} />
            <Text style={styles.masonryRetailer} numberOfLines={1}>
              {formatRetailerName(item.best_retailer)}
            </Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.masonryPrice}>
              {item.best_price ? `₹${item.best_price.toLocaleString("en-IN")}` : "Check price"}
            </Text>
            <Text style={styles.bestBadge}>Best price</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Link>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="Price Comparisons"
        back
        right={
          items.length > 0 ? (
            <TouchableOpacity
              onPress={handlePromptClearAll}
              style={styles.menuBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={Colors.foreground} />
            </TouchableOpacity>
          ) : null
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={Colors.accent}
          />
        }
      >
        {/* Tab switcher matching Your Looks */}
        <View style={styles.tabRow}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  tab === t && styles.tabBtnTextActive,
                ]}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && !refreshing ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#A86248" />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIconBox}>
              <Ionicons
                name={tab === "Compared" ? "pricetags-outline" : "heart-outline"}
                size={28}
                color={Colors.accent}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {tab === "Compared"
                ? "No comparisons yet."
                : "No liked products yet."}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === "Compared"
                ? "Find a garment photo and compare prices across stores."
                : "Tap the heart on any comparison to save it here."}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                tab === "Compared"
                  ? router.push("/find-product" as any)
                  : setTab("Compared")
              }
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {tab === "Compared" ? "Find a Product" : "View Comparisons"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.masonry}>
            <View style={styles.col}>
              {leftItems.map((item) => (
                <ComparisonCard key={item.scan_id} item={item} />
              ))}
            </View>
            <View style={styles.col}>
              {rightItems.map((item) => (
                <ComparisonCard key={item.scan_id} item={item} />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.lg },

  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },

  tabRow: {
    flexDirection: "row",
    backgroundColor: Colors.muted,
    borderRadius: Radii.full,
    padding: 3,
    marginBottom: Spacing.xl,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: Radii.full, alignItems: "center" },
  tabBtnActive: {
    backgroundColor: Colors.card,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabBtnText: { fontSize: 12, fontWeight: "500", color: Colors.mutedForeground },
  tabBtnTextActive: { color: Colors.foreground, fontWeight: "600" },

  loadingBox: { paddingVertical: 60, alignItems: "center", justifyContent: "center" },

  empty: {
    backgroundColor: "#FAF5EE",
    borderRadius: Radii.xl,
    padding: Spacing.xxl,
    alignItems: "center",
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: "#E8DED2",
  },
  emptyIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FAF3EC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: "serif",
    fontSize: 19,
    color: Colors.foreground,
    textAlign: "center",
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: Spacing.xl,
  },
  primaryBtn: {
    backgroundColor: "#A86248",
    borderRadius: Radii.full,
    paddingVertical: 12,
    paddingHorizontal: 26,
  },
  primaryBtnText: { color: Colors.white, fontSize: 13, fontWeight: "700" },

  /* 2-column flex layout matching Your Looks */
  masonry: { flexDirection: "row", gap: 10 },
  col: { flex: 1, gap: 10 },
  masonryCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  masonryImg: {
    width: "100%",
    aspectRatio: 3 / 4,
    resizeMode: "cover",
    backgroundColor: Colors.muted,
  },
  masonryInfo: { padding: 10, paddingBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  masonryTitle: { flex: 1, fontSize: 13, fontWeight: "600", color: Colors.foreground, marginRight: 6 },
  retailerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  masonryRetailer: { fontSize: 11, color: Colors.mutedForeground },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  masonryPrice: { fontSize: 13, fontWeight: "700", color: Colors.foreground },
  bestBadge: { fontSize: 10, fontWeight: "600", color: "#A86248", textTransform: "uppercase" },
});
