// src/lib/data/summaryRepository.js
import { db } from "@/lib/firebase/config";
import { callGeminiAPI, getAIResponseIssue } from "@/lib/data/aiRepository";
import { extractJsonObject } from "@/lib/ai/structuredOutput";
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

function truncateLine(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}...`;
}

function ensureSentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function normalizeMessageText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:;,.!?]+|[\s\-:;,.!?]+$/g, "")
    .trim();
}

function isLowSignalText(value) {
  const text = normalizeMessageText(value).toLowerCase();
  if (!text) return true;
  if (text.length <= 3) return true;
  return /^(hi|hey|hello|ok|okay|k|kk|thanks|thx|got it|noted|yo|sup|test)$/.test(text);
}

function pickSummaryTitle(parentText, cleanedMessages) {
  const parent = truncateLine(parentText, 56);
  if (parent && !isLowSignalText(parent)) {
    return parent;
  }

  const firstUseful = cleanedMessages.find((message) => !isLowSignalText(message?.text));
  if (firstUseful?.text) {
    return truncateLine(firstUseful.text, 56);
  }

  return "Thread summary";
}

function extractCommitment(text) {
  const source = normalizeMessageText(text);
  if (!source) return "";

  const lowered = source.toLowerCase();
  const directMatch = lowered.match(
    /\b(i will|i'll|we will|we'll|let'?s|can you|please)\b\s+(.+)$/i
  );
  if (directMatch?.[2]) {
    return normalizeMessageText(directMatch[2]);
  }

  return "";
}

function isHelpOffer(text) {
  return /\b(do u need help|do you need help|do u need any help|do you need any help|need help|can i help|can we help|let me know if you need help)\b/i.test(
    String(text || "")
  );
}

function isHelpDecline(text) {
  return /\b(no\b|nope\b|no thanks\b|i appreciate it\b|im good\b|i'm good\b|all good\b|got it\b|i got it\b)\b/i.test(
    String(text || "")
  );
}

function normalizeConversationMessages(messages) {
  return (messages || [])
    .map((message) => ({
      sender: String(message?.sender || "User").trim() || "User",
      text: normalizeMessageText(message?.text),
    }))
    .filter((message) => message.text);
}

function buildTopicSentence(parentText, cleanedMessages) {
  const topic = normalizeMessageText(parentText);

  if (topic && !isLowSignalText(topic)) {
    if (/\bremember to\b/i.test(topic) || /\btask\b/i.test(topic)) {
      return "The thread was about reminding someone to complete a task";
    }

    return `The thread started with ${truncateLine(topic, 160)}`;
  }

  const firstUseful = cleanedMessages.find((message) => !isLowSignalText(message.text));
  if (firstUseful?.text) {
    return `The thread focused on ${truncateLine(firstUseful.text, 160)}`;
  }

  return "The thread was a brief check-in";
}

function buildOutcomeSentence(cleanedMessages) {
  const meaningfulMessages = cleanedMessages.filter(
    (message) => !isLowSignalText(message.text)
  );
  const latestMeaningful = meaningfulMessages[meaningfulMessages.length - 1] || null;
  const helpOffer = meaningfulMessages.find((message) => isHelpOffer(message.text)) || null;
  const helpDecline = meaningfulMessages.find((message) => isHelpDecline(message.text)) || null;
  const commitments = meaningfulMessages
    .map((message) => {
      const commitment = extractCommitment(message.text);
      if (!commitment) return null;
      return `${message.sender} will ${commitment}`;
    })
    .filter(Boolean);

  if (helpOffer && helpDecline) {
    return `${helpOffer.sender} offered help, and ${helpDecline.sender} said it was not needed`;
  }

  if (commitments.length) {
    return truncateLine(commitments[commitments.length - 1], 180);
  }

  if (latestMeaningful?.text) {
    return `The latest update was ${truncateLine(latestMeaningful.text, 180)}`;
  }

  return "No clear follow-up action was captured before the thread closed";
}

export function buildThreadSummaryFromConversation(parentText, messages, tone = null) {
  const cleanedMessages = normalizeConversationMessages(messages);
  const title = pickSummaryTitle(parentText, cleanedMessages);
  const sentences = [
    buildTopicSentence(parentText, cleanedMessages),
    buildOutcomeSentence(cleanedMessages),
  ];

  if (tone) {
    sentences.push(`Tone: ${tone}`);
  }

  const body = sentences.map(ensureSentence).filter(Boolean).join(" ").trim();
  return {
    title,
    body,
    text: `Title: ${title}\nSummary:\n${body}`,
  };
}

function buildStoredThreadSummary(parentText, messages, tone = null) {
  return buildThreadSummaryFromConversation(parentText, messages, tone);
}

function normalizeThreadSummaryPayload(raw, fallbackSummary) {
  const parsed = extractJsonObject(raw);

  if (!parsed || typeof parsed !== "object") {
    return fallbackSummary;
  }

  const title = truncateLine(parsed.title || fallbackSummary.title || "Thread summary", 56);
  const bodyParts = [
    String(parsed.context || "").trim(),
    String(parsed.outcome || "").trim(),
    String(parsed.nextStep || parsed.next_step || "").trim(),
  ].filter(Boolean);
  const body =
    String(parsed.body || parsed.summary || "").trim() ||
    bodyParts.map(ensureSentence).join(" ").trim();

  if (!body) {
    return fallbackSummary;
  }

  const normalizedBody = ensureSentence(body);

  return {
    title,
    body: normalizedBody,
    text: `Title: ${title}\nSummary:\n${normalizedBody}`,
  };
}

async function buildAIThreadSummary({
  hiveID,
  honeycombID,
  parentText,
  parentSender = "",
  messages,
  tone = null,
}) {
  const fallbackSummary = buildStoredThreadSummary(parentText, messages, tone);
  const conversationLines = normalizeConversationMessages(messages)
    .map((message) => `- ${message.sender}: ${message.text}`)
    .join("\n");

  const prompt = `
