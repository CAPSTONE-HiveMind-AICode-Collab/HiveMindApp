import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

function extractGeminiError(err) {
  // Sometimes the SDK error message contains JSON like:
  // {"error":{"code":429,"message":"...","status":"RESOURCE_EXHAUSTED"}}
  const rawMessage = String(err?.message || "");
  let parsed = null;

  // Try direct JSON parse
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    // Try to locate JSON inside message
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
  };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const message = body?.message;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY in server environment" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: message,
    });

    const reply = result?.text || "Sorry, I couldn’t generate a response.";
    return NextResponse.json({ reply });
  } catch (err) {
    const e = extractGeminiError(err);

    // Gemini docs: 429 RESOURCE_EXHAUSTED = rate limit / quota exceeded :contentReference[oaicite:2]{index=2}
    if (e?.code === 429 || e?.status === "RESOURCE_EXHAUSTED") {
      return NextResponse.json(
        {
          error:
            "Gemini rate limit/quota exceeded for this project (429 RESOURCE_EXHAUSTED). " +
            "Reduce request frequency, shorten the prompt (especially attached file text), or increase quota in the provider console.",
          details: e,
        },
        { status: 429 }
      );
    }

    console.error("AI route error:", err);
    return NextResponse.json(
      { error: e?.message || "There was an error connecting to the AI service." },
      { status: 500 }
    );
  }
}
