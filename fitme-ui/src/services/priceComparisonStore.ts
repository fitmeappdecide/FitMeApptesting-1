import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecentItemsRepository } from '../repositories/RecentItemsRepository';
import { DatabaseManager } from '../repositories/DatabaseManager';
import { productIntelligenceApi } from './api';

export interface StoredComparisonCandidate {
  id: string;
  platform: string;
  price: string;
  numericPrice: number;
  originalPrice?: string;
  discount?: string;
  deliveryNote?: string;
  url?: string;
  imageUrl?: string;
}

export interface StoredPriceComparison {
  id: string;
  scan_id?: string;
  job_id?: string;
  title: string;
  brand?: string;
  garment_image_url: string; // Extracted garment photo (never on-model)
  best_price?: number | null;
  best_retailer?: string | null;
  candidates: StoredComparisonCandidate[];
  created_at: number;
  is_saved?: boolean;
}

interface PriceComparisonState {
  comparisons: StoredPriceComparison[];
  addComparison: (item: StoredPriceComparison) => Promise<void>;
  clearAll: () => Promise<void>;
  deleteComparison: (id: string) => Promise<void>;
  toggleSave: (id: string) => Promise<void>;
  getComparison: (idOrScanId: string) => StoredPriceComparison | undefined;
}

export const usePriceComparisonStore = create<PriceComparisonState>()(
  persist(
    (set, get) => ({
      comparisons: [],

      toggleSave: async (id: string) => {
        const current = get().comparisons;
        const updated = current.map((c) =>
          c.id === id || c.scan_id === id || c.job_id === id
            ? { ...c, is_saved: !c.is_saved }
            : c
        );
        set({ comparisons: updated });
      },

      addComparison: async (item: StoredPriceComparison) => {
        const current = get().comparisons;
        // Deduplicate: remove existing comparison with matching id, job_id, or scan_id
        const filtered = current.filter(
          (c) =>
            c.id !== item.id &&
            (!item.job_id || c.job_id !== item.job_id) &&
            (!item.scan_id || c.scan_id !== item.scan_id)
        );

        const updated = [item, ...filtered].slice(0, 20);
        set({ comparisons: updated });

        // Sync with SQLite recent_items if database is available
        try {
          if (DatabaseManager.isDatabaseOpen()) {
            await RecentItemsRepository.saveRecentItem(
              item.id,
              'price_comparison',
              item,
              item.created_at
            );
          }
        } catch (dbErr) {
          console.warn('[PriceComparisonStore] SQLite write warning:', dbErr);
        }
      },

      clearAll: async () => {
        set({ comparisons: [] });
        try {
          await AsyncStorage.removeItem('fitme_home_recent_comparisons');
        } catch (_) {}

        try {
          if (DatabaseManager.isDatabaseOpen()) {
            await RecentItemsRepository.clearRecentItems('price_comparison');
          }
        } catch (_) {}

        // Also clean up remote product intelligence history
        try {
          await productIntelligenceApi.clearAllHistory();
        } catch (_) {}
      },

      deleteComparison: async (id: string) => {
        const current = get().comparisons;
        const updated = current.filter((c) => c.id !== id && c.job_id !== id && c.scan_id !== id);
        set({ comparisons: updated });

        try {
          if (DatabaseManager.isDatabaseOpen()) {
            await RecentItemsRepository.deleteRecentItem(id);
          }
        } catch (_) {}
      },

      getComparison: (idOrScanId: string) => {
        if (!idOrScanId) return undefined;
        return get().comparisons.find(
          (c) =>
            c.id === idOrScanId ||
            c.job_id === idOrScanId ||
            c.scan_id === idOrScanId
        );
      },
    }),
    {
      name: 'fitme_price_comparison_store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