You are generating a thread-closure summary for HiveMind that should make sense to a teammate who was not present.

Workspace:
- Hive ID: ${hiveID}
- Honeycomb ID: ${honeycombID}

Original message${parentSender ? ` from ${parentSender}` : ""}:
${parentText || "No parent message provided."}

Thread replies:
${conversationLines || "- No replies captured."}

Tone hint:
${tone || "No special tone."}

Return ONLY raw JSON in this exact shape:
{
  "title": "short thread title",
  "context": "1 sentence explaining the original issue or topic",
  "outcome": "1 sentence explaining what happened in this thread",
  "nextStep": "1 sentence explaining the current state or next action, or say none if there is no action",
  "body": "optional combined 2-4 sentence summary"
}

Rules:
- Be specific to the original issue, not just the micro-replies.
- Someone reading this should understand what file/problem/topic the thread belongs to.
- Mention the concrete outcome, decision, or latest agreed next step.
- If the thread only declined help or clarified ownership, say that in context of the original issue.
- Do not use vague phrases like "a user" if you can name the sender from the thread.
- Make the summary self-contained and readable without seeing the original thread.
- Do not invent facts.
- Do not include markdown fences.
- Keep the title under 56 characters.
  `.trim();

  try {
    const reply = await callGeminiAPI(prompt, "gemini-2.5-flash", [], {
      hiveID,
      honeycombID,
      scope: "message",
      feature: "thread_summary",
    });
    const issue = getAIResponseIssue(reply);
    if (issue) {
      return fallbackSummary;
    }

    return normalizeThreadSummaryPayload(reply, fallbackSummary);
  } catch (error) {
    console.error("AI thread summary generation failed:", error);
    return fallbackSummary;
  }
}

/**
 * Generate a stored summary for a completed thread.
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
  const parentSender = parentSnap.exists() ? parentSnap.data().sender || "" : "";

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
    return "";
  }

  const aiSummary = await buildAIThreadSummary({
    hiveID,
    honeycombID,
    parentText,
    parentSender,
    messages,
  });

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
    summaryText: aiSummary.text,
    summaryTitle: aiSummary.title,
    summaryBody: aiSummary.body,
    generatedAt: serverTimestamp(),
    closedByUserId: closedByUser?.uid || null,
    closedByUserName: closedByUser?.displayName || null,
  });

  return aiSummary.text;
}

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
  const parentSender = parentSnap.exists() ? parentSnap.data().sender || "" : "";

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
      "Focus on technical details, architecture decisions, and implementation specifics",
    decision: "Highlight the decision made and any consensus or dissent expressed",
    problem: "Focus on the problem identified and the solutions proposed or committed to",
    neutral: "Summarize the conversation neutrally, capturing key points and outcomes",
  };

  const aiSummary = await buildAIThreadSummary({
    hiveID,
    honeycombID,
    parentText,
    parentSender,
    messages,
    tone: toneInstructions[tone] ? tone : null,
  });

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
    summaryText: aiSummary.text,
    summaryTitle: aiSummary.title,
    summaryBody: aiSummary.body,
    generatedAt: serverTimestamp(),
    closedByUserId: closedByUser?.uid || null,
    closedByUserName: closedByUser?.displayName || null,
    detectedTone: tone,
  });
}
