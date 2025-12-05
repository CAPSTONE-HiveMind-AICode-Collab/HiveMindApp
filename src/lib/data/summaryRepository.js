// src/lib/data/summaryRepository.js
import { db } from "@/lib/firebase/config";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { callGeminiAPI } from "@/lib/data/aiRepository";

/**
 * Generate an AI summary for a completed thread and store it.
 *
 * Summary document path:
 *   Hive/{hiveID}/Honeycomb/{honeycombID}/threadSummaries/{threadID}
 */
export async function generateAndStoreThreadSummary(
  hiveID,
  honeycombID,
  parentMessageID,
  threadID,
  closedByUser
) {
  if (!hiveID || !honeycombID || !parentMessageID || !threadID) {
    throw new Error("Missing IDs for generateAndStoreThreadSummary");
  }

  // Parent message (the main problem / task)
  const parentRef = doc(
    db,
    "Hive",
    hiveID,
    "Honeycomb",
    honeycombID,
    "messages",
    parentMessageID
  );
  const parentSnap = await getDoc(parentRef);
  const parentText = parentSnap.exists() ? parentSnap.data().text || "" : "";

  // All thread messages
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
  const threadSnap = await getDocs(q);
  const messages = threadSnap.docs.map((d) => d.data());

  if (messages.length === 0 && !parentText) {
    return; // nothing to summarize
  }

  const joined = [
    parentText ? `Original message: ${parentText}` : null,
    ...messages.map((m) => `${m.sender || "User"}: ${m.text || ""}`),
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `
You are an AI assistant summarizing a completed conversation thread in a collaborative workspace.

Analyze the following conversation and create a concise, natural summary.

IMPORTANT GUIDELINES:
- Keep summaries SHORT and proportional to the conversation length
- For brief exchanges (1-3 messages): 1-2 sentences maximum
- For medium conversations (4-10 messages): 1 short paragraph
- For long discussions (10+ messages): 2-3 paragraphs with key points
- Use a conversational, natural tone - avoid overly formal language
- Refer to people by their actual names from the conversation
- Capture the essence and tone (casual, technical, collaborative, etc.)
- Focus on what was actually discussed, decided, or shared
- Don't add information that wasn't in the conversation
- Avoid repetition - say things once clearly

Format your response as:

Title: [brief, descriptive title - max 8 words]
Summary:
[Natural language summary matching conversation length and tone]
Follow-ups (if any):
[Only include if actual next steps were mentioned]

Conversation:
"""
${joined}
"""
  `.trim();

  const aiText = await callGeminiAPI(prompt);

  const summaryRef = doc(
    db,
    "Hive",
    hiveID,
    "Honeycomb",
    honeycombID,
    "threadSummaries",
    threadID
  );

  await setDoc(summaryRef, {
    parentMessageID,
    threadID,
    summaryText: aiText,
    generatedAt: serverTimestamp(),
    closedByUserId: closedByUser?.uid || null,
    closedByUserName: closedByUser?.displayName || null,
  });
}

/**
 * List all summaries for a honeycomb.
 */
export async function listThreadSummaries(hiveID, honeycombID) {
  const summariesRef = collection(
    db,
    "Hive",
    hiveID,
    "Honeycomb",
    honeycombID,
    "threadSummaries"
  );
  const q = query(summariesRef, orderBy("generatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
