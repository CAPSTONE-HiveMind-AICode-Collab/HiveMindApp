// src/lib/data/firestoreRepository.js
import { db } from "../firebase/config";
import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp,
    getDocs,
    doc,
    updateDoc,
    where,
    deleteDoc,
} from "firebase/firestore";

/**
 * -----------------------------
 * Messages (existing functions)
 * -----------------------------
 */

/**
 * Add a message to a specific Hive/Honeycomb
 */
export async function addMessageToDB(message, hiveID, honeycombID) {
    if (!hiveID || !honeycombID) {
        throw new Error("hiveID and honeycombID are required");
    }

    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    return addDoc(messagesRef, {
        ...message,
        timestamp: serverTimestamp(),
    });
}

/**
 * Listen to messages in a specific Hive/Honeycomb
 */
export function listenToMessages(callback, hiveID, honeycombID) {
    if (!hiveID || !honeycombID) {
        throw new Error("hiveID and honeycombID are required");
    }

    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    return onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
        callback(messages);
    });
}

/**
 * -----------------------------
 * Notifications (new functions)
 * -----------------------------
 */

/**
 * Add a notification to a specific user
 */
export async function addNotificationToDB(userID, notification) {
    if (!userID) throw new Error("userID is required");

    const notifRef = collection(db, "Users", userID, "notifications");
    return addDoc(notifRef, {
        ...notification,
        timestamp: serverTimestamp(),
    });
}

export async function getNotificationsFromDB(userID) {
  if (!userID) throw new Error("userID is required");

  const notifRef = collection(db, "Users", userID, "notifications");
  const q = query(notifRef, orderBy("timestamp", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(),
    };
  });
}


/**
 * Mark a notification as read
 */
export async function updateNotificationRead(userID, notificationID, read = true) {
    if (!userID || !notificationID) throw new Error("userID and notificationID are required");

    const notifDoc = doc(db, "Users", userID, "notifications", notificationID);
    return updateDoc(notifDoc, { read });
}

/**
 * Optional: Listen to real-time notifications for a user
 */
export function listenToNotifications(userID, callback) {
    if (!userID) throw new Error("userID is required");

    const notifRef = collection(db, "Users", userID, "notifications");
    const q = query(notifRef, orderBy("timestamp", "asc"));
    return onSnapshot(q, (snapshot) => {
        const notifications = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
        callback(notifications);
    });
}

/**
 * -----------------------------
 * Thread Management Helpers
 * -----------------------------
 */

/**
 * Update the status of a thread (e.g., "open" → "closed")
 */
export async function updateThreadStatus(hiveID, honeycombID, parentMessageID, threadID, status) {
  if (!hiveID || !honeycombID || !parentMessageID || !threadID)
    throw new Error("Missing required IDs for updateThreadStatus");

  const threadRef = doc(
    db,
    "Hive",
    hiveID,
    "Honeycomb",
    honeycombID,
    "messages",
    parentMessageID,
    "Threads",
    threadID
  );
  await updateDoc(threadRef, { status });
}

/**
 * Get all unique participants in a thread
 */
export async function getThreadParticipants(hiveID, honeycombID, parentMessageID, threadID) {
  if (!hiveID || !honeycombID || !parentMessageID || !threadID)
    throw new Error("Missing required IDs for getThreadParticipants");

  const threadMessagesRef = collection(
    db,
    "Hive",
    hiveID,
    "Honeycomb",
    honeycombID,
    "messages",
    parentMessageID,
    "Threads"
  );

  const snapshot = await getDocs(threadMessagesRef);
  const participants = new Set();

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.senderId) participants.add(data.senderId);
  });

  return Array.from(participants);
}


export async function deleteNotification(userID, notificationID) {
  if (!userID || !notificationID) return;
  const notifRef = doc(db, "Users", userID, "notifications", notificationID);
  await deleteDoc(notifRef);
}