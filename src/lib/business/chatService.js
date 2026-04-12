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

import { db } from "@/lib/firebase/config"; //  removed model import
import { useUser } from "../auth/userContext";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { updateThreadStatus, getThreadParticipants } from "@/lib/data/firestoreRepository";
import { scheduleTimeBasedNotification, notifyUsers } from "@/lib/business/notificationService";
import { generateAndStoreThreadSummary } from "@/lib/data/summaryRepository";
import { generateAndStoreDecisionRecordForThread } from "@/lib/data/decisionRepository";
import { touchHiveLastActive } from "@/lib/data/hiveRepository";
import { NectarRepository } from "@/lib/data/nectarRepository";
import { isToxicMessage, getToxicityDetails } from "@/lib/business/ToxicityService";
/* ----------------- Notifications -----------------*/

/* ----------------- Helpers ----------------- */

const asId = (value, name) => {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return String(value);
};

const normalizeUserIds = (allUserIds) =>
  Array.isArray(allUserIds)
    ? allUserIds.map((x) => (typeof x === "string" ? x : x?.uid)).filter(Boolean).map(String)
    : [];

const normalizeAttachment = (attachment) => {
  if (!attachment) return null;

  const arr = Array.isArray(attachment) ? attachment : [attachment];

  const normalized = arr
    .filter(Boolean)
    .map((a) => ({
      name: a?.name || "",
      size: a?.size || 0,
      contentType: a?.contentType || "application/octet-stream",
      url: a?.url || "",
      storagePath: a?.storagePath || "",
      uploadedAt: a?.uploadedAt || null,

      text: a?.text || null,
      extractedText: a?.extractedText || null,
      imageDescription: a?.imageDescription || null,

      rawCaption: a?.rawCaption || null,
      captionRisk: a?.captionRisk || null,
      captionNotes: Array.isArray(a?.captionNotes) ? a.captionNotes : [],

      extractionMethod: a?.extractionMethod || null,
      extractionStatus: a?.extractionStatus || null,
      extractionError: a?.extractionError || null,
      isDocumentLike: !!a?.isDocumentLike,
      ocrConfidence: a?.ocrConfidence ?? null,
    }));

  return normalized.length > 0 ? normalized : null;
};

  export function useSendUserMessage() {
    const { user } = useUser();

    const sendMessage = async (
      text,
      hiveID,
      honeycombID,
      allUserIds = [],
      attachment = null
    ) => {
      if (!user) throw new Error("User not authenticated");

      const cleanedText = String(text || "").trim();
      const normalized = normalizeAttachment(attachment);
      const hasAttachments = Array.isArray(normalized) && normalized.length > 0;

    // Toxicity check only when there is text to analyze
    if (cleanedText) {
      const toxic = await isToxicMessage(cleanedText);
      if (toxic) {
        // Get detailed label breakdown so the user understands what was flagged
        const details = await getToxicityDetails(cleanedText);
        const flagged = details
          .filter((d) => d.match)
          .map((d) => d.label.replace(/_/g, " "))
          .join(", ");
        alert(
          `Your message was blocked by the content safety filter.\n\nFlagged category: ${flagged || "toxicity"}.\n\nPlease revise your message and try again.`
        );
        return;
      }
    }

      if (!cleanedText && !hasAttachments) return;

      const messagesRef = collection(
        db,
        "Hive",
        String(hiveID),
        "Honeycomb",
        String(honeycombID),
        "messages"
      );

      console.log("ATTACHMENT RECEIVED IN chatService", normalized);

      const msgRef = await addDoc(messagesRef, {
        type: hasAttachments ? "file" : "text",
        text: cleanedText,
        attachment: normalized,
        sender: user.displayName || user.email || "User",
        senderId: user.uid,
        timestamp: serverTimestamp(),
      });

    //initialize userStatus docs for all users (except sender)
    const ids = normalizeUserIds(allUserIds);
    await Promise.all(
      ids
        .filter((uid) => uid && uid !== user.uid)
        .map((uid) =>
          setDoc(
            doc(
              db,
              "Hive",
              String(hiveID),
              "Honeycomb",
              String(honeycombID),
              "messages",
              msgRef.id,
              "userStatus",
              String(uid)
            ),
            { lastSeen: null },
            { merge: true }
          )
        )
    );

    await touchHiveLastActive(hiveID);

      return msgRef.id;
    };

    return sendMessage;
  }


