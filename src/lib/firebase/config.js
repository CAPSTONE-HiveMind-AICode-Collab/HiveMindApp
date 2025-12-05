// src/lib/firebase/config.js
import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel} from "firebase/ai";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getPerformance } from "firebase/performance";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
export const firebaseApp = initializeApp(firebaseConfig);

// Firestore and Auth
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const provider = new GoogleAuthProvider();
export const storage = getStorage(firebaseApp);

// Initialize Performance Monitoring
let perf;
if (typeof window !== 'undefined') {
  perf = getPerformance(firebaseApp);
}
export const performance = perf;

// Initialize App Check (bot protection)
let appCheck;
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY) {
  try {
    appCheck = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY),
      isTokenAutoRefreshEnabled: true
    });
    console.log('App Check initialized');
  } catch (error) {
    console.warn('App Check initialization failed:', error);
  }
}
export const appCheckInstance = appCheck;

// Initialize AI
export const ai = getAI(firebaseApp);
export const model = getGenerativeModel(ai, { model: "gemini-2.5-flash-lite"})

