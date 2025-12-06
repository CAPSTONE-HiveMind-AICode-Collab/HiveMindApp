<<<<<<< HEAD
export async function callGeminiAPI(userText) {
=======
// src/lib/data/aiRepository.js
export async function callGeminiAPI(userText, model) {
>>>>>>> 789492608f754fef08bf36f559232de36e1792b4
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText, model }),
    });

<<<<<<< HEAD
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
=======
    if (!response.ok) {
      // Try to include server error body for debugging
      let bodyText = "";
      try {
        const txt = await response.text();
        bodyText = txt;
      } catch (e) {
        bodyText = "(failed to read response body)";
      }
      const err = new Error(`Failed to get AI response (status ${response.status}): ${bodyText}`);
      err.status = response.status;
      err.body = bodyText;
      throw err;
>>>>>>> 789492608f754fef08bf36f559232de36e1792b4
    }

    return data.reply || "Sorry, I couldn’t generate a response.";
  } catch (error) {
    console.error("AI repository error:", error);
    // Surface the server-side error text in dev to help debugging (still return friendly text)
    return `There was an error connecting to the AI service. ${error?.message || ""}`;
  }
}
