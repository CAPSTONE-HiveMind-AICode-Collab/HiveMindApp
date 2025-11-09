// src/lib/business/chatService.js
import { addMessageToDB, listenToMessages } from "../data/firestoreRepository";
import { callGeminiAPI } from "../data/aiRepository";

/**
 * Subscribe to messages in a Hive/Honeycomb
 */
export function subscribeToChatMessages(callback, hiveID, honeycombID) {
  return listenToMessages(callback, hiveID, honeycombID);
}

/**
 * Send a user message in Hive/Honeycomb
 */
export async function sendUserMessage(user, text, hiveID, honeycombID) {
  return addMessageToDB(
    {
      text,
      sender: user.displayName,
      senderId: user.uid,
    },
    hiveID,
    honeycombID
  );
}

/**
 * Send an AI reply in Hive/Honeycomb
 */
export async function sendAIReply(text, hiveID, honeycombID) {
  const aiText = await callGeminiAPI(text);
  return addMessageToDB(
    {
      text: aiText.trim(),
      sender: "HiveMind AI",
      senderId: "AI",
    },
    hiveID,
    honeycombID
  );
}
