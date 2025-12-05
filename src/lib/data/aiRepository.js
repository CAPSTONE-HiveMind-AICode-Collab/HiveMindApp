// src/lib/data/aiRepository.js
export async function callGeminiAPI(userText, model) {
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText, model }),
    });

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
    }

    const data = await response.json();
    return data.reply || "Sorry, I couldn’t generate a response.";
  } catch (error) {
    console.error("AI repository error:", error);
    // Surface the server-side error text in dev to help debugging (still return friendly text)
    return `There was an error connecting to the AI service. ${error?.message || ""}`;
  }
}
