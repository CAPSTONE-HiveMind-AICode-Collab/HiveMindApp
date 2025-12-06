"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useSendUserMessage,
  subscribeToChatMessages,
  subscribeToThreadMessages,
  useSendThreadMessage,
  updateLastSeen,
  getThreadUnreadCount,
  getHoneycombUnreadCount,
  setThreadStatus,
  closeThreadAndNotify,
} from "@/lib/business/chatService";
import { useUser } from "@/lib/auth/userContext";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

import FileUploader from "@/components/fileUploader";
import AttachmentList from "@/components/attachmentList";

import CreateTaskModal from "@/components/CreateTaskModal";
import { createTaskFromMessage } from "@/lib/data/taskRepository";

export default function HoneycombChatPage() {
  const { hiveID, honeycombID } = useParams();
  const router = useRouter();
  const { user, loading } = useUser();

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState({});
  const [loadingAI, setLoadingAI] = useState(false);
  const [activeThreadMessageID, setActiveThreadMessageID] = useState(null);

  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [unreadThreads, setUnreadThreads] = useState({});

  const sendUserMessage = useSendUserMessage();
  const sendThreadMessage = useSendThreadMessage();

  // Create Task state
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskSourceMsg, setTaskSourceMsg] = useState(null);

  /* ----------------- MAIN CHAT SUBSCRIPTION ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID) return;

    let mounted = true;

    const markAllRead = async () => {
      try {
        await updateLastSeen(hiveID, honeycombID, null, user.uid);
        const unreadCount = await getHoneycombUnreadCount(
          hiveID,
          honeycombID,
          user.uid
        );
        if (mounted) setUnreadMessageCount(unreadCount);
      } catch (err) {
        console.error("Failed to mark honeycomb as read:", err);
      }
    };

    const unsubscribe = subscribeToChatMessages(async (msgs) => {
      if (!mounted) return;
      setMessages(msgs);
      await markAllRead();
    }, hiveID, honeycombID);

    markAllRead();

    return () => {
      mounted = false;
      unsubscribe && unsubscribe();
    };
  }, [user, hiveID, honeycombID]);

  /* ----------------- THREAD SUBSCRIPTIONS ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID || messages.length === 0) return;

    const unsubscribers = messages.map((msg) =>
      subscribeToThreadMessages(
        async (msgThreads) => {
          const threadsWithStatus = msgThreads.map((t) => ({
            ...t,
            status: t.status || "open",
          }));
          setThreads((prev) => ({ ...prev, [msg.id]: threadsWithStatus }));

          try {
            const count = await getThreadUnreadCount(
              hiveID,
              honeycombID,
              msg.id,
              user.uid
            );
            setUnreadThreads((prev) => ({ ...prev, [msg.id]: count }));
          } catch (err) {
            console.error(
              `getThreadUnreadCount failed for message ${msg.id}:`,
              err
            );
            setUnreadThreads((prev) => ({ ...prev, [msg.id]: 0 }));
          }
        },
        hiveID,
        honeycombID,
        msg.id
      )
    );

    return () => unsubscribers.forEach((u) => u && u());
  }, [messages, user, hiveID, honeycombID]);

  /* ----------------- SEND MESSAGE (TEXT) ----------------- */
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      await sendUserMessage(message, hiveID, honeycombID);
      setMessage("");
      const unreadCount = await getHoneycombUnreadCount(
        hiveID,
        honeycombID,
        user.uid
      );
      setUnreadMessageCount(unreadCount);
    } catch (err) {
      console.error("Send message failed:", err);
    }
  };

  /* ----------------- SEND FILE MESSAGE (UPLOAD) ----------------- */
  const handleFileUploaded = async (meta) => {
    try {
      await sendUserMessage("", hiveID, honeycombID, [], meta);
      const unreadCount = await getHoneycombUnreadCount(
        hiveID,
        honeycombID,
        user.uid
      );
      setUnreadMessageCount(unreadCount);
    } catch (err) {
      console.error("Send file message failed:", err);
    }
  };

  /* ----------------- SEND THREAD MESSAGE ----------------- */
  const handleSendThread = async (text, parentMessageID) => {
    if (!text.trim()) return;
    try {
      await sendThreadMessage(text, hiveID, honeycombID, parentMessageID);
      await updateLastSeen(hiveID, honeycombID, parentMessageID, user.uid);
      const newCount = await getThreadUnreadCount(
        hiveID,
        honeycombID,
        parentMessageID,
        user.uid
      );
      setUnreadThreads((prev) => ({ ...prev, [parentMessageID]: newCount }));
    } catch (err) {
      console.error("Send thread failed:", err);
    }
  };

  /* ----------------- AI REPLY (FIXED: works for PDFs too) ----------------- */
  const handleAIReply = async (msg) => {
    try {
      setLoadingAI(true);

      const attachments = msg?.attachment
        ? Array.isArray(msg.attachment)
          ? msg.attachment
          : [msg.attachment]
        : [];

      const MAX_ATTACHMENT_CHARS_TO_AI = 8000;

      const attachmentTextBlock = attachments
        .filter((a) => a?.text)
        .map((a) => {
          const sliced = a.text.slice(0, MAX_ATTACHMENT_CHARS_TO_AI);
          const truncated =
            a.text.length > MAX_ATTACHMENT_CHARS_TO_AI ? "\n\n[TRUNCATED]" : "";
          return `\n\nAttached text content (${a.name || "file.txt"}):\n${sliced}${truncated}`;
        })
        .join("\n");

      // Always include metadata so PDFs/ZIPs still produce a prompt
      const attachmentMetaBlock =
        attachments.length > 0
          ? `\n\nAttached file metadata:\n${attachments
              .map((a) => {
                const sizeKB = Math.round((a?.size || 0) / 1024);
                return `- name: ${a?.name || "file"} | type: ${
                  a?.contentType || "unknown"
                } | size: ${sizeKB}KB | url: ${a?.url || "(no url)"}`;
              })
              .join("\n")}`
          : "";

      const baseText = String(msg?.text || "").trim();

      let prompt = `${baseText}${attachmentTextBlock}${attachmentMetaBlock}`.trim();

      // If user uploaded a non-text file (pdf/zip/etc), baseText is "" and attachmentTextBlock is ""
      // so we generate a real prompt instead of silently doing nothing.
      if (!prompt && attachments.length > 0) {
        prompt = `A user uploaded file(s) to a chat message, but plain text content was not extracted.\n${attachmentMetaBlock}\n\nReply with:\n1) A short acknowledgement\n2) What you can and cannot do without parsing the file contents\n3) Next best step (e.g., ask user to paste key text, or enable server-side extraction)\n4) If it's a rubric/outline/doc, suggest how to use it effectively.`;
      }

      // If absolutely nothing to send, just exit
      if (!prompt) return;

      const aiText = await callGeminiAPI(prompt);

      const messagesRef = collection(
        db,
        "Hive",
        hiveID,
        "Honeycomb",
        honeycombID,
        "messages"
      );

      await addDoc(messagesRef, {
        type: "text",
        text: aiText,
        attachment: null,
        sender: "AI Bot",
        senderId: "AI",
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("AI request failed:", err);
    } finally {
      setLoadingAI(false);
    }
  };

  /* ----------------- CREATE TASK FROM MESSAGE ----------------- */
  const openCreateTask = (msg) => {
    setTaskSourceMsg(msg);
    setTaskModalOpen(true);
  };

  const saveTask = async ({
    title,
    description,
    checklist,
    status,
    priority,
    dueAt,
  }) => {
    const msg = taskSourceMsg;
    if (!msg) return;

    try {
      const a = msg?.attachment;
      const arr = a ? (Array.isArray(a) ? a : [a]) : [];
      const firstTextAttachment = arr.find((x) => x?.text);

      const combinedDescription = firstTextAttachment?.text
        ? `${description}\n\n[Attachment: ${
            firstTextAttachment.name || "file.txt"
          }]\n${firstTextAttachment.text}`
        : description;

      await createTaskFromMessage({
        hiveID,
        honeycombID,
        messageID: msg.id,
        title,
        description: combinedDescription,
        checklist,
        status,
        priority,
        assignees: [],
        dueAt,
        createdBy: user.uid,
      });
    } catch (err) {
      console.error("Create task failed:", err);
      alert("Could not create task. Check console for details.");
    }
  };

  /* ----------------- OPEN THREAD ----------------- */
  const handleOpenThread = useCallback(
    async (messageID) => {
      setActiveThreadMessageID(messageID);
      try {
        await updateLastSeen(hiveID, honeycombID, messageID, user.uid);
        setUnreadThreads((prev) => ({ ...prev, [messageID]: 0 }));
        const headerCount = await getHoneycombUnreadCount(
          hiveID,
          honeycombID,
          user.uid
        );
        setUnreadMessageCount(headerCount);
      } catch (err) {
        console.error("Opening thread failed:", err);
      }
    },
    [hiveID, honeycombID, user]
  );

  /* ----------------- HELPER: RENDER MESSAGE TEXT ----------------- */
  const renderMessageText = (text) => {
    if (!text) return null;
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
            type="button"
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

  const modalAttachmentText = (() => {
    const a = taskSourceMsg?.attachment;
    const arr = a ? (Array.isArray(a) ? a : [a]) : [];
    return arr.find((x) => x?.text)?.text || "";
  })();

  return (
    <div className="flex h-screen bg-yellow-50">
      <div className="flex-1 flex flex-col">
        <header className="p-4 bg-yellow-500 text-white flex justify-between items-center border-b border-yellow-700">
          <h1 className="font-bold text-lg flex items-center gap-2">
            🐝 {hiveID} / {honeycombID}
            {unreadMessageCount > 0 && (
              <span
                className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs font-semibold rounded-full"
                title={`${unreadMessageCount} unread message${
                  unreadMessageCount > 1 ? "s" : ""
                }`}
              >
                {unreadMessageCount}
              </span>
            )}
          </h1>
          <button
            onClick={() => router.push(`/hive/${hiveID}`)}
            className="bg-white text-yellow-500 px-3 py-1 rounded hover:bg-gray-100 border border-yellow-700"
            type="button"
          >
            Back to Hive
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => {
            const threadUnread = unreadThreads[m.id] || 0;
            const threadStatus = threads[m.id]?.[0]?.status || "open";

            return (
              <div
                key={m.id}
                className={`relative p-2 rounded-lg ${
                  m.senderId === user.uid
                    ? "bg-yellow-300 ml-auto w-1/2 border border-yellow-700"
                    : "bg-white w-1/2 border border-gray-400"
                }`}
              >
                {threadUnread > 0 && (
                  <span
                    className="absolute -top-2 -right-2 px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full shadow"
                    title={`${threadUnread} unread thread message${
                      threadUnread > 1 ? "s" : ""
                    }`}
                  >
                    {threadUnread}
                  </span>
                )}

                <p className="text-sm font-bold underline text-gray-800">
                  {m.sender}
                </p>

                <div>{renderMessageText(m.text)}</div>

                <AttachmentList
                  attachments={
                    m.attachment
                      ? Array.isArray(m.attachment)
                        ? m.attachment
                        : [m.attachment]
                      : []
                  }
                />

                {Array.isArray(m.linkedTaskIds) && m.linkedTaskIds.length > 0 && (
                  <div className="mt-1 text-xs text-green-700 font-semibold">
                    ✅ Task created ({m.linkedTaskIds.length})
                  </div>
                )}

                <div className="flex space-x-3 mt-2">
                  {m.senderId === user.uid && (
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => handleAIReply(m)}
                      disabled={loadingAI}
                      type="button"
                    >
                      {loadingAI ? "Thinking..." : "Ask AI 🤖"}
                    </button>
                  )}

                  <button
                    className="text-xs text-green-700 hover:underline"
                    onClick={() => openCreateTask(m)}
                    type="button"
                  >
                    Create Task ✅
                  </button>

                  <button
                    className="text-xs text-gray-700 hover:underline"
                    onClick={() => handleOpenThread(m.id)}
                    type="button"
                  >
                    {threadStatus === "closed"
                      ? "Closed Thread"
                      : threads[m.id]?.length > 0
                      ? "View Thread"
                      : "Start Thread"}
                  </button>
                </div>
              </div>
            );
          })}
        </main>

        <form
          onSubmit={handleSendMessage}
          className="p-4 flex items-center gap-2 bg-white border-t border-gray-300"
        >
          <input
            className="flex-1 border border-gray-400 rounded-lg p-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <FileUploader
            hiveID={hiveID}
            honeycombID={honeycombID}
            userId={user.uid}
            onUploaded={handleFileUploaded}
          />

          <button
            type="submit"
            className="bg-yellow-400 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500 border border-yellow-700"
          >
            Send
          </button>
        </form>
      </div>

      {activeThreadMessageID && (
        <ThreadPanel
          activeThreadMessageID={activeThreadMessageID}
          threads={threads}
          messages={messages}
          onClose={() => setActiveThreadMessageID(null)}
          onSend={handleSendThread}
          hiveID={hiveID}
          honeycombID={honeycombID}
          user={user}
        />
      )}

      <CreateTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onSave={saveTask}
        messageText={taskSourceMsg?.text || ""}
        attachmentText={modalAttachmentText}
      />
    </div>
  );
}

