// src/lib/business/chatService.js
import { addDoc, collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { useUser } from "../auth/userContext";

/* ----------------- USER MESSAGES ----------------- */

/**
 * Hook to send a user message
 */
export function useSendUserMessage() {
  const { user } = useUser();

  const sendMessage = async (text, hiveID, honeycombID) => {
    if (!user) throw new Error("User not authenticated");
    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    await addDoc(messagesRef, {
      text,
      sender: user.displayName,
      senderId: user.uid,
      timestamp: new Date(),
    });
  };

  return sendMessage;
}

/**
 * Subscribe to main chat messages for a honeycomb
 */
export function subscribeToChatMessages(callback, hiveID, honeycombID) {
  const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));
  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(msgs);
  });
}

/* ----------------- THREADS ----------------- */

/**
 * Hook to send a thread reply under a specific message
 */
export function useSendThreadMessage() {
  const { user } = useUser();

  const sendThread = async (text, hiveID, honeycombID, parentMessageID) => {
    if (!user) throw new Error("User not authenticated");
    const threadRef = collection(
      db,
      "Hive",
      hiveID,
      "Honeycomb",
      honeycombID,
      "messages",
      parentMessageID,
      "Threads"
    );
    await addDoc(threadRef, {
      text,
      sender: user.displayName,
      senderId: user.uid,
      timestamp: new Date(),
      parentMessageId: parentMessageID,
    });
  };

  return sendThread;
}

/**
 * Subscribe to thread messages for a single parent message
 */
export function subscribeToThreadMessages(callback, hiveID, honeycombID, parentMessageID) {
  const threadRef = collection(
    db,
    "Hive",
    hiveID,
    "Honeycomb",
    honeycombID,
    "messages",
    parentMessageID,
    "Threads"
  );
  const q = query(threadRef, orderBy("timestamp", "asc"));
  return onSnapshot(q, (snapshot) => {
    const threads = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(threads);
  });
}

/* ----------------- AI REPLIES (existing) ----------------- */

export async function sendAIReply(text, hiveID, honeycombID) {
  // Placeholder AI function
  // Replace with your AI logic (e.g., call OpenAI or Gemini API)
  const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  await addDoc(messagesRef, {
    text: `AI reply to: ${text}`,
    sender: "AI Bot",
    senderId: "AI",
    timestamp: new Date(),
  });
}