/*
export function useSendUserMessage() {
  const { user } = useUser();

  const sendMessage = async (text, hiveID, honeycombID, allUserIds = [], attachment = null) => {
    if (!user) throw new Error("User not authenticated");

    const hid = asId(hiveID, "hiveID");
    const cid = asId(honeycombID, "honeycombID");

    const messagesRef = collection(db, "Hive", hid, "Honeycomb", cid, "messages");

    const normalized = normalizeAttachment(attachment);

    const msgRef = await addDoc(messagesRef, {
      type: normalized ? "file" : "text",
      text: text || "",
      attachment: normalized, // ✅ always array or null
      sender: user.displayName || user.email || "User",
      senderId: user.uid,
      timestamp: serverTimestamp(),
    });

    // Initialize userStatus for all users (except sender)
    const ids = normalizeUserIds(allUserIds);
    ids.forEach(async (uid) => {
      if (uid === user.uid) return;

      const statusRef = doc(
        db,
        "Hive",
        hid,
        "Honeycomb",
        cid,
        "messages",
        msgRef.id,
        "userStatus",
        uid
      );

      await setDoc(statusRef, { lastSeen: null });
    });

    return msgRef.id;
  };

  return sendMessage;
}*/

export function subscribeToChatMessages(callback, hiveID, honeycombID) {
  if (!hiveID || !honeycombID) {
    console.warn("subscribeToChatMessages missing IDs:", { hiveID, honeycombID });
    return () => {};
  }

  const hid = String(hiveID);
  const cid = String(honeycombID);

  const messagesRef = collection(db, "Hive", hid, "Honeycomb", cid, "messages");
  const q = query(messagesRef, orderBy("timestamp", "asc"));

  return onSnapshot(
    q,
    (snapshot) => {
      const msgs = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      callback(msgs);
    },
    (error) => {
      console.error("subscribeToChatMessages failed:", error);
    }
  );
}
/**
 * Load older messages for pagination
 * Returns messages older than the oldest current message
 */
export async function loadOlderMessages(
  hiveID,
  honeycombID,
  oldestTimestamp,
  messageLimit = 50
) {
  const messagesRef = collection(
    db,
    "Hive",
    String(hiveID),
    "Honeycomb",
    String(honeycombID),
    "messages"
  );

  const q = query(
    messagesRef,
    orderBy("timestamp", "desc"),
    where("timestamp", "<", oldestTimestamp),
    limit(messageLimit)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }))
    .reverse();
}

/* ----------------- THREADS ----------------- */
/*
export function useSendThreadMessage() {
  const { user } = useUser();

  const sendThread = async (text, hiveID, honeycombID, parentMessageID, allUserIds = []) => {
    if (!user) throw new Error("User not authenticated");

    const hid = asId(hiveID, "hiveID");
    const cid = asId(honeycombID, "honeycombID");
    const pid = asId(parentMessageID, "parentMessageID");

    const threadRef = collection(db, "Hive", hid, "Honeycomb", cid, "messages", pid, "Threads");

    const msgRef = await addDoc(threadRef, {
      text,
      sender: user.displayName || user.email || "User",
      senderId: user.uid,
      timestamp: serverTimestamp(),
      parentMessageId: pid,
    });

    // Initialize userStatus for all users (except sender)
    const ids = normalizeUserIds(allUserIds);
    ids.forEach(async (uid) => {
      if (uid === user.uid) return;

      const statusRef = doc(
        db,
        "Hive",
        hid,
        "Honeycomb",
        cid,
        "messages",
        pid,
        "Threads",
        msgRef.id,
        "userStatus",
        uid
      );

      await setDoc(statusRef, { lastSeen: null });
    });

    return msgRef.id;
  };

  return sendThread;
}
  */
 
