// src/lib/business/contextBuilderService.js

// Optional enum-style constants (handy if you want to re-use them elsewhere)
export const ASK_AI_SCOPES = {
  MESSAGE_ONLY: "message",
  LAST_5: "last_5",
  LAST_20: "last_20",
  ENTIRE_CHAT: "entire_chat",
};

/**
 * Very simple privacy filter – masks obvious emails, phone-like strings,
 * and very long tokens / keys.
 */
export function applyPrivacyFilter(raw) {
  if (!raw) return "";
  let text = String(raw);

  // Emails
  text = text.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[redacted-email]"
  );

  // Phone-ish numbers (rough heuristic)
  text = text.replace(
    /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    "[redacted-phone]"
  );

  // Very long tokens / keys (20+ chars)
  text = text.replace(/\b[0-9A-Za-z]{20,}\b/g, "[redacted-token]");

  return text;
}

/**
 * Build the "history" array we send to Gemini based on a scope.
 * This **excludes** the target message itself (that goes in the main prompt).
 */
function buildAskAIHistory({
  scope,
  messages,
  targetMessageId,
  maxCharsPerMessage = 800,
}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const s = scope || ASK_AI_SCOPES.MESSAGE_ONLY;

  // Message-only: no extra history
  if (s === ASK_AI_SCOPES.MESSAGE_ONLY) return [];

  const idx = messages.findIndex((m) => m.id === targetMessageId);
  const upperIndex = idx === -1 ? messages.length : idx; // up to (not incl.) target

  let limitCount;
  switch (s) {
    case ASK_AI_SCOPES.LAST_5:
      limitCount = 5;
      break;
    case ASK_AI_SCOPES.LAST_20:
      limitCount = 20;
      break;
    case ASK_AI_SCOPES.ENTIRE_CHAT:
      limitCount = messages.length; // clamp by chars below
      break;
    default:
      limitCount = 0;
  }

  if (limitCount <= 0) return [];

  const startIndex = Math.max(0, upperIndex - limitCount);
  const subset = messages.slice(startIndex, upperIndex);

  return subset
    .filter((m) => (m?.text || "").trim().length > 0)
    .map((m) => {
      const rawText = String(m.text ?? "").trim();
      const clipped =
        rawText.length > maxCharsPerMessage
          ? rawText.slice(0, maxCharsPerMessage) + " …"
          : rawText;

      return {
        role: m.senderId === "AI" ? "model" : "user",
        parts: [
          {
            text: `${m.sender || "User"}: ${clipped}`,
          },
        ],
      };
    });
}

/**
 * Main entry point used by HoneycombChatPage.
 *
 * - Decides which previous messages to send based on scope
 * - Applies privacy filter on **history** and **promptBody**
 * - Returns { prompt, history } ready for callGeminiAPI()
 */
export function buildAskAIContext({
  scope,
  messages,
  targetMessage,
  promptBody,
}) {
  const targetId = targetMessage?.id;
  const historyRaw = buildAskAIHistory({ scope, messages, targetMessageId: targetId });

  const history = historyRaw.map((msg) => ({
    ...msg,
    parts: msg.parts.map((p) => ({
      ...p,
      text: applyPrivacyFilter(p.text),
    })),
  }));

  const safePrompt = applyPrivacyFilter(promptBody || "");

  return { prompt: safePrompt, history };
}