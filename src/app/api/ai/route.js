// src/app/api/ai/route.js
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  adminAuth,
  adminDb,
  isFirebaseAdminConfigured,
} from "@/lib/firebase/firebaseAdmin";
import {
  limitHistoryByScope,
  resolveScopeForRole,
} from "@/lib/business/contextBuilderService";
import { extractJsonObject } from "@/lib/ai/structuredOutput";

export const runtime = "nodejs";

const ALLOWED_GEMINI_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
]);

const DEFAULT_ROLE = "VIEWER";

function extractGeminiError(err) {
  const rawMessage = String(err?.message || "");
  const parsed = extractJsonObject(rawMessage);

  const apiErr = parsed?.error || null;
  return {
    code: apiErr?.code,
    status: apiErr?.status,
    message: apiErr?.message || rawMessage || "Unknown error",
    raw: rawMessage,
    parsed,
  };
}

function isRateLimitError(error) {
  const status = String(error?.status || "");
  const message = String(error?.message || "");

  return (
    error?.code === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    status === "rate_limit_error" ||
    /quota|Too Many Requests|RESOURCE_EXHAUSTED|rate limit|rate_limit|throttl/i.test(
      message
    )
  );
}

function normalizeModelName(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/^models\//, "");
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const role = item.role === "model" ? "model" : "user";
      const parts = Array.isArray(item.parts) ? item.parts : [];
      const cleanParts = parts
        .map((part) => ({ text: String(part?.text ?? "") }))
        .filter((part) => part.text.trim().length > 0);

      return { role, parts: cleanParts };
    })
    .filter((item) => item.parts.length > 0)
    .slice(-20);
}

function getBearerToken(req) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function sanitizeContext(rawContext) {
  const context =
    rawContext && typeof rawContext === "object" ? rawContext : {};

  return {
    hiveID: typeof context.hiveID === "string" ? context.hiveID.trim() : "",
    honeycombID:
      typeof context.honeycombID === "string"
        ? context.honeycombID.trim()
        : "",
    scope: typeof context.scope === "string" ? context.scope.trim() : "",
    feature: typeof context.feature === "string" ? context.feature.trim() : "",
  };
}

function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

async function authenticateRequest(req, context) {
  if (!isFirebaseAdminConfigured || !adminAuth) {
    return {
      error: jsonError(
        "Firebase Admin SDK is not configured. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to secure AI routes.",
        500
      ),
    };
  }

  const token = getBearerToken(req);
  if (!token) {
    return { error: jsonError("Authentication required.", 401) };
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error("AI route token verification failed:", error);
    return { error: jsonError("Invalid or expired token.", 401) };
  }

  let role = DEFAULT_ROLE;
  let effectiveScope = context.scope || "";

  if (context.hiveID) {
    if (!adminDb) {
      return { error: jsonError("Admin database is not configured.", 500) };
    }

    const memberRef = adminDb
      .collection("Hive")
      .doc(context.hiveID)
      .collection("members")
      .doc(decodedToken.uid);
    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      return {
        error: jsonError("You do not have access to this hive.", 403),
      };
    }

    role = String(memberSnap.data()?.role || DEFAULT_ROLE).toUpperCase();
    effectiveScope = context.scope
      ? resolveScopeForRole(context.scope, role)
      : "";

    if (context.feature === "chat_reply" && role === DEFAULT_ROLE) {
      return {
        error: jsonError(
          "Your role does not allow AI chat replies in this hive.",
          403
        ),
      };
    }
  }

  return {
    auth: {
      uid: decodedToken.uid,
      role,
      effectiveScope,
    },
  };
}

export async function POST(req) {
  const payload = await req.json().catch(() => ({}));
  const message =
    typeof payload?.message === "string" ? payload.message.trim() : "";
  const requestedModel = payload?.model;
  const context = sanitizeContext(payload?.context);

  const authResult = await authenticateRequest(req, context);
  if (authResult.error) {
    return authResult.error;
  }

  const requestedHistory = sanitizeHistory(payload?.history);
  const history = context.scope
    ? limitHistoryByScope(requestedHistory, authResult.auth.effectiveScope)
    : requestedHistory;

  if (!message) {
    return jsonError("No message provided", 400);
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GENAI_API_KEY || "";
  const demoEnv =
    process.env.NEXT_PUBLIC_AI_DEMO === "true" ||
    process.env.AI_DEMO === "1" ||
    process.env.AI_DEMO === "true";

  const envGeminiModel = process.env.GENAI_MODEL || process.env.GEMINI_MODEL || "";
  const geminiCandidate = normalizeModelName(requestedModel || envGeminiModel);
  const geminiModel = ALLOWED_GEMINI_MODELS.has(geminiCandidate)
    ? geminiCandidate
    : "gemini-2.5-flash";

  if (geminiApiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const contents =
        history.length > 0
          ? [...history, { role: "user", parts: [{ text: message }] }]
          : [{ role: "user", parts: [{ text: message }] }];

      const result = await ai.models.generateContent({
        model: geminiModel,
        contents,
      });

      const reply = result?.text || "Sorry, I couldn't generate a response.";
      return NextResponse.json({
        reply,
        provider: "genai",
        model: geminiModel,
        role: authResult.auth.role,
        effectiveScope: authResult.auth.effectiveScope || null,
      });
    } catch (error) {
      const details = extractGeminiError(error);

      if (isRateLimitError(details)) {
        return NextResponse.json(
          {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message:
                details?.message ||
                "Gemini temporarily throttled the request. Please try again in a minute.",
            },
            provider: "genai",
            model: geminiModel,
          },
          { status: 429 }
        );
      }

      console.error("GenAI (GoogleGenAI) error:", error);
    }
  }

  if (demoEnv) {
    return NextResponse.json({
      reply: `Demo AI: ${message}`,
      demo: true,
      provider: "demo",
      model: geminiModel,
      role: authResult.auth.role,
      effectiveScope: authResult.auth.effectiveScope || null,
    });
  }

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

      return NextResponse.json({
        reply,
        provider: "firebase",
        model: geminiModel,
        role: authResult.auth.role,
        effectiveScope: authResult.auth.effectiveScope || null,
      });
    }
  } catch (error) {
    console.warn("Firebase model fallback not available:", error?.message || error);
  }

  if (!geminiApiKey) {
    return jsonError(
      "No AI API key configured. Set GEMINI_API_KEY or GENAI_API_KEY in .env.local.",
      500
    );
  }

  return jsonError(
    "AI provider failed and no fallback provider is configured.",
    500
  );
}