//THREAD CREATION METHOD
export function useSendThreadMessage() {
  const { user } = useUser();

  const sendThreadMessage = async (text, hiveID, honeycombID, parentMessageID) => {
    if (!user) throw new Error("User not authenticated");

    // 1️⃣ TensorFlow toxicity check (client-side)
    const toxic = await isToxicMessage(text);
    if (toxic) {
      const details = await getToxicityDetails(text);
      const flagged = details
        .filter((d) => d.match)
        .map((d) => d.label.replace(/_/g, " "))
        .join(", ");
      alert(
        `Your message was blocked by the content safety filter.\n\nFlagged category: ${flagged || "toxicity"}.\n\nPlease revise your message and try again.`
      );
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

    await touchHiveLastActive(hiveID);
  };

  return sendThreadMessage;
}

export function subscribeToThreadMessages(callback, hiveID, honeycombID, parentMessageID) {
  if (!hiveID || !honeycombID || !parentMessageID) {
    console.warn("subscribeToThreadMessages missing IDs:", { hiveID, honeycombID, parentMessageID });
    return () => {};
  }

  const hid = String(hiveID);
  const cid = String(honeycombID);
  const pid = String(parentMessageID);

  const threadRef = collection(db, "Hive", hid, "Honeycomb", cid, "messages", pid, "Threads");
  const q = query(threadRef, orderBy("timestamp", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const threads = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data(), status: doc.data().status || "open" }));
      callback(threads);
    },
    (err) => {
      console.error("subscribeToThreadMessages snapshot error:", err);
      try {
        callback([]);
      } catch (e) {
        // swallow
      }
    }
  );
}

/* ----------------- AI REPLIES ----------------- */

export async function sendAIReply(text, hiveID, honeycombID) {
  const hid = asId(hiveID, "hiveID");
  const cid = asId(honeycombID, "honeycombID");

  const messagesRef = collection(db, "Hive", hid, "Honeycomb", cid, "messages");

  try {
    const aiResponse = await callGeminiAPI(text);

    await addDoc(messagesRef, {
      type: "text",
      text: aiResponse,
      sender: "AI Bot",
      senderId: "AI",
      timestamp: serverTimestamp(),
    });
    await touchHiveLastActive(hid);
  } catch (error) {
    console.error("Failed to send AI reply:", error);

    await addDoc(messagesRef, {
      type: "text",
      text: "AI could not generate a response.",
      sender: "AI Bot",
      senderId: "AI",
      timestamp: serverTimestamp(),
    });
    await touchHiveLastActive(hid);
  }
}

/* ----------------- UNREAD TRACKING ----------------- */

export async function updateLastSeen(hiveID, honeycombID = null, messageID = null, uid) {
  const hid = asId(hiveID, "hiveID");
  const userId = asId(uid, "uid");

  let ref;
  if (messageID) {
    if (!honeycombID) throw new Error("updateLastSeen: honeycombID is required when messageID is set");
    ref = doc(
      db,
      "Hive",
      hid,
      "Honeycomb",
      String(honeycombID),
      "messages",
      String(messageID),
      "userStatus",
      userId
    );
  } else if (honeycombID) {
    ref = doc(db, "Hive", hid, "Honeycomb", String(honeycombID), "userStatus", userId);
  } else {
    ref = doc(db, "Hive", hid, "userStatus", userId);
  }

  await setDoc(ref, { lastSeen: serverTimestamp() }, { merge: true });
}

export async function getLastSeen(hiveID, honeycombID = null, messageID = null, uid) {
  const hid = asId(hiveID, "hiveID");
  const userId = asId(uid, "uid");

  let ref;
  if (messageID) {
    if (!honeycombID) throw new Error("getLastSeen: honeycombID is required when messageID is set");
    ref = doc(
      db,
      "Hive",
      hid,
      "Honeycomb",
      String(honeycombID),
      "messages",
      String(messageID),
      "userStatus",
      userId
    );
  } else if (honeycombID) {
    ref = doc(db, "Hive", hid, "Honeycomb", String(honeycombID), "userStatus", userId);
  } else {
    ref = doc(db, "Hive", hid, "userStatus", userId);
  }

  const snap = await getDoc(ref);
  const lastSeen = snap.exists() ? snap.data()?.lastSeen : null;
  return lastSeen?.toMillis?.() ?? 0;
}

