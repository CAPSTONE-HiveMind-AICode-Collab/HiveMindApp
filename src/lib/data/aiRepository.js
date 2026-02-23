// src/lib/data/aiRepository.js

export async function callGeminiAPI(userText, model, history = []) {
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userText,
        model,
        history, // send context
      }),
    });

    const data = await response.json().catch(() => ({}));

    // Friendly quota message
    if (response.status === 429) {
      return (
        "⚠️ Gemini rate limit/quota exceeded (429). " +
        "Try fewer requests, shorten prompts (especially big pasted/uploaded text), " +
        "or check quotas in the Gemini/Firebase console."
      );
    }

    if (!response.ok) {
      const msg =
        typeof data?.error === "string"
          ? data.error
          : data?.error?.message || "Failed to get AI response";
      return msg;
    }

    return data.reply || "Sorry, I couldn’t generate a response.";
  } catch (error) {
    console.error("AI repository error:", error);
    return "There was an error connecting to the AI service.";
  }
}
