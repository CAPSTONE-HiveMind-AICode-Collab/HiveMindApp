function cleanString(value, fallback = "") {
  const text =
    typeof value === "string"
      ? value
      : value === undefined || value === null
      ? ""
      : String(value);
  return text.trim() || fallback;
}

function cleanStringArray(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function extractJsonObject(raw) {
  const text = cleanString(raw);
  if (!text) return null;

  const cleaned = text.replace(/```json|```/gi, "").trim();
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }

  return null;
}

function normalizeChatCitationPayload(raw, allowedDecisionIds = []) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const allowedIds = new Set((allowedDecisionIds || []).map(String));
  return {
    answer: cleanString(parsed.answer || parsed.reply),
    citationDecisionIds: cleanStringArray(parsed.citationDecisionIds, 4).filter((id) =>
      allowedIds.has(id)
    ),
  };
}

function normalizeDecisionRecordPayload(raw, fallback = {}) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return {
      title: cleanString(fallback.title, "Decision Record"),
      summary: cleanString(fallback.summary),
      rationale: cleanString(fallback.rationale),
      decision: cleanString(fallback.decision || fallback.summary),
      tags: cleanStringArray(fallback.tags),
      risks: cleanStringArray(fallback.risks),
      actionItems: cleanStringArray(fallback.actionItems),
    };
  }

  return {
    title: cleanString(parsed.title || fallback.title, "Decision Record"),
    summary: cleanString(parsed.summary || fallback.summary),
    rationale: cleanString(parsed.rationale || fallback.rationale),
    decision: cleanString(parsed.decision || fallback.decision || fallback.summary),
    tags: cleanStringArray(parsed.tags),
    risks: cleanStringArray(parsed.risks),
    actionItems: cleanStringArray(parsed.actionItems),
  };
}

function normalizeBriefingPayload(
  raw,
  {
    fallback,
    allowedDecisionIds = [],
    allowedTaskIds = [],
    allowedRoomIds = [],
  } = {}
) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return fallback || null;
  }

  const decisionIdSet = new Set((allowedDecisionIds || []).map(String));
  const taskIdSet = new Set((allowedTaskIds || []).map(String));
  const roomIdSet = new Set((allowedRoomIds || []).map(String));

  return {
    welcomeTitle: cleanString(parsed.welcomeTitle || fallback?.welcomeTitle),
    welcomeBody: cleanString(parsed.welcomeBody || fallback?.welcomeBody),
    decisionIds: cleanStringArray(parsed.decisionIds, 3).filter((id) => decisionIdSet.has(id)),
    blockerTaskIds: cleanStringArray(parsed.blockerTaskIds, 2).filter((id) =>
      taskIdSet.has(id)
    ),
    nextTaskIds: cleanStringArray(parsed.nextTaskIds, 2).filter((id) => taskIdSet.has(id)),
    roomIdsToWatch: cleanStringArray(parsed.roomIdsToWatch, 3).filter((id) =>
      roomIdSet.has(id)
    ),
    suggestedQuestions: cleanStringArray(parsed.suggestedQuestions, 5),
  };
}

module.exports = {
  cleanString,
  cleanStringArray,
  extractJsonObject,
  normalizeChatCitationPayload,
  normalizeDecisionRecordPayload,
  normalizeBriefingPayload,
};