/* ----------------- THREAD PANEL COMPONENT ----------------- */

function ThreadPanel({
  activeThreadMessageID,
  threads,
  messages,
  onClose,
  onSend,
  hiveID,
  honeycombID,
  user,
}) {
  const currentThread = threads[activeThreadMessageID] || [];
  const parentMessage = messages.find((m) => m.id === activeThreadMessageID);

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l border-gray-300 p-4 shadow-lg flex flex-col z-50">
      <button
        className="bg-yellow-400 px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500 border border-yellow-700 mb-3"
        onClick={onClose}
        type="button"
      >
        Close
      </button>

      <div className="flex-1 overflow-y-auto">
        <p className="font-bold mb-2 text-gray-900">{parentMessage?.text}</p>

        <p className="text-xs font-semibold mb-2">
          Status:{" "}
          <span
            className={
              currentThread[0]?.status === "closed"
                ? "text-red-600 font-bold"
                : "text-green-600 font-bold"
            }
          >
            {currentThread[0]?.status?.toUpperCase() || "OPEN"}
          </span>
        </p>

        {currentThread.map((thread) => (
          <div
            key={thread.id}
            className="mb-2 p-2 bg-gray-100 rounded-md border border-gray-300"
          >
            <p className="text-xs font-semibold text-gray-800">{thread.sender}</p>
            <p className="text-sm text-gray-900 break-words">{thread.text}</p>
          </div>
        ))}
      </div>

      <ThreadInput parentMessageID={activeThreadMessageID} onSend={onSend} />

      {currentThread[0]?.senderId === user.uid && (
        <button
          onClick={async () => {
            const currentStatus = currentThread[0].status;
            if (currentStatus === "open") {
              await closeThreadAndNotify(
                hiveID,
                honeycombID,
                activeThreadMessageID,
                currentThread[0].id,
                user
              );
            } else {
              await setThreadStatus(
                hiveID,
                honeycombID,
                activeThreadMessageID,
                currentThread[0].id,
                "open"
              );
            }
          }}
          className={`mt-2 px-4 py-2 rounded-md font-semibold ${
            currentThread[0]?.status === "open"
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-green-500 text-white hover:bg-green-600"
          }`}
          type="button"
        >
          {currentThread[0]?.status === "open" ? "Close Thread" : "Reopen Thread"}
        </button>
      )}
    </div>
  );
}

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
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply in thread..."
        className="flex-1 border border-gray-300 rounded-md p-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
      />
      <button
        type="submit"
        className="ml-1 px-3 py-1 bg-yellow-400 text-white rounded-md text-sm font-semibold hover:bg-yellow-500"
      >
        Reply
      </button>
    </form>
  );
}
