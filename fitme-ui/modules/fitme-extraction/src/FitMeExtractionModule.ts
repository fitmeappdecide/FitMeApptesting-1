import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';

export interface Product {
  title: string;
  brand: string;
  price: string;
  originalPrice?: string;
  imageUrl?: string;
  imageUrls: string[];
}

// It loads the native module object from the JSI or falls back to
// the bridge module (from NativeModulesProxy) if the remote debugger is on.
const FitMeExtraction = requireNativeModule('FitMeExtraction');

const emitter = new EventEmitter(FitMeExtraction);

export async function extractProduct(url: string): Promise<Product> {
  return await FitMeExtraction.extractProduct(url);
}

export function addExtractionProgressListener(listener: (event: { progress: number }) => void): Subscription {
  return emitter.addListener('extractionProgress', listener);
}

export async function shareImageWithText(imagePath: string, message: string, dialogTitle: string = 'Share your look'): Promise<boolean> {
  return await FitMeExtraction.shareImageWithText(imagePath, message, dialogTitle);
}
