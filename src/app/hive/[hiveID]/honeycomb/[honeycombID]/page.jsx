"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { subscribeToChatMessages, sendUserMessage, sendAIReply } from "@/lib/business/chatService";

export default function HoneycombChatPage({ user }) {
  const { hiveID, honeycombID } = useParams();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loadingAI, setLoadingAI] = useState(false);

  // Listen for chat messages
  useEffect(() => {
    if (!hiveID || !honeycombID) return;
    const unsubscribe = subscribeToChatMessages(setMessages, hiveID, honeycombID);
    return unsubscribe;
  }, [hiveID, honeycombID]);

  // Send message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() || !user) return;
    try {
      await sendUserMessage(user, message, hiveID, honeycombID);
      setMessage("");
    } catch (err) {
      console.error("Send message failed:", err);
    }
  };

  // Ask AI
  const handleAIReply = async (text) => {
    if (!text) return;
    try {
      setLoadingAI(true);
      await sendAIReply(text, hiveID, honeycombID);
    } catch (err) {
      console.error("AI request failed:", err);
    } finally {
      setLoadingAI(false);
    }
  };

  // Format messages
  const renderMessageText = (text) => {
    const parts = text.split(/```/);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <pre key={i} className="bg-gray-300 p-2 rounded text-sm overflow-x-auto border border-gray-900">
          <button
            className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 ml-2 cursor-pointer"
            onClick={() => navigator.clipboard.writeText(part)}
          >
            Copy
          </button>
          <code>{part}</code>
        </pre>
      ) : (
        <p key={i} className="text-sm text-gray-900 break-words">{part}</p>
      )
    );
  };

  return (
    <div className="flex flex-col h-screen bg-yellow-50">
      {/* Header with Back button */}
      <header className="p-4 bg-yellow-500 text-white flex justify-between items-center border-b border-yellow-700">
        <h1 className="font-bold text-lg">🐝 {hiveID} / {honeycombID}</h1>
        <button
          onClick={() => router.push(`/hive/${hiveID}`)}
          className="bg-white text-yellow-500 px-3 py-1 rounded hover:bg-gray-100 border border-yellow-700"
        >
          Back to Hive
        </button>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-2 rounded-lg break-words ${
              m.senderId === user.uid
                ? "bg-yellow-300 ml-auto w-1/2 border border-yellow-700"
                : "bg-white w-1/2 border border-gray-400"
            }`}
          >
            <p className="text-sm font-bold underline text-gray-800">{m.sender}</p>
            <div className="text-sm text-gray-900">{renderMessageText(m.text)}</div>

            {m.senderId === user.uid && (
              <button
                className="mt-1 text-xs text-blue-600 hover:underline"
                onClick={() => handleAIReply(m.text)}
                disabled={loadingAI}
              >
                {loadingAI ? "Thinking..." : "Ask AI 🤖"}
              </button>
            )}
          </div>
        ))}
      </main>

      {/* Message input */}
      <form
        onSubmit={handleSendMessage}
        className="p-4 flex bg-white border-t border-gray-300"
      >
        <input
          className="flex-1 border border-gray-400 rounded-lg p-2 mr-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="submit"
          className="bg-yellow-400 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500 border border-yellow-700"
        >
          Send
        </button>
      </form>
    </div>
  );
}
