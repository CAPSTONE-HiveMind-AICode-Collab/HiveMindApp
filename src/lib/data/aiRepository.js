// src/lib/data/aiRepository.js
export async function callGeminiAPI(userText) {
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userText }),
    });

    if (!response.ok) throw new Error("Failed to get AI response");

    const data = await response.json();
    return data.reply || "Sorry, I couldn’t generate a response.";
  } catch (error) {
    console.error("AI repository error:", error);
    return "There was an error connecting to the AI service.";
  }
}
