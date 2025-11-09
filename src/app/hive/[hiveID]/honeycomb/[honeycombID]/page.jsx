"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useSendUserMessage,
  sendAIReply,
  subscribeToChatMessages,
  subscribeToThreadMessages,
  useSendThreadMessage,
  updateLastSeen,
  getThreadUnreadCount,
  getHoneycombUnreadCount,
} from "@/lib/business/chatService";
import { useUser } from "@/lib/auth/userContext";

export default function HoneycombChatPage() {
  const { hiveID, honeycombID } = useParams();
  const router = useRouter();
  const { user, loading } = useUser();

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState({});
  const [loadingAI, setLoadingAI] = useState(false);
  const [activeThreadMessageID, setActiveThreadMessageID] = useState(null);

  // Unread tracking
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [unreadThreads, setUnreadThreads] = useState({}); // {messageID: count}

  const sendUserMessage = useSendUserMessage();
  const sendThreadMessage = useSendThreadMessage();

  /* ----------------- MAIN CHAT SUBSCRIPTION ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID) return;

    let mounted = true;
    const unsubscribe = subscribeToChatMessages(async (msgs) => {
      if (!mounted) return;
      setMessages(msgs);

      // Check honeycomb-wide unread count
      try {
        const unreadCount = await getHoneycombUnreadCount(hiveID, honeycombID, user.uid);
        if (mounted) setUnreadMessageCount(unreadCount);
      } catch (err) {
        console.error("Failed to get honeycomb unread count:", err);
      }
    }, hiveID, honeycombID);

    // Mark honeycomb as read on open (pass user.uid in the 4th arg)
    updateLastSeen(hiveID, honeycombID, null, user.uid).catch((e) =>
      console.error("updateLastSeen (honeycomb) failed:", e)
    );

    return () => {
      mounted = false;
      unsubscribe && unsubscribe();
    };
  }, [user, hiveID, honeycombID]);

  /* ----------------- THREAD SUBSCRIPTIONS ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID) return;
    if (messages.length === 0) {
      setThreads({});
      setUnreadThreads({});
      return;
    }

    const unsubscribers = messages.map((msg) => {
      // subscribe to threads for this message
      const unsub = subscribeToThreadMessages(
        async (msgThreads) => {
          // store threads
          setThreads((prev) => ({ ...prev, [msg.id]: msgThreads }));

          // get thread-specific unread count (must call the thread helper)
          try {
            const count = await getThreadUnreadCount(hiveID, honeycombID, msg.id, user.uid);
            setUnreadThreads((prev) => ({ ...prev, [msg.id]: count }));
          } catch (err) {
            console.error(`getThreadUnreadCount failed for message ${msg.id}:`, err);
            setUnreadThreads((prev) => ({ ...prev, [msg.id]: 0 }));
          }
        },
        hiveID,
        honeycombID,
        msg.id
      );
      return unsub;
    });

    return () => unsubscribers.forEach((u) => u && u());
  }, [messages, user, hiveID, honeycombID]);

  /* ----------------- SEND MESSAGE ----------------- */
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      await sendUserMessage(message, hiveID, honeycombID);
      setMessage("");
      // mark honeycomb as seen by this user
      await updateLastSeen(hiveID, honeycombID, null, user.uid);
      // refresh unread count
      const unreadCount = await getHoneycombUnreadCount(hiveID, honeycombID, user.uid);
      setUnreadMessageCount(unreadCount);
    } catch (err) {
      console.error("Send message failed:", err);
    }
  };

  /* ----------------- SEND THREAD MESSAGE ----------------- */
  const handleSendThread = async (text, parentMessageID) => {
    if (!text.trim()) return;
    try {
      await sendThreadMessage(text, hiveID, honeycombID, parentMessageID);
      // mark this thread as seen for this user
      await updateLastSeen(hiveID, honeycombID, parentMessageID, user.uid);
      // refresh thread unread count
      const newCount = await getThreadUnreadCount(hiveID, honeycombID, parentMessageID, user.uid);
      setUnreadThreads((prev) => ({ ...prev, [parentMessageID]: newCount }));
    } catch (err) {
      console.error("Send thread failed:", err);
    }
  };

  /* ----------------- AI REPLY ----------------- */
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

  /* ----------------- THREAD OPEN ----------------- */
  const handleOpenThread = async (messageID) => {
    setActiveThreadMessageID(messageID);
    try {
      // mark thread as read for this user
      await updateLastSeen(hiveID, honeycombID, messageID, user.uid);
      // reset local unread count for that thread
      setUnreadThreads((prev) => ({ ...prev, [messageID]: 0 }));
      // refresh honeycomb unread in case header should change
      const headerCount = await getHoneycombUnreadCount(hiveID, honeycombID, user.uid);
      setUnreadMessageCount(headerCount);
    } catch (err) {
      console.error("Opening thread failed:", err);
    }
  };

  /* ----------------- HELPER: RENDER MESSAGE TEXT ----------------- */
  const renderMessageText = (text) => {
    const parts = text.split(/```/);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <pre
          key={i}
          className="bg-gray-200 p-2 rounded text-sm overflow-x-auto border border-gray-700"
        >
          <button
            className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 ml-2"
            onClick={() => navigator.clipboard.writeText(part)}
          >
            Copy
          </button>
          <code>{part}</code>
        </pre>
      ) : (
        <p key={i} className="text-sm text-gray-900 break-words">
          {part}
        </p>
      )
    );
  };

  if (loading) return <p className="p-4 text-center">Loading user info...</p>;
  if (!user) {
    router.replace("/");
    return null;
  }

  return (
    <div className="flex h-screen bg-yellow-50">
      {/* ----------------- MAIN CHAT PANEL ----------------- */}
      <div className="flex-1 flex flex-col">
        <header className="p-4 bg-yellow-500 text-white flex justify-between items-center border-b border-yellow-700">
          <h1 className="font-bold text-lg flex items-center gap-2">
            🐝 {hiveID} / {honeycombID}
            {unreadMessageCount > 0 && (
              <span
                className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs font-semibold rounded-full"
                title={`${unreadMessageCount} unread message${unreadMessageCount > 1 ? "s" : ""}`}
              >
                {unreadMessageCount}
              </span>
            )}
          </h1>
          <button
            onClick={() => router.push(`/hive/${hiveID}`)}
            className="bg-white text-yellow-500 px-3 py-1 rounded hover:bg-gray-100 border border-yellow-700"
          >
            Back to Hive
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => {
            const threadUnread = unreadThreads[m.id] || 0;
            return (
              <div
                key={m.id}
                className={`relative p-2 rounded-lg ${
                  m.senderId === user.uid ? "bg-yellow-300 ml-auto w-1/2 border border-yellow-700" : "bg-white w-1/2 border border-gray-400"
                }`}
              >
                {threadUnread > 0 && (
                  <span
                    className="absolute -top-2 -right-2 px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full shadow"
                    title={`${threadUnread} unread thread message${threadUnread > 1 ? "s" : ""}`}
                  >
                    {threadUnread}
                  </span>
                )}

                <p className="text-sm font-bold underline text-gray-800">{m.sender}</p>
                <div>{renderMessageText(m.text)}</div>

                <div className="flex space-x-3 mt-2">
                  {m.senderId === user.uid && (
                    <button className="text-xs text-blue-600 hover:underline" onClick={() => handleAIReply(m.text)} disabled={loadingAI}>
                      {loadingAI ? "Thinking..." : "Ask AI 🤖"}
                    </button>
                  )}
                  <button className="text-xs text-gray-700 hover:underline" onClick={() => handleOpenThread(m.id)}>
                    {threads[m.id]?.length > 0 ? "View Thread" : "Start Thread"}
                  </button>
                </div>
              </div>
            );
          })}
        </main>

        {/* ----------------- MESSAGE INPUT ----------------- */}
        <form onSubmit={handleSendMessage} className="p-4 flex bg-white border-t border-gray-300">
          <input
            className="flex-1 border border-gray-400 rounded-lg p-2 mr-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="submit" className="bg-yellow-400 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500 border border-yellow-700">
            Send
          </button>
        </form>
      </div>

      {/* ----------------- THREAD PANEL ----------------- */}
      {activeThreadMessageID && (
        <div className="fixed right-0 top-0 h-full w-96 bg-white border-l border-gray-300 p-4 shadow-lg flex flex-col z-50">
          <button className="bg-yellow-400 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500 border border-yellow-700 mb-3" onClick={() => setActiveThreadMessageID(null)}>
            Close
          </button>

          <div className="flex-1 overflow-y-auto">
            <p className="font-bold mb-2 text-gray-900">{messages.find((m) => m.id === activeThreadMessageID)?.text}</p>

            {(threads[activeThreadMessageID] || []).map((thread) => (
              <div key={thread.id} className="mb-2 p-2 bg-gray-100 rounded-md border border-gray-300">
                <p className="text-xs font-semibold text-gray-800">{thread.sender}</p>
                <p className="text-sm text-gray-900 break-words">{thread.text}</p>
              </div>
            ))}
          </div>

          <ThreadInput parentMessageID={activeThreadMessageID} onSend={handleSendThread} />
        </div>
      )}
    </div>
  );
}

/* ----------------- THREAD INPUT COMPONENT ----------------- */
function ThreadInput({ parentMessageID, onSend }) {
  const [text, setText] = useState("");
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text, parentMessageID);
    setText("");
  };
  return (
    <form onSubmit={handleSubmit} className="flex mt-2">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in thread..." className="flex-1 border border-gray-300 rounded-md p-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400" />
      <button type="submit" className="ml-1 px-3 py-1 bg-yellow-400 text-white rounded-md text-sm font-semibold hover:bg-yellow-500">Reply</button>
    </form>
  );
}
