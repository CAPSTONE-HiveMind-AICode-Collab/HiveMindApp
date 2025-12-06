export async function callGeminiAPI(userText) {
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 429) {
      // Show a friendly message in the chat instead of exploding
      return (
        "⚠️ Gemini rate limit/quota exceeded (429). " +
        "Try fewer requests, and shorten prompts (big uploaded text files can hit token limits fast). " +
        "You can also check your usage/limits in the Gemini/Firebase AI Logic console."
      );
    }

    if (!response.ok) {
      return data?.error || "There was an error connecting to the AI service.";
    }

    return data.reply || "Sorry, I couldn’t generate a response.";
  } catch (error) {
    console.error("AI repository error:", error);
    return "There was an error connecting to the AI service.";
  }
}
