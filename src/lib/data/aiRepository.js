// src/lib/data/aiRepository.js
import { db } from "@/lib/firebase/config";
import { auth } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";

/**
 * Few-shot examples for better AI responses
 * Used as part of prompt engineering for consistent, high-quality outputs
 */
const RESPONSE_EXAMPLES = {
  technical: {
    example: "User: How do I fix a React hooks error?\nAI: React hooks must be called at the top level of functional components. Common issues:\n1. **Calling inside loops/conditions** - hooks rely on call order\n2. **Hooks in class components** - only use in functional components\n3. **Custom hooks without 'use' prefix** - helps tools identify them\n\nExample fix:\n```javascript\n// ❌ Wrong\nif (condition) useEffect(() => {});\n\n// ✅ Correct\nuseEffect(() => {\n  if (condition) { /* logic */ }\n}, [condition]);\n```",
  },
  summary: {
    example: "Conversation:\nUser1: We need to refactor our database schema\nUser2: Agree, the current structure doesn't scale\nUser3: I'll work on creating migration scripts\n\nAI Summary:\nTitle: Database Refactoring Initiative\nSummary: The team identified scalability issues with the current database schema and decided to proceed with refactoring. User3 volunteered to create migration scripts.\nFollow-ups: Review migration script implementation, test on staging environment",
  },
};

// --- EXISTING FUNCTION (Enhanced with Firebase Auth token + Few-Shot Learning) ---
/**
 * callGeminiAPI – sends a message to the /api/ai route.
 *
 * SECURITY: Attaches the current user's Firebase ID token as a Bearer token.
 * The server-side route verifies this token with the Admin SDK before
 * processing the request, ensuring only authenticated users can invoke AI.
 */
export async function callGeminiAPI(userText, model) {
  try {
    // Obtain the short-lived Firebase ID token for the current user.
    // getIdToken(false) returns the cached token; it refreshes automatically
    // when it expires (< 1 h). Returns null if no user is signed in.
    const currentUser = auth.currentUser;
    const idToken = currentUser ? await currentUser.getIdToken(false) : null;

    const headers = { "Content-Type": "application/json" };
    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`;
    }

    const response = await fetch("/api/ai", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: userText, model }),
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

/**
 * Enhanced AI call with few-shot learning examples
 * Better for technical questions and code-related discussions
 */
export async function callGeminiAPIManyShot(userText, model, contextType = "technical") {
  const examples = RESPONSE_EXAMPLES[contextType] || RESPONSE_EXAMPLES.technical;
  
  const enhancedPrompt = `You are a helpful AI assistant in a collaborative team workspace. Provide clear, concise, and actionable responses.

RESPONSE STYLE GUIDE:
- Be specific with examples or code when relevant
- Use structured formatting (lists, code blocks) for clarity
- Keep responses focused and avoid unnecessary verbosity
- Acknowledge nuance: "It depends on..." when context matters

EXAMPLE OF GOOD RESPONSE:
${examples.example}

USER MESSAGE:
${userText}`;

  return callGeminiAPI(enhancedPrompt, model);
}

// --- NEW KNOWLEDGE NECTAR FUNCTION ---
/**
 * Triggers a RAG (Retrieval-Augmented Generation) flow.
 * It pulls the 'Nectar' from Firestore and feeds it as context to Gemini.
 */
export async function askHiveMemory(hiveID, userQuestion, model = "gemini-2.5-flash") {
  try {
    // 1. Fetch the Knowledge Nectar (Project Memory)
    // Note: Make sure 'Hive' matches the case in your Firestore exactly
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