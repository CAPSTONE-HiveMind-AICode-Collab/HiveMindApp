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
    return ""; // nothing to summarize
  }

  const joined = [
    parentText ? `Original message: ${parentText}` : null,
    ...messages.map((m) => `${m.sender || "User"}: ${m.text || ""}`),
  ]
    .filter(Boolean)
    .join("\n");

  const messageCount = messages.length;
  
  // Few-shot example for better summary quality
  const fewShotExample = `
EXAMPLE - 5 message thread:
Conversation:
User A: We need to optimize our database queries
User B: I can profile them this week
User C: Don't forget to check the indexing
User B: Will do, updating the ticket

Good Summary:
Title: Database Query Optimization Task
Summary: The team agreed to optimize slow database queries. User B volunteered to profile them this week, and User C reminded the team to review indexing strategy.
Follow-ups: Profile database queries and review index performance

Bad Summary:
Title: Database Discussion
Summary: User A said queries need optimization. User B said they would profile them. User C mentioned indexing. User B said they would update the ticket. This was a discussion about making queries better.
(This is too verbose and repetitive)`;

  const prompt = `
You are an AI assistant summarizing a completed conversation thread in a collaborative workspace.

Analyze the following conversation and create a concise, natural summary.

IMPORTANT GUIDELINES:
- Keep summaries SHORT and proportional to the conversation length (${messageCount} messages)
- For brief exchanges (1-3 messages): 1-2 sentences maximum
- For medium conversations (4-10 messages): 1 short paragraph
- For long discussions (10+ messages): 2-3 paragraphs with key points
- Use a conversational, natural tone - avoid overly formal language
- Refer to people by their actual names from the conversation
- Capture the essence and tone (casual, technical, collaborative, etc.)
- Focus on what was actually discussed, decided, or shared
- Don't add information that wasn't in the conversation
- Avoid repetition - say things once clearly
- Extract any decisions, action items, or key insights

Example of good summary format:
${fewShotExample}

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

  return aiText;
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
/**
 * Enhanced context-aware summary generation
 * Analyzes conversation tone and topic to generate more relevant summaries
 * Part of HIP-109: Advanced Prompting improvements
 */
export async function generateContextAwareSummary(
  hiveID,
  honeycombID,
  parentMessageID,
  threadID,
  closedByUser,
  customTone = null
) {
  if (!hiveID || !honeycombID || !parentMessageID || !threadID) {
    throw new Error("Missing IDs for generateContextAwareSummary");
  }

  // Parent message
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
    return;
  }

  const joined = [
    parentText ? `Original message: ${parentText}` : null,
    ...messages.map((m) => `${m.sender || "User"}: ${m.text || ""}`),
  ]
    .filter(Boolean)
    .join("\n");

  // Auto-detect tone if not provided
  let tone = customTone || "neutral";
  const toneKeywords = {
    technical: ["code", "api", "database", "bug", "error", "function", "deploy", "server"],
    decision: ["decide", "agreed", "should we", "proposal", "approve", "agree"],
    problem: ["issue", "problem", "fix", "broken", "doesn't work", "error"],
  };

  for (const [toneType, keywords] of Object.entries(toneKeywords)) {
    if (keywords.some((kw) => joined.toLowerCase().includes(kw))) {
      tone = toneType;
      break;
    }
  }

  const toneInstructions = {
    technical:
      "Focus on technical details, architecture decisions, and implementation specifics.",
    decision: "Highlight the decision made and any consensus or dissent expressed.",
    problem: "Focus on the problem identified and the solutions proposed or committed to.",
    neutral: "Summarize the conversation neutrally, capturing key points and outcomes.",
  };

  const messageCount = messages.length;

  const prompt = `
You are an AI assistant summarizing a completed conversation thread in a collaborative workspace.

ANALYSIS: This conversation appears to be ${tone}-focused.
TONE GUIDANCE: ${toneInstructions[tone] || toneInstructions.neutral}

Analyze the following conversation and create a concise, natural summary.

IMPORTANT GUIDELINES:
- Keep summaries SHORT and proportional to the conversation length (${messageCount} messages)
- For brief exchanges (1-3 messages): 1-2 sentences maximum
- For medium conversations (4-10 messages): 1 short paragraph
- For long discussions (10+ messages): 2-3 paragraphs with key points
- Use a conversational, natural tone - avoid overly formal language
- Refer to people by their actual names from the conversation
- Capture the essence and tone (casual, technical, collaborative, etc.)
- Focus on what was actually discussed, decided, or shared
- Don't add information that wasn't in the conversation
- Avoid repetition - say things once clearly
- Extract ${tone === "decision" ? "decisions" : tone === "problem" ? "problems and solutions" : "key insights"}

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
    detectedTone: tone,
  });
}
