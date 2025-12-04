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
  where,
} from "firebase/firestore";
import { db, model } from "@/lib/firebase/config"; 
import { useUser } from "../auth/userContext";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { updateThreadStatus, getThreadParticipants } from "@/lib/data/firestoreRepository";
import { scheduleTimeBasedNotification, notifyUsers } from "@/lib/business/notificationService";
import { isToxicMessage } from "@/lib/business/ToxicityService";
/* ----------------- Notifications -----------------*/


/* ----------------- USER MESSAGES ----------------- */
export function useSendUserMessage() {
  const { user } = useUser();

  const sendMessage = async (text, hiveID, honeycombID) => {
    if (!user) throw new Error("User not authenticated");

    // 1️⃣ Local Tensor model toxicity check
    const toxic = await isToxicMessage(text);
    if (toxic) {
       alert("Your message appears toxic — please revise and try again.");
       return;
    }

    // 2️⃣ Save to Firestore normally
    const messagesRef = collection(
      db, "Hive", hiveID, "Honeycomb", honeycombID, "messages"
    );

    await addDoc(messagesRef, {
      text,
      sender: user.displayName,
      senderId: user.uid,
      timestamp: serverTimestamp(),
    });
  };

  return sendMessage;
}



/*
export function useSendUserMessage() {
  const { user } = useUser();

  const sendMessage = async (text, hiveID, honeycombID, allUserIds = []) => {
    if (!user) throw new Error("User not authenticated");

    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    const msgRef = await addDoc(messagesRef, {
      text,
      sender: user.displayName,
      senderId: user.uid,
      timestamp: serverTimestamp(),
    });

    // Initialize userStatus for all users (except sender)
    allUserIds.forEach(async (uid) => {
      if (uid === user.uid) return;
      const statusRef = doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", msgRef.id, "userStatus", uid);
      await setDoc(statusRef, { lastSeen: null });
    });
  };

  return sendMessage;
}*/

export function subscribeToChatMessages(callback, hiveID, honeycombID) {
  const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));
  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(msgs);
  });
}

/* ----------------- THREADS ----------------- */
/*
export function useSendThreadMessage() {
  const { user } = useUser();

  const sendThread = async (text, hiveID, honeycombID, parentMessageID, allUserIds = []) => {
    if (!user) throw new Error("User not authenticated");

    const threadRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", parentMessageID, "Threads");
    const msgRef = await addDoc(threadRef, {
      text,
      sender: user.displayName,
      senderId: user.uid,
      timestamp: serverTimestamp(),
      parentMessageId: parentMessageID,
    });

    // Initialize userStatus for all users (except sender)
    allUserIds.forEach(async (uid) => {
      if (uid === user.uid) return;
      const statusRef = doc(
        db,
        "Hive",
        hiveID,
        "Honeycomb",
        honeycombID,
        "messages",
        parentMessageID,
        "Threads",
        msgRef.id,
        "userStatus",
        uid
      );
      await setDoc(statusRef, { lastSeen: null });
    });
  };

  return sendThread;
}
  */

export function useSendThreadMessage() {
  const { user } = useUser();

  const sendThreadMessage = async (text, hiveID, honeycombID, parentMessageID) => {
    if (!user) throw new Error("User not authenticated");

    // 1️⃣ Tensor toxicity model
    const toxic = await isToxicMessage(text);
    if (toxic) {
       alert("Your message appears toxic — please revise and try again.");
       return;
    }

    // 2️⃣ Add reply normally
    const ref = collection(
      db, "Hive", hiveID, "Honeycomb", honeycombID, "messages",
      parentMessageID, "Threads"
    );

    await addDoc(ref, {
      text,
      sender: user.displayName,
      senderId: user.uid,
      timestamp: serverTimestamp(),
      parentMessageId: parentMessageID,
    });
  };

  return sendThreadMessage;
}

export function subscribeToThreadMessages(callback, hiveID, honeycombID, parentMessageID) {
  const threadRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", parentMessageID, "Threads");
  const q = query(threadRef, orderBy("timestamp", "asc"));
  return onSnapshot(q, (snapshot) => {
    const threads = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data(), status: doc.data().status || "open" }));
    callback(threads);
  });
}


/* ----------------- AI REPLIES ----------------- */

