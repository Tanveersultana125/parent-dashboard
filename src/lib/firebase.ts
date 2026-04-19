import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

/**
 * authDomain selection:
 * - In production we use the *current* hostname so the OAuth handler
 *   (`/__/auth/handler`) is served same-origin via Vercel rewrites. This sidesteps
 *   iOS Safari ITP partitioning that otherwise drops the auth state when
 *   redirecting through `<project>.firebaseapp.com`.
 * - Locally / preview builds keep the configured firebaseapp.com domain (which
 *   is on Firebase's allowlist for localhost) since we don't have rewrites in dev.
 */
function resolveAuthDomain(): string {
  const fallback = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string;
  if (typeof window === "undefined") return fallback;
  const host = window.location.hostname;
  if (!host) return fallback;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return fallback;
  }
  return window.location.host; // includes port if non-default
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

if (typeof window !== "undefined" && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn("[AppCheck] init failed:", err);
  }
}

// indexedDB-first so iOS standalone PWA keeps the session across cold-starts.
// (browserLocalPersistence is unreliable on iOS standalone; sessionPersistence is the last-ditch fallback.)
export const auth = initializeAuth(app, {
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
  ],
});
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export default app;