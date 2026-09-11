// src/firebase/types.ts

export interface FirebaseUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

export interface BackendTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: any; // keep generic; backend returns user info
}
