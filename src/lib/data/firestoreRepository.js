// src/lib/data/firestoreRepository.js
import { db } from "../firebase/config";
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

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
