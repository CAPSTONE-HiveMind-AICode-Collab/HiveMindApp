import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { callGeminiAPI } from "@/lib/data/aiRepository";

export const NectarRepository = {
  async distillAndSave(hiveId, threadContext) {
    const extractionPrompt = `
      Extract project knowledge from this conversation. 
      Return ONLY a raw JSON object. Do not include markdown formatting or backticks.
      
      Structure:
      {
        "title": "Short title",
        "summary": "1 sentence overview",
        "decision": "The final decision",
        "tags": ["keywords"],
        "relatedFiles": []
      }

      Conversation:
      ${threadContext}
    `;

    const aiResponse = await callGeminiAPI(extractionPrompt);
    
    // --- CLEANING STEP ---
    // This regex removes ```json or ``` and any trailing backticks
    const cleanJson = aiResponse.replace(/```json|```/g, "").trim();
    
    try {
      const distilledData = JSON.parse(cleanJson);

      const nectarRef = collection(db, "Hive", hiveId, "knowledgeNectar");
      return await addDoc(nectarRef, {
        ...distilledData,
        createdAt: serverTimestamp(),
      });
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON. Raw response was:", aiResponse);
      throw parseError; // Rethrow so the page knows it failed
    }
  }
};