import { initializeApp } from 'firebase/app';
// @ts-ignore - getReactNativePersistence is exported by the React Native runtime bundle of firebase/auth
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { firebaseConfig } from './config';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Auth once, with React Native AsyncStorage persistence.
// Do NOT call getAuth(app) separately — that would double-initialize and throw auth/already-initialized.
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export { app, auth };
