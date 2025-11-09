// src/lib/business/chatService.js
import {
  addDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  doc,
  getDocs,
  getDoc,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useUser } from "../auth/userContext";

/* ----------------- USER MESSAGES ----------------- */

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

export function subscribeToChatMessages(callback, hiveID, honeycombID) {
  const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));
  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(msgs);
  });
}

/* ----------------- THREADS ----------------- */

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

/* ----------------- AI REPLIES ----------------- */

export async function sendAIReply(text, hiveID, honeycombID) {
  const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  await addDoc(messagesRef, {
    text: `AI reply to: ${text}`,
    sender: "AI Bot",
    senderId: "AI",
    timestamp: new Date(),
  });
}

/* ----------------- UNREAD TRACKING ----------------- */

/**
 * Update "last seen" for Hive, Honeycomb, or Thread
 */
export async function updateLastSeen(hiveID, uid, honeycombID = null, messageID = null) {
  let ref;
  if (messageID) {
    ref = doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", messageID, "userStatus", uid);
  } else if (honeycombID) {
    ref = doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "userStatus", uid);
  } else {
    ref = doc(db, "Hive", hiveID, "userStatus", uid);
  }
  await setDoc(ref, { lastSeen: serverTimestamp() }, { merge: true });
}

/**
 * Check if a Honeycomb has unread messages for a user
 */
export async function checkHoneycombUnread(hiveID, honeycombID, uid) {
  const lastSeenDoc = await getDoc(doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "userStatus", uid));
  const lastSeen = lastSeenDoc.exists() ? lastSeenDoc.data().lastSeen?.toMillis?.() ?? 0 : 0;

  const msgsRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  const q = query(msgsRef, orderBy("timestamp", "desc"), limit(1));
  const snap = await getDocs(q);

  if (snap.empty) return false;
  const latest = snap.docs[0].data().timestamp?.toMillis?.() ?? 0;

  return latest > lastSeen;
}
