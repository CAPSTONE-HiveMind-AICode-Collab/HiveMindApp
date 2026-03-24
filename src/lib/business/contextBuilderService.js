// src/lib/business/contextBuilderService.js

// Optional enum-style constants (handy if you want to re-use them elsewhere)
export const ASK_AI_SCOPES = {
  MESSAGE_ONLY: "message",
  LAST_5: "last_5",
  LAST_20: "last_20",
  ENTIRE_CHAT: "entire_chat",
};

export const AI_SCOPE_OPTIONS = [
  { value: ASK_AI_SCOPES.MESSAGE_ONLY, label: "This message only" },
  { value: ASK_AI_SCOPES.LAST_5, label: "Last 5 messages" },
  { value: ASK_AI_SCOPES.LAST_20, label: "Last 20 messages" },
  { value: ASK_AI_SCOPES.ENTIRE_CHAT, label: "Entire chat" },
];

const ROLE_SCOPE_POLICY = {
  OWNER: [
    ASK_AI_SCOPES.MESSAGE_ONLY,
    ASK_AI_SCOPES.LAST_5,
    ASK_AI_SCOPES.LAST_20,
    ASK_AI_SCOPES.ENTIRE_CHAT,
  ],
  ADMIN: [
    ASK_AI_SCOPES.MESSAGE_ONLY,
    ASK_AI_SCOPES.LAST_5,
    ASK_AI_SCOPES.LAST_20,
    ASK_AI_SCOPES.ENTIRE_CHAT,
  ],
  MEMBER: [
    ASK_AI_SCOPES.MESSAGE_ONLY,
    ASK_AI_SCOPES.LAST_5,
    ASK_AI_SCOPES.LAST_20,
  ],
  VIEWER: [ASK_AI_SCOPES.MESSAGE_ONLY],
};

const SCOPE_MESSAGE_LIMITS = {
  [ASK_AI_SCOPES.MESSAGE_ONLY]: 0,
  [ASK_AI_SCOPES.LAST_5]: 5,
  [ASK_AI_SCOPES.LAST_20]: 20,
  [ASK_AI_SCOPES.ENTIRE_CHAT]: 20,
};

export function getAllowedAiScopesForRole(role) {
  const normalizedRole = String(role || "VIEWER").toUpperCase();
  return ROLE_SCOPE_POLICY[normalizedRole] || ROLE_SCOPE_POLICY.VIEWER;
}

export function resolveScopeForRole(requestedScope, role) {
  const allowedScopes = getAllowedAiScopesForRole(role);
  return allowedScopes.includes(requestedScope)
    ? requestedScope
    : allowedScopes[0];
}

export function limitHistoryByScope(history, scope) {
  const safeHistory = Array.isArray(history) ? history : [];
  const maxItems = SCOPE_MESSAGE_LIMITS[scope] ?? 0;

  if (maxItems <= 0) {
    return [];
  }

  return safeHistory.slice(-maxItems);
}

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

  const limitCount =
    s === ASK_AI_SCOPES.ENTIRE_CHAT
      ? messages.length
      : SCOPE_MESSAGE_LIMITS[s] ?? 0;

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
