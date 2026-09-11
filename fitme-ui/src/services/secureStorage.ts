// src/services/secureStorage.ts

import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'fitme_access_token';
const REFRESH_TOKEN_KEY = 'fitme_refresh_token';

/** Save both access and refresh tokens securely */
export const saveTokens = async (access: string, refresh: string): Promise<void> => {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
};

/** Retrieve stored access token */
export const getStoredAccessToken = async (): Promise<string | null> => {
  return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
};

/** Retrieve stored refresh token */
export const getStoredRefreshToken = async (): Promise<string | null> => {
  return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
};

/** Clear both tokens from SecureStore */
export const clearTokens = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
};
