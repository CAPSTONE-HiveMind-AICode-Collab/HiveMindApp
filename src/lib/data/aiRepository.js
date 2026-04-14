// src/lib/data/aiRepository.js
import { db, auth } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";

/**
 * Few-shot examples for better AI responses
 * Used as part of prompt engineering for consistent, high-quality outputs
 */
const RESPONSE_EXAMPLES = {
  technical: {
    example:
      "User: How do I fix a React hooks error?\nAI: React hooks must be called at the top level of functional components. Common issues:\n1. Calling inside loops/conditions - hooks rely on call order\n2. Hooks in class components - only use in functional components\n3. Custom hooks without 'use' prefix - helps tools identify them\n\nExample fix:\n```javascript\n// Wrong\nif (condition) useEffect(() => {});\n\n// Correct\nuseEffect(() => {\n  if (condition) {\n    /* logic */\n  }\n}, [condition]);\n```",
  },
  summary: {
    example:
      "Conversation:\nUser1: We need to refactor our database schema\nUser2: Agree, the current structure doesn't scale\nUser3: I'll work on creating migration scripts\n\nAI Summary:\nTitle: Database Refactoring Initiative\nSummary: The team identified scalability issues with the current database schema and decided to proceed with refactoring. User3 volunteered to create migration scripts.\nFollow-ups: Review migration script implementation, test on staging environment",
  },
};

const AI_RESPONSE_ISSUE_RULES = [
  {
    kind: "quota",
    pattern:
      /^You exceeded your current .*quota.*$|^.*quota exceeded.*$|^.*billing.*quota.*$/i,
  },
  {
    kind: "throttled",
    pattern:
      /^Gemini temporarily throttled the request \(429\)\.?$|^.*Too Many Requests.*$|^.*RESOURCE_EXHAUSTED.*$|^.*rate limit.*$|^.*temporarily throttled.*$/i,
  },
  {
    kind: "auth",
    pattern:
      /^Authentication required\.?$|^Invalid or expired token\.?$|^You do not have access to this hive\.?$/i,
  },
  {
    kind: "config",
    pattern:
      /^.*not configured.*$|^No AI API key configured\..*$|^AI provider failed and no fallback provider is configured\.?$/i,
  },
  {
    kind: "service",
    pattern:
      /^Failed to get AI response\.?$|^Error connecting to AI service\.?$|^.*could not respond right now\.?$/i,
  },
];

function unwrapAIErrorMessage(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();

  if (typeof value === "object") {
    const directMessage = [value.message, value.error, value.details].find(
      (item) => typeof item === "string" && item.trim()
    );
    return String(directMessage || "").trim();
  }

  return String(value).trim();
}

function normalizeAIErrorResponse(response, data) {
  const message =
    unwrapAIErrorMessage(data?.error) || unwrapAIErrorMessage(data?.message);

  if (message) return message;

  if (response.status === 429) {
    return "Gemini temporarily throttled the request (429).";
  }

  if (response.status >= 500) {
    return "Gemini could not respond right now.";
  }

  return "Failed to get AI response.";
}

export function getAIResponseIssue(value) {
  const text = unwrapAIErrorMessage(value);
  if (!text) return null;

  const matchedRule = AI_RESPONSE_ISSUE_RULES.find((rule) => rule.pattern.test(text));
  if (!matchedRule) return null;

  return {
    kind: matchedRule.kind,
    message: text,
  };
}

async function callAIRequest({
  message,
  model,
  history = [],
  context = null,
}) {
  try {
    const currentUser = auth.currentUser;
    const idToken = currentUser ? await currentUser.getIdToken(false) : null;

    const headers = { "Content-Type": "application/json" };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const response = await fetch("/api/ai", {
      method: "POST",
      headers,
      body: JSON.stringify({ message, model, history, context }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return normalizeAIErrorResponse(response, data);
    }

    return data.reply || "No response generated.";
  } catch (error) {
    console.error("AI repository error:", error);
    return "Error connecting to AI service.";
  }
}

/**
 * Sends a message to the shared AI route using the Gemini provider.
 * The current user's Firebase ID token is forwarded for server-side verification.
 */
export async function callGeminiAPI(userText, model, history = [], context = null) {
  return callAIRequest({
    message: userText,
    model,
    history,
    context,
  });
}

/**
 * Enhanced AI call with few-shot learning examples
 * Better for technical questions and code-related discussions
 */
export async function callGeminiAPIManyShot(userText, model, contextType = "technical") {
  const examples = RESPONSE_EXAMPLES[contextType] || RESPONSE_EXAMPLES.technical;

  const enhancedPrompt = `You are a helpful AI assistant in a collaborative team workspace. Provide clear, concise, and actionable responses.

RESPONSE STYLE GUIDE:
- Be specific with examples or code when relevant
- Use structured formatting (lists, code blocks) for clarity
- Keep responses focused and avoid unnecessary verbosity
- Acknowledge nuance: "It depends on..." when context matters

EXAMPLE OF GOOD RESPONSE:
${examples.example}

USER MESSAGE:
${userText}`;

  return callGeminiAPI(enhancedPrompt, model);
}

/**
 * Triggers a RAG (Retrieval-Augmented Generation) flow.
 * It pulls the stored Hive memory from Firestore and feeds it as context to AI.
 */
export async function askHiveMemory(
  hiveID,
  userQuestion,
  model = "gemini-2.5-flash",
  context = null
) {
  try {
    const nectarRef = collection(db, "Hive", hiveID, "knowledgeNectar");
    const snapshot = await getDocs(nectarRef);

    if (snapshot.empty) {
      return "I don't have any project memory stored yet. Try closing a thread first.";
    }

    const memoryEntries = snapshot.docs.map((docSnap) => docSnap.data());

    const memoryContext = memoryEntries
      .map(
        (entry) =>
          `TITLE: ${entry.title}\nDECISION: ${entry.decision}\nSUMMARY: ${entry.summary}`
      )
      .join("\n\n---\n\n");

    const groundedPrompt = `
      You are the HiveMind Memory Assistant. Use the PROJECT MEMORY below to answer the user's question.

      RULES:
      - Only use information from the PROJECT MEMORY.
      - If the answer is not there, say: "That information is not in my memory yet."
      - Be concise and factual.

      --- PROJECT MEMORY ---
      ${memoryContext}
      --- END OF MEMORY ---

      USER QUESTION: ${userQuestion}
    `;

    return await callGeminiAPI(groundedPrompt, model, [], context);
  } catch (error) {
    console.error("Memory retrieval error:", error);
    return "Failed to access Hive memory.";
  }
}
