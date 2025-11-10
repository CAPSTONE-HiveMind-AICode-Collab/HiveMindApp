// src/lib/business/notificationService.js
import { db } from "../firebase/config";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  updateDoc,
  doc,
  where,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

import {
  addNotificationToDB,
  getNotificationsFromDB,
  updateNotificationRead,
} from "@/lib/data/firestoreRepository";

/* --------------------- CORE NOTIFICATION LOGIC --------------------- */

/**
 * Create a notification object
 */
function createNotification({ type, hiveID, honeycombID, threadID, message, notifyAt = null }) {
  return {
    type,
    hiveID: hiveID || null,
    honeycombID: honeycombID || null,
    threadID: threadID || null,
    message: message || "(no message)",
    notifyAt: notifyAt || null,
    timestamp: serverTimestamp(), // ✅ Use Firestore timestamp
    read: false,
  };
}

/**
 * Send a notification to multiple users
 */
export async function notifyUsers(userIDs, notificationData) {
  const notification = createNotification(notificationData);
  for (const userID of userIDs) {
    if (!userID) continue;
    const userNotifRef = collection(db, "Users", userID, "notifications");
    await addDoc(userNotifRef, notification);
  }
}

/**
 * Notify when a thread is closed
 */
export async function notifyThreadClosed(hiveID, honeycombID, threadID) {
  // Fetch thread participants
  const threadRef = doc(db, "Threads", threadID);
  const threadSnap = await getDoc(threadRef);

  if (!threadSnap.exists()) {
    console.error("Thread not found:", threadID);
    return;
  }

  const threadData = threadSnap.data();
  const userIDs = threadData.participants || [];

  if (userIDs.length === 0) {
    console.warn("No participants to notify for thread:", threadID);
    return;
  }

  const message = `Thread ${threadID} in Honeycomb ${honeycombID} has been closed.`;
  console.log("notifyThreadClosed -> sending to userIDs:", userIDs);

  await notifyUsers(userIDs, { type: "THREAD_CLOSED", hiveID, honeycombID, threadID, message });
}

/**
 * Notify when a thread is updated (new message, status change)
 */
export async function notifyThreadUpdated(hiveID, honeycombID, threadID, userIDs, updateInfo) {
  const message = `Thread ${threadID} updated: ${updateInfo}`;
  await notifyUsers(userIDs, { type: "THREAD_UPDATED", hiveID, honeycombID, threadID, message });
}

/**
 * Notify multiple threads at once
 */
export async function notifyMultipleThreads(threadNotifications) {
  for (const tn of threadNotifications) {
    await notifyUsers(tn.userIDs, {
      type: tn.type,
      hiveID: tn.hiveID,
      honeycombID: tn.honeycombID,
      threadID: tn.threadID,
      message: tn.message,
      notifyAt: tn.notifyAt || null,
    });
  }
}

/**
 * Schedule a time-based notification
 * Relies on client-side polling instead of Cloud Functions
 */
export async function scheduleTimeBasedNotification(
  hiveID,
  honeycombID,
  threadID,
  userIDs,
  message,
  notifyAt,
  type = "TIME_BASED"
) {
  const notification = createNotification({
    type,          // use the passed type
    hiveID,
    honeycombID,
    threadID,
    message,
    notifyAt,
  });

  for (const userID of userIDs) {
    const userNotifRef = collection(db, "Users", userID, "notifications");
    await addDoc(userNotifRef, notification);
  }
}


/* --------------------- CLIENT-SIDE LISTENERS --------------------- */

/**
 * Listen to *all* notifications for a user in real-time.
 */
export function listenToNotifications(userID, callback) {
  if (!userID) return () => {};

  const notificationsRef = collection(db, "Users", userID, "notifications");
  const q = query(notificationsRef, orderBy("timestamp", "desc")); // ✅ newest first

  return onSnapshot(q, (snapshot) => {
    const notifications = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  
    // 🔹 Debug log
    console.log("Notifications fetched for user:", userID, notifications);

    // ✅ Sort by timestamp just in case
    const sorted = notifications.sort((a, b) => {
      const tA = a.timestamp?.toDate?.() ?? new Date(0);
      const tB = b.timestamp?.toDate?.() ?? new Date(0);
      return tB - tA;
    });

    callback(sorted);
  });
}



/**
 * Poll for *only* due time-based notifications (used for triggering events).
 */
export async function pollTimeBasedNotifications(userID) {
  if (!userID) return [];

  const allNotifications = await getNotificationsFromDB(userID);
  const now = new Date();

  // ✅ Only return due TIME_BASED notifications for triggering (not for display)
  return allNotifications.filter(
    (notif) =>
      notif.type === "TIME_BASED" &&
      notif.notifyAt &&
      new Date(notif.notifyAt) <= now &&
      !notif.read
  );
}


/**
 * Mark a notification as read
 */
export async function markNotificationRead(userID, notificationID) {
  await updateNotificationRead(userID, notificationID, true);
}
