/**
 * Lightweight in-memory store for the import -> extraction -> processing -> result
 * wizard flow. Avoids serializing large product/image data through router params.
 * Not persisted — intentionally cleared on app restart.
 */
import { create } from 'zustand';
import type { NormalizedProduct } from './extraction';
import type { SavedPhoto } from './api';

type SessionState = {
  sourceUrl: string | null;
  productImageUri: string | null;
  productImageBase64: string | null;
  extractedProduct: NormalizedProduct | null;
  productId: string | null;
  garmentRegistrationPromise: Promise<{ product_id: string }> | null;
  userPhotoUploadPromise: Promise<SavedPhoto> | null;
  scanId: string | null;
  tryOnJobId: string | null;
  resultImageUrls: string[];
  localPhotoUri: string | null;
  savedPhotoId: string | null;
  savedPhotoName: string | null;

  setSourceUrl: (url: string | null) => void;
  setProductImageUri: (uri: string | null) => void;
  setProductImageBase64: (base64: string | null) => void;
  setExtractedProduct: (product: NormalizedProduct | null) => void;
  setProductId: (id: string) => void;
  setGarmentRegistrationPromise: (promise: Promise<{ product_id: string }> | null) => void;
  setUserPhotoUploadPromise: (promise: Promise<SavedPhoto> | null) => void;
  setScanId: (id: string | null) => void;
  setTryOnJobId: (id: string | null) => void;
  setResultImageUrls: (urls: string[]) => void;
  setLocalPhotoUri: (uri: string | null) => void;
  setSavedPhotoId: (id: string | null) => void;
  setSavedPhotoName: (name: string | null) => void;
  reset: () => void;
};

export const useSession = create<SessionState>((set) => ({
  sourceUrl: null,
  productImageUri: null,
  productImageBase64: null,
  extractedProduct: null,
  productId: null,
  garmentRegistrationPromise: null,
  userPhotoUploadPromise: null,
  scanId: null,
  tryOnJobId: null,
  resultImageUrls: [],
  localPhotoUri: null,
  savedPhotoId: null,
  savedPhotoName: null,

  setSourceUrl: (sourceUrl) => set({ sourceUrl }),
  setProductImageUri: (productImageUri) => set({ productImageUri }),
  setProductImageBase64: (productImageBase64) => set({ productImageBase64 }),
  setExtractedProduct: (extractedProduct) => set({ extractedProduct }),
  setProductId: (productId) => set({ productId }),
  setGarmentRegistrationPromise: (garmentRegistrationPromise) => set({ garmentRegistrationPromise }),
  setUserPhotoUploadPromise: (userPhotoUploadPromise) => set({ userPhotoUploadPromise }),
  setScanId: (scanId) => set({ scanId }),
  setTryOnJobId: (tryOnJobId) => set({ tryOnJobId }),
  setResultImageUrls: (resultImageUrls) => set({ resultImageUrls }),
  setLocalPhotoUri: (localPhotoUri) => set({ localPhotoUri }),
  setSavedPhotoId: (savedPhotoId) => set({ savedPhotoId }),
  setSavedPhotoName: (savedPhotoName) => set({ savedPhotoName }),
  reset: () =>
    set({
      sourceUrl: null,
      productImageUri: null,
      extractedProduct: null,
      productId: null,
      garmentRegistrationPromise: null,
      userPhotoUploadPromise: null,
      scanId: null,
      tryOnJobId: null,
      resultImageUrls: [],
      localPhotoUri: null,
      savedPhotoId: null,
      savedPhotoName: null,
    }),
}));