export async function getLatestMessageTimestamp(hiveID, honeycombID, parentMessageID = null) {
  if (!hiveID || !honeycombID) return 0;

  const hid = String(hiveID);
  const cid = String(honeycombID);

  let ref;
  if (parentMessageID) {
    ref = collection(db, "Hive", hid, "Honeycomb", cid, "messages", String(parentMessageID), "Threads");
  } else {
    ref = collection(db, "Hive", hid, "Honeycomb", cid, "messages");
  }

  const q = query(ref, orderBy("timestamp", "desc"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return 0;

  const latest = snap.docs[0].data().timestamp;
  return latest?.toMillis?.() ?? 0;
}

export async function getUnreadCount(hiveID, honeycombID, uid, parentMessageID = null) {
  const hid = asId(hiveID, "hiveID");
  const cid = asId(honeycombID, "honeycombID");
  const userId = asId(uid, "uid");

  const lastSeenMs = await getLastSeen(hid, cid, parentMessageID ? String(parentMessageID) : null, userId);

  let ref;
  if (parentMessageID) {
    ref = collection(db, "Hive", hid, "Honeycomb", cid, "messages", String(parentMessageID), "Threads");
  } else {
    ref = collection(db, "Hive", hid, "Honeycomb", cid, "messages");
  }

  const q = query(ref, where("timestamp", ">", new Date(lastSeenMs)));
  const snap = await getDocs(q);
  return snap.size;
}

export async function getThreadUnreadCount(hiveID, honeycombID, messageID, uid) {
  if (!hiveID || !honeycombID || !messageID || !uid) return 0;
  return await getUnreadCount(hiveID, honeycombID, uid, String(messageID));
}

export async function getHoneycombUnreadCount(hiveID, honeycombID, uid) {
  return await getUnreadCount(hiveID, honeycombID, uid);
}

export async function getAllUnreadCounts(hiveID, uid) {
  if (!uid || !hiveID) return {};

  const hid = String(hiveID);
  const userId = String(uid);

  const honeycombRef = collection(db, "Hive", hid, "Honeycomb");
  const honeycombSnapshot = await getDocs(honeycombRef);

  const countsPromises = honeycombSnapshot.docs.map(async (docSnap) => {
    const honeycombID = docSnap.id;
    const count = await getHoneycombUnreadCount(hid, honeycombID, userId);
    return [honeycombID, count];
  });

  const results = await Promise.all(countsPromises);
  return Object.fromEntries(results);
}

export async function setThreadStatus(hiveID, honeycombID, parentMessageID, threadID, status) {
  if (!["open", "closed"].includes(status)) throw new Error("Invalid status");

  const hid = asId(hiveID, "hiveID");
  const cid = asId(honeycombID, "honeycombID");
  const pid = asId(parentMessageID, "parentMessageID");
  const tid = asId(threadID, "threadID");

  const threadRef = doc(db, "Hive", hid, "Honeycomb", cid, "messages", pid, "Threads", tid);
  await setDoc(threadRef, { status }, { merge: true });
}

/* ----------------- THREAD CLOSING + NOTIFICATIONS ----------------- */

export async function closeThreadAndNotify(hiveID, honeycombID, parentMessageID, threadID, closedByUser) {
  try {
    const hid = asId(hiveID, "hiveID");
    const cid = asId(honeycombID, "honeycombID");
    const pid = asId(parentMessageID, "parentMessageID");
    const tid = asId(threadID, "threadID");

    await updateThreadStatus(hid, cid, pid, tid, "closed");

    const participants = await getThreadParticipants(hid, cid, pid, tid);

    const userIDs = (participants || [])
      .map((p) => (typeof p === "string" ? p : p?.uid))
      .filter(Boolean)
      .map(String);


    const message = `Thread "${tid}" was closed by ${closedByUser?.displayName || "a user"}.`;

    if (userIDs.length > 0) {
      await notifyUsers(userIDs, {
      type: "THREAD_CLOSED",
      hiveID: hid,
      honeycombID: cid,
      threadID: tid,
      message,
      notifyAt: null,
      });

      console.log("THREAD_CLOSED notifications sent to:", userIDs);
    }

    console.log(`✅ THREAD_CLOSED notifications sent to:`, userIDs);

    // 4️⃣ Generate and store AI summary for this completed thread
    try {
      await generateAndStoreDecisionRecordForThread({
        hiveID,
        honeycombID,
        parentMessageID,
        threadID,
        closedByUser,
        summaryText: "",
      });
      console.log("Decision record generated and stored for thread:", threadID);
    } catch (err) {
      console.error("Failed to generate decision record for thread:", err);
    }

    let summaryText = "";

    try {
      summaryText = await generateAndStoreThreadSummary(
        hiveID,
        honeycombID,
        parentMessageID,
        threadID,
        closedByUser
      );
      console.log("✅ AI summary generated and stored for thread:", threadID);
    } catch (err) {
      console.error("❌ Failed to generate AI summary for thread:", err);
    }

  } catch (error) {
    console.error("❌ Failed to close thread and notify participants:", error);
  }
}

// ---- Dashboard / Personal Assistant thread (global) ----
const ASSISTANT_THREAD_ID = "default";

const assistantMessagesRef = (uid) =>
  collection(db, "Users", String(uid), "assistantThreads", ASSISTANT_THREAD_ID, "messages");

export function useSendAssistantMessage() {
  const { user } = useUser();

  const sendAssistantMessage = async (text, attachment = null) => {
    if (!user) throw new Error("User not authenticated");

    const ref = assistantMessagesRef(user.uid);

    const normalized = normalizeAttachment(attachment);

    const docRef = await addDoc(ref, {
      type: normalized ? "file" : "text",
      text: text || "",
      attachment: normalized,
      sender: user.displayName || user.email || "User",
      senderId: user.uid,
      timestamp: serverTimestamp(),
    });

    return docRef.id;
  };

  return sendAssistantMessage;
}

export function subscribeToAssistantMessages(callback, uid) {
  if (!uid) {
    console.warn("subscribeToAssistantMessages missing uid");
    return () => {};
  }

  const ref = assistantMessagesRef(uid);
  const q = query(ref, orderBy("timestamp", "asc"));

  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(msgs);
  });
}

