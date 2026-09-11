import React, { useState, useEffect, useCallback, useRef } from "react";
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
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useRouter, Link, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppHeader } from "../../src/components/AppHeader";
import { CachedImage } from "../../src/components/CachedImage";
import { Colors, Spacing, Radii } from "../../src/constants/theme";
import { TryOnHistoryItem } from "../../src/services/api";
import { useSavedPhotosStore } from "../../src/services/savedPhotosStore";
import { useLooksStore } from "../../src/services/looksStore";

const tabs = ["Generated", "Saved"] as const;
type TabType = (typeof tabs)[number];

// Aspect ratios alternated for masonry feel
const ASPECTS = [5 / 3, 4 / 3, 1, 4 / 3, 3 / 5, 4 / 3];

function getDisplayBrand(brand?: string | null, title?: string | null): string {
  if (!brand) return "FitMe";
  if (brand === title || brand.length > 30) {
    const match = brand.match(/^Buy\s+([A-Za-z0-9'&.-]+)/i);
    if (
      match &&
      match[1] &&
      !["the", "this", "a", "an", "women", "women's", "men", "men's"].includes(
        match[1].toLowerCase()
      )
    ) {
      return match[1];
    }
    return "FitMe";
  }
  return brand;
}

export default function Looks() {
  const [tab, setTab] = useState<TabType>("Generated");
  const [selectedPersonPhotoId, setSelectedPersonPhotoId] = useState<string | null>(null);
  const router = useRouter();

  const {
    generatedLooks,
    savedLooks,
    generatedLoadingMore,
    savedLoadingMore,
    loading,
    refreshing,
    fetchLooks,
    fetchNextPage,
    toggleSave,
    deleteLook,
    clearAll,
  } = useLooksStore();

  const { photos: savedPhotos, fetchPhotos: fetchSavedPhotos } = useSavedPhotosStore();

  useFocusEffect(
    useCallback(() => {
      fetchLooks(false);
      fetchSavedPhotos();
    }, [fetchLooks, fetchSavedPhotos])
  );

  const loadingMore = tab === "Saved" ? savedLoadingMore : generatedLoadingMore;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Trigger when user is within 400px of the bottom
    const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
    if (isCloseToBottom) {
      fetchNextPage(tab);
    }
  };

  const baseItems = tab === "Saved" ? savedLooks : generatedLooks;
  const items = selectedPersonPhotoId
    ? baseItems.filter((item) => item.saved_photo_id === selectedPersonPhotoId)
    : baseItems;

  const handleToggleSave = async (jobId: string) => {
    try {
      await toggleSave(jobId);
    } catch (err) {
      console.warn("Could not toggle save on look:", err);
    }
  };

  const handlePromptClearAll = () => {
    Alert.alert(
      "Clear all try-ons?",
      "This will remove all of your try-on history. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            try {
              await clearAll();
            } catch (err) {
              console.warn("Could not clear try-on history:", err);
              Alert.alert("Error", "Could not clear try-on history. Please try again.");
            }
          },
        },
      ]
    );
  };

  const handlePromptDeleteIndividual = (jobId: string) => {
    Alert.alert(
      "Delete this try-on?",
      "This will remove this try-on from your history. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteLook(jobId);
            } catch (err) {
              console.warn("Could not delete try-on item:", err);
              Alert.alert("Error", "Could not delete try-on. Please try again.");
            }
          },
        },
      ]
    );
  };

  const leftItems = items.filter((_, i) => i % 2 === 0);
  const rightItems = items.filter((_, i) => i % 2 === 1);

  const LookCard = ({ item, idx }: { item: TryOnHistoryItem; idx: number }) => {
    const imageUrl =
      item.thumbnail_url ||
      (item.result_image_urls && item.result_image_urls.length > 0
        ? item.result_image_urls[0]
        : "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400&q=80");

    const displayBrand = getDisplayBrand(item.brand, item.title);

    return (
      <Link href={{ pathname: "/result", params: { jobId: item.id } } as any} asChild>
        <TouchableOpacity
          style={styles.masonryCard}
          activeOpacity={0.85}
          onLongPress={() => handlePromptDeleteIndividual(item.id)}
          delayLongPress={400}
        >
          <CachedImage
            uri={imageUrl}
            style={[
              styles.masonryImg,
              { aspectRatio: 1 / ASPECTS[idx % ASPECTS.length] },
            ]}
          />
          <View style={styles.masonryInfo}>
            <Text style={styles.masonryTitle} numberOfLines={2}>
              {item.title || "Virtual Look"}
            </Text>
            <View style={styles.masonryMeta}>
              <Text style={styles.masonryBrand} numberOfLines={1}>{displayBrand}</Text>
              <TouchableOpacity
                onPress={() => handleToggleSave(item.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.is_saved ? "heart" : "heart-outline"}
                  size={15}
                  color={item.is_saved ? Colors.destructive : Colors.accent}
                />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Link>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="Your Looks"
        showBell
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
        onScroll={handleScroll}
        scrollEventThrottle={200}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchLooks(true)}
            tintColor={Colors.accent}
          />
        }
      >
        {/* Tab switcher */}
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

        {/* Person / Saved Photo Filter */}
        {savedPhotos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
            style={styles.filterContainer}
          >
            <TouchableOpacity
              style={[
                styles.filterChip,
                selectedPersonPhotoId === null && styles.filterChipActive,
              ]}
              onPress={() => setSelectedPersonPhotoId(null)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedPersonPhotoId === null && styles.filterChipTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>

            {savedPhotos.map((photo) => {
              const isSelected = selectedPersonPhotoId === photo.id;
              return (
                <TouchableOpacity
                  key={photo.id}
                  style={[
                    styles.filterChip,
                    isSelected && styles.filterChipActive,
                  ]}
                  onPress={() =>
                    setSelectedPersonPhotoId(isSelected ? null : photo.id)
                  }
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.filterChipTextActive,
                    ]}
                  >
                    {photo.display_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {loading && !refreshing ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#A86248" />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              name={tab === "Generated" ? "sync-outline" : "heart-outline"}
              size={28}
              color={Colors.accent}
              style={{ marginBottom: Spacing.md }}
            />
            <Text style={styles.emptyTitle}>
              {tab === "Generated"
                ? "Your first try-on will appear here"
                : "Saved looks will appear here"}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === "Generated"
                ? "Paste a product link to create your first look."
                : "Tap the heart on any look to save it."}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                tab === "Generated"
                  ? router.push("/(tabs)/home")
                  : setTab("Generated")
              }
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {tab === "Generated" ? "Start a try-on" : "Browse looks"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.masonry}>
            <View style={styles.col}>
              {leftItems.map((item, i) => (
                <LookCard key={item.id} item={item} idx={i * 2} />
              ))}
            </View>
            <View style={styles.col}>
              {rightItems.map((item, i) => (
                <LookCard key={item.id} item={item} idx={i * 2 + 1} />
              ))}
            </View>
          </View>
        )}

        {loadingMore && (
          <View style={styles.loadingMoreBox}>
            <ActivityIndicator size="small" color="#A86248" />
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

  loadingMoreBox: {
    paddingVertical: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },

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

  // Person filter chips
  filterContainer: { marginBottom: Spacing.lg },
  filterScroll: { gap: 8, paddingHorizontal: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    color: Colors.mutedForeground,
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: Colors.primaryForeground,
    fontWeight: "600",
  },

  loadingBox: { paddingVertical: 60, alignItems: "center", justifyContent: "center" },

  empty: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.xxl,
    alignItems: "center",
    marginTop: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTitle: {
    fontFamily: "serif",
    fontSize: 20,
    color: Colors.foreground,
    textAlign: "center",
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  primaryBtnText: { color: Colors.primaryForeground, fontSize: 14, fontWeight: "500" },

  masonry: { flexDirection: "row", gap: 10 },
  col: { flex: 1, gap: 10 },
  masonryCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  masonryImg: { width: "100%", resizeMode: "cover", backgroundColor: Colors.muted },
  masonryInfo: { padding: 10, paddingBottom: 12 },
  masonryTitle: { fontSize: 13, color: Colors.foreground, lineHeight: 18 },
  masonryMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 5,
  },
  masonryBrand: { fontSize: 11, color: Colors.mutedForeground },
});
