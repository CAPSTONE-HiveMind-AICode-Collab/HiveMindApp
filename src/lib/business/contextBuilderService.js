import {
  createEphemeralPassphrase,
  protectSensitiveData,
} from "@/lib/business/privacyPolicyChecker";

export const ASK_AI_SCOPES = {
  MESSAGE_ONLY: "message",
  LAST_2: "last_2",
  LAST_3: "last_3",
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

export async function applyPrivacyFilter(raw, options = {}) {
  return protectSensitiveData(raw, options);
}

function getScopeLabel(scope) {
  switch (scope) {
    case ASK_AI_SCOPES.MESSAGE_ONLY:
      return "this message only";
    case ASK_AI_SCOPES.LAST_2:
      return "the last 2 messages";
    case ASK_AI_SCOPES.LAST_3:
      return "the last 3 messages";
    case ASK_AI_SCOPES.LAST_5:
      return "the last 5 messages";
    case ASK_AI_SCOPES.LAST_20:
      return "the last 20 messages";
    case ASK_AI_SCOPES.ENTIRE_CHAT:
      return "the entire chat";
    default:
      return "this message only";
  }
}

function selectHistoryMessages({ scope, messages, targetMessageId }) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const s = scope || ASK_AI_SCOPES.MESSAGE_ONLY;
  if (s === ASK_AI_SCOPES.MESSAGE_ONLY) return [];

  const idx = messages.findIndex((m) => m.id === targetMessageId);
  const upperIndex = idx === -1 ? messages.length : idx;

  let limitCount = 0;
  switch (s) {
    case ASK_AI_SCOPES.LAST_2:
      limitCount = 2;
      break;
    case ASK_AI_SCOPES.LAST_3:
      limitCount = 3;
      break;
    case ASK_AI_SCOPES.LAST_5:
      limitCount = 5;
      break;
    case ASK_AI_SCOPES.LAST_20:
      limitCount = 20;
      break;
    case ASK_AI_SCOPES.ENTIRE_CHAT:
      limitCount = messages.length;
      break;
    default:
      limitCount = 0;
  }

  if (limitCount <= 0) return [];

  const startIndex = Math.max(0, upperIndex - limitCount);
  return messages.slice(startIndex, upperIndex);
}

function stringifyMessagesForPrompt(messages, maxCharsPerMessage = 800) {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  return messages
    .map((m, i) => {
      const rawText = String(m?.text || "").trim();
      const clipped =
        rawText.length > maxCharsPerMessage
          ? rawText.slice(0, maxCharsPerMessage) + " ..."
          : rawText;

      const sender = m?.sender || (m?.senderId === "AI" ? "AI Bot" : "User");
      return `${i + 1}. ${sender}: ${clipped}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildPrivacyInstruction({ decryptForAI }) {
  if (decryptForAI) {
    return (
      `The user explicitly allowed original sensitive values to be included for this request.\n` +
      `Use them normally, but do not invent or expand beyond the provided content.\n` +
      `If the user asks for the exact value that was shared earlier, you may return that plaintext value from the provided context.`
    );
  }

  return (
    `Sensitive items may appear as AES-encrypted markers like [encrypted-type:v1:...].\n` +
    `Treat them as protected values and do not guess or invent the underlying plaintext.\n` +
    `You may still reason about the type of value that was shared, for example a phone number, email, ID, or token.\n` +
    `If the user asks you to send back, identify, or quote the protected value, you may return the exact encrypted marker from the provided context.\n` +
    `Do not claim the encrypted marker is plaintext.`
  );
}

export async function buildAskAIContext({
  scope,
  messages,
  targetMessage,
  promptBody,
  decryptForAI = false,
}) {
  const targetId = targetMessage?.id;
  const selectedHistory = selectHistoryMessages({
    scope,
    messages,
    targetMessageId: targetId,
  });

  const privacyOptions = {
    passphrase: createEphemeralPassphrase(),
    decryptForAI,
  };

  const safeHistoryText = await applyPrivacyFilter(
    stringifyMessagesForPrompt(selectedHistory),
    privacyOptions
  );

  const safePromptBody = await applyPrivacyFilter(promptBody || "", privacyOptions);
  const scopeLabel = getScopeLabel(scope);
  const privacyInstruction = buildPrivacyInstruction({ decryptForAI });

  let prompt = "";

  if (scope === ASK_AI_SCOPES.MESSAGE_ONLY) {
    prompt =
      `You are helping inside a Honeycomb chat.\n` +
      `The user asked you to answer using ${scopeLabel}.\n` +
      `${privacyInstruction}\n\n` +
      `Answer the target message as the user's current question or request.\n` +
      `Do not simply restate or mirror the target message.\n` +
      `If the target message contains a protected value, respond to the fact that the value was shared and what it means in context.\n` +
      `If the user is asking for the previously shared value itself, answer with that value in the form available in context.\n` +
      `Target message:\n${safePromptBody}`;
  } else {
    prompt =
      `You are helping inside a Honeycomb chat.\n` +
      `The user asked you to answer using ${scopeLabel}.\n` +
      `${privacyInstruction}\n` +
      `Answer the target message as the user's current question or request.\n` +
      `Use the conversation context below as supporting context for that answer.\n` +
      `Do not answer each prior message separately.\n\n` +
      `Do not simply restate or mirror the target message.\n` +
      `If the target message contains a protected value, respond to the fact that the value was shared and what it means in context.\n\n` +
      `If the user is asking for the previously shared value itself, answer with that value in the form available in context.\n\n` +
      `Conversation context:\n${safeHistoryText || "[no prior context found]"}\n\n` +
      `Target message:\n${safePromptBody}`;
  }

  return {
    prompt,
    history: [],
  };
}