export async function sendAIReply(text, hiveID, honeycombID) {
  try {
    // Call your Gemini AI model
    const aiResponse = await callGeminiAPI(text); // or call directly via model if you want

    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    await addDoc(messagesRef, {
      text: aiResponse, // save the actual AI reply
      sender: "AI Bot",
      senderId: "AI",
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to send AI reply:", error);

    // Optional fallback message
    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    await addDoc(messagesRef, {
      text: "AI could not generate a response.",
      sender: "AI Bot",
      senderId: "AI",
      timestamp: serverTimestamp(),
    });
  }
}

/* ----------------- UNREAD TRACKING ----------------- */

/**
 * Update "last seen"
 * - Hive: updateLastSeen(hiveID, null, null, uid)
 * - Honeycomb: updateLastSeen(hiveID, honeycombID, null, uid)
 * - Thread: updateLastSeen(hiveID, honeycombID, messageID, uid)
 */
export async function updateLastSeen(hiveID, honeycombID = null, messageID = null, uid) {
  if (!hiveID) throw new Error("updateLastSeen: hiveID is required");
  if (!uid) throw new Error("updateLastSeen: uid is required");

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
 * Get "last seen" timestamp in ms
 */
export async function getLastSeen(hiveID, honeycombID = null, messageID = null, uid) {
  if (!hiveID || !uid) throw new Error("getLastSeen: hiveID and uid required");

  let ref;
  if (messageID) {
    ref = doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", messageID, "userStatus", uid);
  } else if (honeycombID) {
    ref = doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "userStatus", uid);
  } else {
    ref = doc(db, "Hive", hiveID, "userStatus", uid);
  }

  const snap = await getDoc(ref);
  const lastSeen = snap.exists() ? snap.data()?.lastSeen : null;
  return lastSeen?.toMillis?.() ?? 0; // default 0 if never opened
}

/**
 * Get latest message timestamp for a honeycomb or thread
 */
export async function getLatestMessageTimestamp(hiveID, honeycombID, parentMessageID = null) {
  if (!hiveID || !honeycombID) return 0;

  let ref;
  if (parentMessageID) {
    ref = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", parentMessageID, "Threads");
  } else {
    ref = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  }

  const q = query(ref, orderBy("timestamp", "desc"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  const latest = snap.docs[0].data().timestamp;
  return latest?.toMillis?.() ?? 0;
}

/**
 * Return unread message count in Honeycomb or Thread
 */
export async function getUnreadCount(hiveID, honeycombID, uid, parentMessageID = null) {
  const lastSeenMs = await getLastSeen(hiveID, honeycombID, parentMessageID, uid);

  let ref;
  if (parentMessageID) {
    ref = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", parentMessageID, "Threads");
  } else {
    ref = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
  }

  const q = query(ref, where("timestamp", ">", new Date(lastSeenMs)));
  const snap = await getDocs(q);
  return snap.size;
}

/**
 * Check if Honeycomb has unread messages (returns count)
 */
export async function checkHoneycombUnread(hiveID, honeycombID, uid) {
  const count = await getUnreadCount(hiveID, honeycombID, uid);
  return count > 0 ? count : 0;
}

/**
 * Get unread count for a thread
 */
export async function getThreadUnreadCount(hiveID, honeycombID, messageID, uid) {
  if (!hiveID || !honeycombID || !messageID || !uid) return 0;
  return await getUnreadCount(hiveID, honeycombID, uid, messageID);
}

/**
 * Get unread count for a honeycomb
 */
export async function getHoneycombUnreadCount(hiveID, honeycombID, uid) {
  return await getUnreadCount(hiveID, honeycombID, uid);
}

/**
 * Get all unread counts for honeycombs in a hive
 */
export async function getAllUnreadCounts(hiveID, uid) {
  if (!uid) return {};
  const honeycombRef = collection(db, "Hive", hiveID, "Honeycomb");
  const honeycombSnapshot = await getDocs(honeycombRef);

  const countsPromises = honeycombSnapshot.docs.map(async (docSnap) => {
    const honeycombID = docSnap.id;
    const count = await getHoneycombUnreadCount(hiveID, honeycombID, uid);
    return [honeycombID, count];
  });

  const results = await Promise.all(countsPromises);
  return Object.fromEntries(results);
}

export async function setThreadStatus(hiveID, honeycombID, parentMessageID, threadID, status) {
  if (!["open", "closed"].includes(status)) throw new Error("Invalid status");
  const threadRef = doc(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", parentMessageID, "Threads", threadID);
  await setDoc(threadRef, { status }, { merge: true });
}

/* ----------------- THREAD CLOSING + NOTIFICATIONS ----------------- */

/**
 * Close a thread and notify all participants immediately
 */
export async function closeThreadAndNotify(
  hiveID,
  honeycombID,
  parentMessageID,
  threadID,
  closedByUser
) {
  try {
    // 1️⃣ Update thread status to "closed"
    await updateThreadStatus(hiveID, honeycombID, parentMessageID, threadID, "closed");

    // 2️⃣ Get participants
    const participants = await getThreadParticipants(hiveID, honeycombID, parentMessageID, threadID);

    if (!participants || participants.length === 0) {
      console.warn("⚠️ No participants found for thread:", threadID);
      return;
    }

    // 3️⃣ Extract UIDs only (avoid object vs string issues)
    const userIDs = participants
      .map((p) => (typeof p === "string" ? p : p?.uid))
      .filter(Boolean);

    if (userIDs.length === 0) {
      console.warn("⚠️ No valid user IDs to notify for thread:", threadID);
      return;
    }

    // 4️⃣ Build notification message
    const message = `Thread "${threadID}" was closed by ${closedByUser?.displayName || "a user"}.`;

    // 5️⃣ Notify all participants immediately
    await notifyUsers(userIDs, {
      type: "THREAD_CLOSED",
      hiveID,
      honeycombID,
      threadID,
      message,
      notifyAt: null, // Not time-based; show immediately
    });

    console.log(`✅ THREAD_CLOSED notifications sent to:`, userIDs);

  } catch (error) {
    console.error("❌ Failed to close thread and notify participants:", error);
  }
}