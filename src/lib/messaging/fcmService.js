import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { firebaseApp } from "@/lib/firebase/config";

let messaging = null;

// Initialize messaging (only in browser)
if (typeof window !== "undefined") {
  try {
    messaging = getMessaging(firebaseApp);
  } catch (error) {
    console.warn("Firebase Messaging not supported in this browser:", error);
  }
}

/**
 * Request notification permission and get FCM token
 * @returns {Promise<string|null>} FCM token or null if permission denied
 */
export async function requestNotificationPermission() {
  if (!messaging) {
    console.warn("Messaging not initialized");
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    
    if (permission === "granted") {
      console.log("Notification permission granted");

      // Get FCM token
      const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      });

      console.log("FCM Token:", token);
      return token;
    } else {
      console.log("Notification permission denied");
      return null;
    }
  } catch (error) {
    console.error("Error getting notification permission:", error);
    return null;
  }
}

/**
 * Listen to foreground messages
 * @param {Function} callback - Called with message payload
 */
export function onMessageListener(callback) {
  if (!messaging) {
    console.warn("Messaging not initialized");
    return () => {};
  }

  return onMessage(messaging, (payload) => {
    console.log("Foreground message received:", payload);
    
    // Show browser notification
    if (payload.notification) {
      const { title, body, icon } = payload.notification;
      
      if (Notification.permission === "granted") {
        new Notification(title || "HiveMind Notification", {
          body: body || "",
          icon: icon || "/logo.png",
          badge: "/badge.png",
          tag: payload.data?.hiveID || "default",
          requireInteraction: false,
        });
      }
    }

    // Call custom callback
    if (callback) {
      callback(payload);
    }
  });
}

/**
 * Save FCM token to Firestore for user
 * @param {string} userId - User ID
 * @param {string} token - FCM token
 */
export async function saveFCMToken(userId, token) {
  if (!userId || !token) return;

  try {
    const { db } = await import("@/lib/firebase/config");
    const { doc, setDoc } = await import("firebase/firestore");

    await setDoc(
      doc(db, "Users", userId),
      {
        fcmToken: token,
        fcmTokenUpdatedAt: new Date(),
      },
      { merge: true }
    );

    console.log("FCM token saved to Firestore");
  } catch (error) {
    console.error("Failed to save FCM token:", error);
  }
}

/**
 * Check if notifications are supported and enabled
 * @returns {boolean}
 */
export function isNotificationSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    messaging !== null
  );
}

/**
 * Get current notification permission status
 * @returns {NotificationPermission}
 */
export function getNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  return Notification.permission;
}
