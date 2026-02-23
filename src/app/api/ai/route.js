// src/app/api/ai/route.js
//
// SECURITY MODEL:
//   1. Firebase ID token  – every request must carry a valid Bearer token issued
//      by Firebase Auth.  The token is verified server-side with the Admin SDK
//      before any AI call is made, preventing unauthenticated access.
//   2. Input sanitisation – messages are trimmed and capped at 4 000 chars to
//      prevent prompt-injection attacks and excessive API spend.
//   3. Model allowlist     – only explicitly approved Gemini model IDs are
//      accepted; unknown model strings are rejected / coerced to the default.
//   4. Few-shot prompting  – a system instruction plus two worked examples are
//      sent on every call so the model behaves consistently and safely.

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { adminAuth } from "@/lib/firebase/firebaseAdmin";

export const runtime = "nodejs";

// ── Security: input limits ───────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 4000; // characters – prevents prompt injection / abuse

// ── Few-shot system instruction ──────────────────────────────────────────────
// Two demonstration turns teach the model the expected tone, format, and safety
// behaviour without the user needing to specify them (few-shot prompting).
const SYSTEM_INSTRUCTION = `You are HiveMind Assistant, a helpful AI embedded in a collaborative project-management workspace. Always respond in a professional, constructive tone. Never produce content that is harmful, discriminatory, or violates privacy.`;

// Few-shot examples – each pair is an example (user input → ideal model output)
const FEW_SHOT_TURNS = [
  {
    role: "user",
    parts: [{ text: "Summarise our discussion: Alice said we need a login page, Bob agreed and offered to build it." }],
  },
  {
    role: "model",
    parts: [{ text: "**Discussion Summary**\n- **Decision:** A login page is required.\n- **Owner:** Bob has volunteered to build it.\n- **Next step:** Bob should share a design or PR for team review." }],
  },
  {
    role: "user",
    parts: [{ text: "How do I fix a React hooks error?" }],
  },
  {
    role: "model",
    parts: [{ text: "React hooks must be called unconditionally at the top level of a functional component. Common fixes:\n1. **Conditional hook call** – move the condition inside the hook body.\n2. **Hook inside a loop** – extract the loop into a separate component.\n3. **Missing dependency** – pass all referenced variables to the `useEffect` dependency array.\n\n```javascript\n// ❌ Wrong\nif (loading) useEffect(() => fetchData(), []);\n\n// ✅ Correct\nuseEffect(() => { if (loading) fetchData(); }, [loading]);\n```" }],
  },
];

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

// only allow models your UI supports
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
]);

function normalizeModelName(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // strip REST-style prefix if it comes in
  const cleaned = raw.replace(/^models\//, "");

 
  return cleaned;
}

// ── Providers (Strategy Pattern) ─────────────────────────────────────────────
// Pluggable interface allows switching between Google AI, Firebase Vertex, or future providers (OpenAI etc.)

class AIProvider {
  async generate(message, modelName) { throw new Error("Not implemented"); }
}

class GoogleAIProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(message, modelName) {
    try {
      const result = await this.client.models.generateContent({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [
          ...FEW_SHOT_TURNS,
          { role: "user", parts: [{ text: message }] },
        ],
      });
      const reply = result?.text || "Sorry, I couldn’t generate a response.";
      return { reply, provider: "genai", model: modelName };
    } catch (err) {
      const e = extractGeminiError(err);
      if (isQuotaError(e)) {
        throw { status: 429, message: e.message || "Quota exceeded" };
      }
      throw err;
    }
  }
}

class DemoProvider extends AIProvider {
  async generate(message, modelName) {
    return {
      reply: `Demo AI: ${message}`,
      provider: "demo",
      model: modelName,
      demo: true,
    };
  }
}

class FirebaseVertexProvider extends AIProvider {
  async generate(message, modelName) {
    // Dynamic import to avoid server-side bundling issues if package is missing
    const mod = await import("@/lib/firebase/config");
    const firebaseModel = mod?.model;

    if (!firebaseModel || typeof firebaseModel.generateContent !== "function") {
      throw new Error("Firebase Vertex AI model not initialized");
    }

    // Firebase Vertex Web SDK doesn't support 'systemInstruction' property directly in all versions,
    // so we prepend it to the prompt (grounding).
    const fewShotPrefix = FEW_SHOT_TURNS
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.parts[0].text}`)
      .join("\n");
    const groundedMessage = `${SYSTEM_INSTRUCTION}\n\n${fewShotPrefix}\nUser: ${message}\nAssistant:`;
    
    const result = await firebaseModel.generateContent(groundedMessage);
    const response = await result.response;
    const reply = response && typeof response.text === "function" 
      ? response.text() 
      : result?.text || "AI did not respond.";
      
    return { reply, provider: "firebase", model: modelName };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────
function getActiveProvider() {
  // 1. Prefer Google GenAI (Server-side API Key)
  const apiKey = process.env.GEMINI_API_KEY || process.env.GENAI_API_KEY;
  if (apiKey) return new GoogleAIProvider(apiKey);

  // 2. Demo Mode
  const demoEnv = process.env.NEXT_PUBLIC_AI_DEMO === "true" || process.env.AI_DEMO === "true";
  if (demoEnv) return new DemoProvider();

  // 3. Fallback to Firebase Vertex (Client SDK adapted for Node)
  return new FirebaseVertexProvider();
}

export async function POST(req) {
  // ── 1. AUTH GATE: verify Firebase ID token ─────────────────────────────────
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!bearerToken) {
    return NextResponse.json({ error: "Unauthorized: missing Bearer token" }, { status: 401 });
  }

  try {
    await adminAuth.verifyIdToken(bearerToken);
  } catch {
    return NextResponse.json({ error: "Unauthorized: invalid or expired token" }, { status: 401 });
  }

  // ── 2. Parse & sanitise input ──────────────────────────────────────────────
  const payload = await req.json().catch(() => ({}));
  const rawMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
  const requestedModel = payload?.model;

  if (!rawMessage) {
    return NextResponse.json({ reply: "No message provided" }, { status: 400 });
  }

  const message = rawMessage.length > MAX_MESSAGE_LENGTH 
    ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) 
    : rawMessage;

  // ── 3. Provider Selection & Execution ──────────────────────────────────────
  // Model routing (sanitized + allowlist + better default)
  const envModel = process.env.GENAI_MODEL || process.env.GEMINI_MODEL || "";
  const candidate = normalizeModelName(requestedModel || envModel);
  const modelName = ALLOWED_MODELS.has(candidate) ? candidate : "gemini-2.5-flash";

  try {
    const provider = getActiveProvider();
    const response = await provider.generate(message, modelName);
    return NextResponse.json(response);
  } catch (error) {
    console.error("AI Provider Error:", error);

    // Handle known error types
    if (error.status === 429) {
      return NextResponse.json(
        { 
          error: { 
            code: 429, 
            status: "RESOURCE_EXHAUSTED", 
            message: error.message || "Quota exceeded." 
          } 
        }, 
        { status: 429 }
      );
    }

    // Default error response
    return NextResponse.json(
      { error: "AI provider failed to generate response." },
      { status: 500 }
    );
  }
}