export async function sendAssistantAIReply(promptText, uid) {
  if (!uid) throw new Error("uid is required");

  const ref = assistantMessagesRef(uid);

  try {
    const aiResponse = await callGeminiAPI(promptText);

    await addDoc(ref, {
      type: "text",
      text: aiResponse,
      attachment: null,
      sender: "AI Bot",
      senderId: "AI",
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.error("sendAssistantAIReply failed:", e);
    await addDoc(ref, {
      type: "text",
      text: "AI could not generate a response.",
      attachment: null,
      sender: "AI Bot",
      senderId: "AI",
      timestamp: serverTimestamp(),
    });
  }
}

//-----------Close thread and save thread to memory----------//
export const closeThread = async (hiveId, threadId, messages) => {
  // Step 1: Normal closure logic (Update status in Firestore)
  await updateThreadStatus(threadId, "closed");

  // Step 2: MANUAL NECTAR EXTRACTION
  // Format the context for the AI
  const threadContext = messages
    .map(m => `${m.sender}: ${m.text}`)
    .join("\n");

  try {
    console.log("Distilling Knowledge Nectar...");
    await NectarRepository.distillAndSave(hiveId, threadContext);
    console.log("Nectar saved to Hive Memory!");
  } catch (error) {
    console.error("Nectar extraction failed, but thread was closed.", error);
  }
};
