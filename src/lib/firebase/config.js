import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getPerformance } from "firebase/performance";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";


import { getAI, getGenerativeModel } from "firebase/ai";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const provider = new GoogleAuthProvider();


export const db = getFirestore(firebaseApp);

export const storage = getStorage(firebaseApp);

// Performance (client-only)
export const performance =
  typeof window !== "undefined" ? getPerformance(firebaseApp) : null;

// App Check (client-only)
export const appCheckInstance =
  typeof window !== "undefined" && process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY
    ? initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY),
        isTokenAutoRefreshEnabled: true,
      })
    : null;


export const ai = (() => {
  try {
    return getAI(firebaseApp);
  } catch {
    return null;
  }
})();

export const model = ai
  ? getGenerativeModel(ai, { model: "gemini-2.5-flash-lite" })
  : null;
