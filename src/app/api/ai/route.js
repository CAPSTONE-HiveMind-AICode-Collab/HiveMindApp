import { NextResponse } from "next/server";
<<<<<<< HEAD
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

=======
import { model } from "@/lib/firebase/config"; // server-only (fallback)

// This route will try to use @google/genai when `process.env.GENAI_API_KEY` is present.
// Otherwise it falls back to the existing `model.generateContent` implementation
// or the demo-mode response when `NEXT_PUBLIC_AI_DEMO` is enabled.
>>>>>>> 789492608f754fef08bf36f559232de36e1792b4
export async function POST(req) {
  // read body early
  const payload = await req.json().catch(() => ({}));
  const message = payload?.message;
  const requestedModel = payload?.model;
  if (!message) return NextResponse.json({ reply: "No message provided" }, { status: 400 });

  // Accept either GEMINI_API_KEY (quickstart) or GENAI_API_KEY (older variable name)
  if (!process.env.GEMINI_API_KEY && process.env.GENAI_API_KEY) {
    // Mirror GENAI_API_KEY into GEMINI_API_KEY so the official SDK auto-detects it if desired
    process.env.GEMINI_API_KEY = process.env.GENAI_API_KEY;
  }
  const hasGenAIKey = !!(process.env.GENAI_API_KEY || process.env.GEMINI_API_KEY);
  const demoEnv = process.env.NEXT_PUBLIC_AI_DEMO === "true" || process.env.AI_DEMO === "1";

  try {
<<<<<<< HEAD
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
=======
    if (hasGenAIKey) {
      // Try to dynamically import @google/genai and call the model.
      try {
        const genai = await import("@google/genai");

        // The SDK exposes `GoogleGenAI` with an `ai.models.generateContent` method.
        // See: node_modules/@google/genai/README.md quickstart.
        if (genai?.GoogleGenAI) {
          console.info("@google/genai detected: using GoogleGenAI class");
          const { GoogleGenAI } = genai;
          // Prefer GEMINI_API_KEY per quickstart, fall back to GENAI_API_KEY if present
          const usedKeyEnv = process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : (process.env.GENAI_API_KEY ? "GENAI_API_KEY" : null);
          const apiKeyArg = process.env.GEMINI_API_KEY || process.env.GENAI_API_KEY || undefined;
          const ai = apiKeyArg ? new GoogleGenAI({ apiKey: apiKeyArg }) : new GoogleGenAI({});
          try {
            // Prefer per-request model if provided, otherwise environment, otherwise default
            let modelName = requestedModel || process.env.GENAI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
            console.info("Calling GoogleGenAI.models.generateContent", { model: modelName, keyEnv: usedKeyEnv });
            const resp = await ai.models.generateContent({ model: modelName, contents: message });
            // resp.text is the simple helper per SDK README
            const aiReply = resp?.text || (typeof resp === "string" ? resp : JSON.stringify(resp));
            console.info("GoogleGenAI response received (truncated):", String(aiReply).slice(0, 400));
            return NextResponse.json({ reply: String(aiReply || "(no reply from GenAI)"), provider: "genai" });
          } catch (genaiCallErr) {
            console.error("GoogleGenAI generateContent error:", genaiCallErr?.message || genaiCallErr, { stack: genaiCallErr?.stack });
            // If the error looks like a quota/rate limit, attempt a cheaper fallback model once
            const msg = String(genaiCallErr?.message || genaiCallErr);
            const isQuota = msg.includes("429") || /Too Many Requests/i.test(msg) || /quota/i.test(msg);
            const fallbackModel = "gemini-2.5-flash-lite";
            if (isQuota && modelName !== fallbackModel) {
              try {
                console.info("Quota detected, retrying with fallback model", { fallbackModel });
                const fallbackResp = await ai.models.generateContent({ model: fallbackModel, contents: message });
                const fallbackReply = fallbackResp?.text || (typeof fallbackResp === "string" ? fallbackResp : JSON.stringify(fallbackResp));
                console.info("Fallback GenAI response received (truncated):", String(fallbackReply).slice(0, 400));
                return NextResponse.json({ reply: String(fallbackReply || "(no reply from GenAI)"), provider: "genai", fallback: true, fallbackModel });
              } catch (fallbackErr) {
                console.error("Fallback GenAI call failed:", fallbackErr?.message || fallbackErr);
                return NextResponse.json({ reply: "Error calling Gemini/GenAI client (fallback failed).", error: String(fallbackErr?.message || fallbackErr) }, { status: 500 });
              }
            }
            // Otherwise return the GenAI error to the client for visibility
            return NextResponse.json({ reply: "Error calling Gemini/GenAI client.", error: String(genaiCallErr?.message || genaiCallErr) }, { status: 500 });
          }
        }

        // Some distributions use a default export named GoogleGenAI as well
        if (genai?.default && genai.default.GoogleGenAI) {
          console.info("@google/genai detected on default export: using GoogleGenAI class");
          const { GoogleGenAI } = genai.default;
          const ai = new GoogleGenAI({ apiKey: process.env.GENAI_API_KEY });
          try {
            console.info("Calling GoogleGenAI.models.generateContent (default export)", { model: process.env.GENAI_MODEL || "gemini-2.0-flash-001" });
            const resp = await ai.models.generateContent({ model: process.env.GENAI_MODEL || "gemini-2.0-flash-001", contents: message });
            const aiReply = resp?.text || (typeof resp === "string" ? resp : JSON.stringify(resp));
            console.info("GoogleGenAI (default) response received (truncated):", String(aiReply).slice(0, 400));
            return NextResponse.json({ reply: String(aiReply || "(no reply from GenAI)"), provider: "genai" });
          } catch (genaiCallErr) {
            console.error("GoogleGenAI (default) generateContent error:", genaiCallErr?.message || genaiCallErr, { stack: genaiCallErr?.stack });
            return NextResponse.json({ reply: "Error calling Gemini/GenAI client.", error: String(genaiCallErr?.message || genaiCallErr) }, { status: 500 });
          }
        }

        console.warn("@google/genai installed but no usable export detected or calls failed — falling back to other providers");
      } catch (genaiErr) {
        console.error("Error using @google/genai client:", genaiErr);
        // If GenAI is configured but fails (bad key, network, etc.), fall through to other options below.
      }
    }

    // If demo mode is explicitly enabled and we didn't successfully use GenAI, return demo reply.
    if (demoEnv) {
      console.info("AI demo mode enabled — returning demo reply.");
      return NextResponse.json({ reply: `Demo AI: ${message || "<no message>"}`, demo: true });
    }

    // Fallback: try existing Firebase model.generateContent (if configured)
    if (model && typeof model.generateContent === "function") {
      const result = await model.generateContent(message);
      const response = await result.response;
      const aiReply = (response && typeof response.text === "function") ? response.text() : (result?.text || "AI did not respond.");
      return NextResponse.json({ reply: aiReply, provider: "firebase" });
    }

    // As a last resort, return a helpful error explaining that no AI provider is configured.
    return NextResponse.json({ reply: "No AI provider configured. Set GENAI_API_KEY (and install @google/genai) or enable demo mode.", error: "no_provider" }, { status: 500 });
  } catch (error) {
    console.error("AI API error:", error);

    // If rate limit / quota exceeded, return a safe demo reply (200) so the client can continue working.
    const msg = String(error?.message || error);
    if (msg.includes("429") || /Too Many Requests/i.test(msg) || /quota/i.test(msg)) {
      console.warn("AI quota exceeded — returning demo reply to client.");
      return NextResponse.json({
        reply: "Demo AI reply: quota exceeded (Too Many Requests). Enable billing or upgrade plan to use real AI.",
        error: String(error?.message || error),
        demo: true,
      }, { status: 200 });
    }

    return NextResponse.json({ reply: "Error generating AI response.", error: String(error?.message || error) }, { status: 500 });
>>>>>>> 789492608f754fef08bf36f559232de36e1792b4
  }
}
