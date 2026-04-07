import { db } from "@/lib/firebase/config";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { extractJsonObject } from "@/lib/ai/structuredOutput";

function cleanString(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cleanStringArray(values) {
  return Array.isArray(values)
    ? values.map((value) => cleanString(value)).filter(Boolean)
    : [];
}

function buildFallbackNectarEntry(threadContext = "") {
  const lines = String(threadContext || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const titleSource = lines[0] || "Conversation knowledge";
  const summarySource = lines.slice(0, 3).join(" ");

  return {
    title: cleanString(titleSource, "Conversation knowledge").slice(0, 120),
    summary: cleanString(summarySource || threadContext, "Knowledge captured from a closed thread.").slice(0, 280),
    decision: cleanString(summarySource || threadContext, "No final decision captured."),
    tags: [],
    relatedFiles: [],
  };
}

function normalizeNectarEntry(raw, fallback) {
  return {
    title: cleanString(raw?.title, fallback.title).slice(0, 120),
    summary: cleanString(raw?.summary, fallback.summary).slice(0, 280),
    decision: cleanString(raw?.decision, fallback.decision).slice(0, 280),
    tags: cleanStringArray(raw?.tags).slice(0, 8),
    relatedFiles: cleanStringArray(raw?.relatedFiles).slice(0, 12),
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function scoreNectarEntry(entry, tags) {
  if (!tags.length) {
    return toMillis(entry.createdAt || entry.updatedAt);
  }

  const searchable = [
    entry.title,
    entry.summary,
    entry.decision,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return tags.reduce((score, tag) => {
    return score + (searchable.includes(tag) ? 1 : 0);
  }, 0);
}

export const NectarRepository = {
  async distillAndSave(hiveId, threadContext) {
    const extractionPrompt = `
      Extract project knowledge from this conversation. 
      Return ONLY a raw JSON object. Do not include markdown formatting or backticks.
      
      Structure:
      {
        "title": "Short title",
        "summary": "1 sentence overview",
        "decision": "The final decision",
        "tags": ["keywords"],
        "relatedFiles": []
      }

      Conversation:
      ${threadContext}
    `;

    const aiResponse = await callGeminiAPI(extractionPrompt);

    const fallback = buildFallbackNectarEntry(threadContext);
    const parsed = extractJsonObject(aiResponse);
    const distilledData = normalizeNectarEntry(parsed, fallback);

    const nectarRef = collection(db, "Hive", String(hiveId), "knowledgeNectar");
    return await addDoc(nectarRef, {
      ...distilledData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  async searchByTags(hiveId, tags = [], maxResults = 8) {
    if (!hiveId) {
      throw new Error("hiveId is required");
    }

    const normalizedTags = cleanStringArray(tags).map((tag) => tag.toLowerCase());
    const nectarRef = collection(db, "Hive", String(hiveId), "knowledgeNectar");
    const nectarQuery = query(nectarRef, orderBy("createdAt", "desc"), limit(40));
    const snapshot = await getDocs(nectarQuery);

    const entries = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));

    const ranked = entries
      .map((entry) => ({
        entry,
        score: scoreNectarEntry(entry, normalizedTags),
      }))
      .filter((item) => (normalizedTags.length ? item.score > 0 : true))
      .sort((left, right) => right.score - left.score)
      .slice(0, maxResults)
      .map((item) => item.entry);

    return ranked;
  },
};
