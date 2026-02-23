// src/app/api/ai/route.js
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

// Attempt to extract useful details from Gemini SDK errors
function extractGeminiError(err) {
  const rawMessage = String(err?.message || "");
  let parsed = null;

  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    const start = rawMessage.indexOf("{");
    const end = rawMessage.lastIndexOf("}");
    if (start >= 0 && end >= 0 && end > start) {
      try {
        parsed = JSON.parse(rawMessage.slice(start, end + 1));
      } catch {}
    }
  }

  const apiErr = parsed?.error || null;
  return {
    code: apiErr?.code,
    status: apiErr?.status,
    message: apiErr?.message || rawMessage || "Unknown error",
    raw: rawMessage,
    parsed,
  };
}

function isQuotaError(e) {
  return (
    e?.code === 429 ||
    e?.status === "RESOURCE_EXHAUSTED" ||
    String(e?.message || "").includes("429") ||
    /quota|Too Many Requests|RESOURCE_EXHAUSTED/i.test(String(e?.message || ""))
  );
}

//  only allow models your UI supports
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
]);

function normalizeModelName(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/^models\//, "");
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  // expect: { role: "user"|"model", parts: [{ text: "..." }] }
  return history
    .filter((h) => h && typeof h === "object")
    .map((h) => {
      const role = h.role === "model" ? "model" : "user";
      const parts = Array.isArray(h.parts) ? h.parts : [];
      const cleanParts = parts
        .map((p) => ({ text: String(p?.text ?? "") }))
        .filter((p) => p.text.trim().length > 0);

      return { role, parts: cleanParts };
    })
    .filter((h) => h.parts.length > 0)
    .slice(-20); // keep last N turns only (avoid huge prompts)
}

export async function POST(req) {
  const payload = await req.json().catch(() => ({}));

  const message =
    typeof payload?.message === "string" ? payload.message.trim() : "";
  const requestedModel = payload?.model;

  // history from client (optional)
  const history = sanitizeHistory(payload?.history);

  if (!message) {
    return NextResponse.json({ reply: "No message provided" }, { status: 400 });
  }

  // Prefer GEMINI_API_KEY; fall back to GENAI_API_KEY
  const apiKey = process.env.GEMINI_API_KEY || process.env.GENAI_API_KEY || "";

  // Demo mode support
  const demoEnv =
    process.env.NEXT_PUBLIC_AI_DEMO === "true" ||
    process.env.AI_DEMO === "1" ||
    process.env.AI_DEMO === "true";

  //  model routing (allowlist + default)
  const envModel = process.env.GENAI_MODEL || process.env.GEMINI_MODEL || "";
  const candidate = normalizeModelName(requestedModel || envModel);

  const modelName = ALLOWED_MODELS.has(candidate)
    ? candidate
    : "gemini-2.5-flash";

  // 1) Primary: Gemini via @google/genai if api key exists
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });

      const contents =
        history.length > 0
          ? [
              ...history,
              { role: "user", parts: [{ text: message }] },
            ]
          : [{ role: "user", parts: [{ text: message }] }];

      const result = await ai.models.generateContent({
        model: modelName,
        contents,
      });

      const reply = result?.text || "Sorry, I couldn’t generate a response.";
      return NextResponse.json({ reply, provider: "genai", model: modelName });
    } catch (err) {
      const e = extractGeminiError(err);

      if (isQuotaError(e)) {
        return NextResponse.json(
          {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message:
                e?.message ||
                "You exceeded your current quota. Shorten prompts / reduce frequency / check plan.",
            },
            provider: "genai",
            model: modelName,
          },
          { status: 429 }
        );
      }

      console.error("GenAI (GoogleGenAI) error:", err);
    }
  }

  // 2) Demo fallback
  if (demoEnv) {
    return NextResponse.json({
      reply: `Demo AI: ${message}`,
      demo: true,
      provider: "demo",
      model: modelName,
    });
  }

  // 3) Firebase model fallback
  try {
    const mod = await import("@/lib/firebase/config");
    const firebaseModel = mod?.model;

    if (firebaseModel && typeof firebaseModel.generateContent === "function") {
      const result = await firebaseModel.generateContent(message);
      const response = await result.response;
      const reply =
        response && typeof response.text === "function"
          ? response.text()
          : result?.text || "AI did not respond.";

      return NextResponse.json({ reply, provider: "firebase", model: modelName });
    }
  } catch (e) {
    console.warn("Firebase model fallback not available:", e?.message || e);
  }

  // 4) No provider configured
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No AI API key configured. Set GEMINI_API_KEY (recommended) or GENAI_API_KEY in .env.local.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: "AI provider failed and no fallback provider is configured." },
    { status: 500 }
  );
}
