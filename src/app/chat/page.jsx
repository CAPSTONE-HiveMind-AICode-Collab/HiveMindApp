"use client";

import { useEffect, useState } from "react";
import { db, auth, provider, model } from "@/firebase/config";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loadingAI, setLoadingAI] = useState(false);

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  // Firestore message listener
  useEffect(() => {
    const q = query(collection(db, "chatrooms", "main", "messages"), orderBy("timestamp", "asc"));
    const unsub = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return unsub;
  }, []);

  // Send user message
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    try {
      await addDoc(collection(db, "chatrooms", "main", "messages"), {
        text: message,
        sender: user.displayName,
        senderId: user.uid,
        timestamp: serverTimestamp(),
      });
      setMessage("");
    } catch (err) {
      console.error("Send message failed:", err);
    }
  };

  // Ask AI to reply
  const handleAIReply = async (userMessage) => {
    if (!userMessage) return;

    try {
      setLoadingAI(true);

        const result = await model.generateContent(userMessage, {
            maxOutputTokens: 128, // limit the AI response length
            temperature: 0.7,     // optional: adjust creativity
        });

      const aiText = result.response?.text() || "Sorry, I couldn't generate a response.";

      await addDoc(collection(db, "chatrooms", "main", "messages"), {
        text: aiText.trim(),
        sender: "HiveMind AI",
        senderId: "AI",
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("AI request failed:", err);
      alert("AI request failed. Check console for details.");
    } finally {
      setLoadingAI(false);
    }
  };

  if (!user)
    return (
      <div className="flex h-screen items-center justify-center">
        <button
          onClick={() => signInWithPopup(auth, provider)}
          className="bg-yellow-400 px-6 py-3 rounded-xl font-semibold shadow-md"
        >
          Sign in with Google 🐝
        </button>
      </div>
    );

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="p-4 bg-yellow-500 text-white flex justify-between items-center">
        <h1 className="font-bold text-lg">Hive Mind Chat</h1>
        <button
          onClick={() => signOut(auth)}
          className="bg-white text-yellow-500 px-3 py-1 rounded hover:bg-gray-100"
        >
          Sign Out
        </button>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-2 bg-yellow-50">
        {messages.map((m) => (
            <div
                key={m.id}
                className={`p-2 rounded-lg break-words
                ${m.senderId === user.uid 
                    ? "bg-yellow-300 ml-auto w-1/2"   // Your own messages: right-aligned, half screen
                    : "bg-white w-1/2"}               // AI/other messages: left-aligned, half screen
                `}
            >
                <p className="text-sm font-semibold text-gray-700">{m.sender}</p>
                <p className="text-sm text-gray-900">{m.text}</p>
                {m.senderId === user.uid && (
                <button
                    className="mt-1 text-xs text-blue-600 hover:underline"
                    onClick={() => handleAIReply(m.text)}
                    disabled={loadingAI}
                >
                    {loadingAI ? "Thinking..." : "Ask AI"}
                </button>
                )}
            </div>
            ))}
      </main>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-4 flex bg-white border-t border-gray-200">
        <input
          className="flex-1 border border-gray-400 rounded-lg p-2 mr-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="submit"
          className="bg-yellow-400 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500"
        >
          Send
        </button>
      </form>
    </div>
  );
}
