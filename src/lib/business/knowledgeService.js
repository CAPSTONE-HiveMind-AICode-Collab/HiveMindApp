import { NectarRepository } from "../data/nectarRepository";
import { callGeminiAPI } from "../data/aiRepository";

export const KnowledgeService = {
  async askHive(hiveId, userQuestion, tags = []) {
    // 1. Fetch relevant Nectar entries based on tags
    const contextEntries = await NectarRepository.searchByTags(hiveId, tags);

    if (!contextEntries.length) {
      return "I don't have that information in my memory yet.";
    }
    
    // 2. Build the RAG Prompt
    const contextString = contextEntries
      .map(en => `Topic: ${en.title}\nDecision: ${en.decision}\nSummary: ${en.summary}`)
      .join("\n---\n");

    const ragPrompt = `
      You are the Hive Mind assistant. Use ONLY the project knowledge below to answer.
      If the answer isn't in the context, say "I don't have that information in my memory yet."
      
      Project Knowledge:
      ${contextString}
      
      User Question: ${userQuestion}
    `;

    // 3. Call AI with grounded context
    return await callGeminiAPI(ragPrompt);
  }
};
