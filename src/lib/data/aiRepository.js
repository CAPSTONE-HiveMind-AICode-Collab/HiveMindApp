// src/lib/data/aiRepository.js
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";

// --- EXISTING FUNCTION ---
export async function callGeminiAPI(userText, model) {
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

    if (response.status === 429) {
      return "⚠️ Gemini rate limit/quota exceeded (429).";
    }

    if (!response.ok) {
      return data?.error || "Failed to get AI response";
    }

    return data.reply || "No response generated.";
  } catch (error) {
    console.error("AI repository error:", error);
    return "Error connecting to AI service.";
  }
}

// --- NEW KNOWLEDGE NECTAR FUNCTION ---
/**
 * Triggers a RAG (Retrieval-Augmented Generation) flow.
 * It pulls the 'Nectar' from Firestore and feeds it as context to Gemini.
 */
export async function askHiveMemory(hiveID, userQuestion, model = "gemini-2.5-flash") {
  try {
    // 1. Fetch the Knowledge Nectar (Project Memory)
    // Note: Make sure that the 'Hive' matches the case in your Firestore exactly
    const nectarRef = collection(db, "Hive", hiveID, "knowledgeNectar");
    const snapshot = await getDocs(nectarRef);
    
    if (snapshot.empty) {
      return "I don't have any project memory stored yet. Try closing a thread first!";
    }

    const memoryEntries = snapshot.docs.map(doc => doc.data());

    // 2. Format the memory entries into a single string for the prompt
    const contextContext = memoryEntries
      .map(m => `TITLE: ${m.title}\nDECISION: ${m.decision}\nSUMMARY: ${m.summary}`)
      .join("\n\n---\n\n");

    // 3. Build a "Grounded" Prompt
    const groundedPrompt = `
      You are the HiveMind Memory Assistant. Use the "PROJECT MEMORY" below to answer the user's question.
      
      RULES:
      - Only use information from the PROJECT MEMORY.
      - If the answer is not there, say: "That information is not in my memory yet."
      - Be concise and factual.

      --- PROJECT MEMORY ---
      ${contextContext}
      --- END OF MEMORY ---

      USER QUESTION: ${userQuestion}
    `;

    // 4. Pass this grounded prompt to your existing API caller
    return await callGeminiAPI(groundedPrompt, model);

  } catch (error) {
    console.error("Memory retrieval error:", error);
    return "Failed to access Hive memory.";
  }
}