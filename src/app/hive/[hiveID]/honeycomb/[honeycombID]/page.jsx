"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  loadOlderMessages,
} from "@/lib/business/chatService";
import { useUser } from "@/lib/auth/userContext";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp, doc, onSnapshot, getDocs } from "firebase/firestore";
import { getUserRoleForHive } from "@/lib/data/roleRepository";
import { checkPermission } from "@/lib/business/permissionService";
import { listThreadSummaries } from "@/lib/data/summaryRepository";
import CodeBlock from "@/components/CodeBlock";

export default function HoneycombChatPage() {
  const { hiveID, honeycombID } = useParams();
  const router = useRouter();
  const { user, loading } = useUser();

  const [message, setMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState(process.env.NEXT_PUBLIC_DEFAULT_MODEL || (typeof window !== 'undefined' ? (window?.GEMINI_MODEL || process.env.GEMINI_MODEL) : 'gemini-2.5-flash'));
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState({});
  const [loadingAI, setLoadingAI] = useState(false);
  const [activeThreadMessageID, setActiveThreadMessageID] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [summaries, setSummaries] = useState([]);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);

  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [unreadThreads, setUnreadThreads] = useState({});
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const messagesEndRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [userColors, setUserColors] = useState({});
  const [userRoles, setUserRoles] = useState({});

  const sendUserMessage = useSendUserMessage();

  // Generate random color for each user
  const getUserColor = (userId) => {
    if (userColors[userId]) return userColors[userId];
    
    const colors = [
      'border-yellow-500 bg-yellow-50',
      'border-blue-500 bg-blue-50',
      'border-green-500 bg-green-50',
      'border-purple-500 bg-purple-50',
      'border-pink-500 bg-pink-50',
      'border-indigo-500 bg-indigo-50',
      'border-orange-500 bg-orange-50',
      'border-teal-500 bg-teal-50',
      'border-red-500 bg-red-50',
      'border-cyan-500 bg-cyan-50',
    ];
    
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    setUserColors(prev => ({ ...prev, [userId]: randomColor }));
    return randomColor;
  };

  // Get role emoji for display
  const getRoleEmoji = (role) => {
    const roleMap = {
      'OWNER': '👑',
      'ADMIN': '⚡',
      'MEMBER': '👤',
      'VIEWER': '👁️'
    };
    return roleMap[role] || '👤';
  };
  const sendThreadMessage = useSendThreadMessage();

  /* ----------------- VOICE-TO-TEXT SETUP (Web Speech API) ----------------- */
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          setMessage(prev => prev + (prev ? ' ' : '') + transcript);
        };

        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
          if (event.error === 'no-speech') {
            alert('No speech detected. Please try again.');
          } else if (event.error === 'not-allowed') {
            alert('Microphone access denied. Please enable microphone permissions.');
          }
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  const toggleVoiceRecording = () => {
    if (!recognitionRef.current) return;

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (error) {
        console.error('Failed to start speech recognition:', error);
        alert('Failed to start voice recording. Please try again.');
      }
    }
  };

  /* ----------------- PAGINATION: LOAD OLDER MESSAGES ----------------- */
  const handleLoadOlderMessages = async () => {
    if (!hiveID || !honeycombID || messages.length === 0 || loadingOlderMessages) return;
    
    setLoadingOlderMessages(true);
    try {
      const oldestMessage = messages[0];
      if (!oldestMessage?.timestamp) {
        setHasMoreMessages(false);
        return;
      }
      
      const olderMessages = await loadOlderMessages(hiveID, honeycombID, oldestMessage.timestamp, 50);
      
      if (olderMessages.length === 0) {
        setHasMoreMessages(false);
      } else {
        setMessages(prev => [...olderMessages, ...prev]);
      }
    } catch (error) {
      console.error('Failed to load older messages:', error);
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  /* ----------------- LOAD THREAD SUMMARIES ----------------- */
  const loadSummaries = useCallback(async () => {
    if (!hiveID || !honeycombID) return;
    try {
      setSummariesLoading(true);
      const data = await listThreadSummaries(hiveID, honeycombID);
      setSummaries(data);
    } catch (err) {
      console.error("Failed to load thread summaries:", err);
    } finally {
      setSummariesLoading(false);
    }
  }, [hiveID, honeycombID]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  /* ----------------- LOAD USER ROLE FOR HIVE ----------------- */
  useEffect(() => {
    if (!user || !hiveID) return;

    let cancelled = false;
    
    // Set up real-time listener for user's role changes
    const userMemberRef = doc(db, 'Hive', hiveID, 'members', user.uid);
    
    const unsubscribe = onSnapshot(userMemberRef, async (docSnap) => {
      if (cancelled) return;
      
      if (!docSnap.exists()) {
        // User is not a member - redirect to join page
        alert("You don't have access to this honeycomb. Please request access first.");
        router.push(`/join?honeycombID=${honeycombID}`);
        return;
      }
      
      // Get updated role
      const memberData = docSnap.data();
      const role = memberData.role || "VIEWER";
      setUserRole(role);
      
      // Also fetch all members' roles for display
      const membersRef = collection(db, 'Hive', hiveID, 'members');
      const snapshot = await getDocs(membersRef);
      
      const roles = {};
      snapshot.docs.forEach(memberDoc => {
        roles[memberDoc.id] = memberDoc.data().role;
      });
      if (!cancelled) setUserRoles(roles);
    }, (err) => {
      console.error("Failed to load user role for hive:", err);
      if (!cancelled) {
        alert("Error checking access permissions.");
        router.push('/dashboard');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user, hiveID, honeycombID, router]);

  /* ----------------- MAIN CHAT SUBSCRIPTION ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID) return;

    let mounted = true;

    const markAllRead = async () => {
      try {
        await updateLastSeen(hiveID, honeycombID, null, user.uid);
        const unreadCount = await getHoneycombUnreadCount(hiveID, honeycombID, user.uid);
        if (mounted) setUnreadMessageCount(unreadCount);
      } catch (err) {
        console.error("Failed to mark honeycomb as read:", err);
      }
    };

    const unsubscribe = subscribeToChatMessages(async (msgs) => {
      if (!mounted) return;
      setMessages(msgs);

      // mark as read automatically when messages arrive
      await markAllRead();
    }, hiveID, honeycombID);

    markAllRead(); // also mark read on mount

    return () => {
      mounted = false;
      unsubscribe && unsubscribe();
    };
  }, [user, hiveID, honeycombID]);

  /* ----------------- THREAD SUBSCRIPTIONS ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID || messages.length === 0) return;

    const unsubscribers = messages.map((msg) => {
      return subscribeToThreadMessages(async (msgThreads) => {
        const threadsWithStatus = msgThreads.map(t => ({ ...t, status: t.status || "open" }));
        setThreads(prev => ({ ...prev, [msg.id]: threadsWithStatus }));

        try {
          const count = await getThreadUnreadCount(hiveID, honeycombID, msg.id, user.uid);
          setUnreadThreads(prev => ({ ...prev, [msg.id]: count }));
        } catch (err) {
          console.error(`getThreadUnreadCount failed for message ${msg.id}:`, err);
          setUnreadThreads(prev => ({ ...prev, [msg.id]: 0 }));
        }
      }, hiveID, honeycombID, msg.id);
    });

    return () => unsubscribers.forEach(u => u && u());
  }, [messages, user, hiveID, honeycombID]);

  /* ----------------- SUMMARIES SUBSCRIPTION ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID) return;

    const summariesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "threadSummaries");
    const unsubscribe = onSnapshot(summariesRef, (snapshot) => {
      const summariesData = snapshot.docs.map(doc => ({
        id: doc.id,
        threadID: doc.id,
        ...doc.data()
      }));
      setSummaries(summariesData);
      setSummariesLoading(false);
    }, (error) => {
      console.error("Failed to load summaries:", error);
      setSummariesLoading(false);
    });

    return () => unsubscribe();
  }, [user, hiveID, honeycombID]);

  /* ----------------- PERMISSION HELPER ----------------- */
  const canChat = userRole ? checkPermission(userRole, "SEND_MESSAGE") : true;

  /* ----------------- SEND MESSAGE ----------------- */
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    if (!canChat) {
      alert("You have view-only access in this hive and cannot send messages.");
      return;
    }

    try {
      await sendUserMessage(message, hiveID, honeycombID);
      setMessage("");
      const unreadCount = await getHoneycombUnreadCount(hiveID, honeycombID, user.uid);
      setUnreadMessageCount(unreadCount);
    } catch (err) {
      console.error("Send message failed:", err);
    }
  };

  /* ----------------- SEND THREAD MESSAGE ----------------- */
  const handleSendThread = async (text, parentMessageID) => {
    if (!text.trim()) return;

    if (!canChat) {
      alert("You have view-only access in this hive and cannot reply in threads.");
      return;
    }

    try {
      await sendThreadMessage(text, hiveID, honeycombID, parentMessageID);
      await updateLastSeen(hiveID, honeycombID, parentMessageID, user.uid);
      const newCount = await getThreadUnreadCount(hiveID, honeycombID, parentMessageID, user.uid);
      setUnreadThreads(prev => ({ ...prev, [parentMessageID]: newCount }));
    } catch (err) {
      console.error("Send thread failed:", err);
    }
  };

  /* ----------------- AI REPLY ----------------- */
  const handleAIReply = async (text) => {
    if (!text) return;

    if (!canChat) {
      alert("You have view-only access in this hive and cannot use AI features.");
      return;
    }

    try {
      setLoadingAI(true);
      const aiText = await callGeminiAPI(text, selectedModel);

      const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
      await addDoc(messagesRef, {
        text: aiText,
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

  /* ----------------- OPEN THREAD ----------------- */
  const handleOpenThread = useCallback(async (messageID) => {
    setActiveThreadMessageID(messageID);
    // Scroll the parent message into view and add a temporary highlight
    try {
      const el = document.getElementById(`message-${messageID}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const originalBox = el.style.boxShadow;
        el.style.boxShadow = "0 0 0 6px rgba(245,158,11,0.35)"; // yellow glow
        setTimeout(() => {
          el.style.boxShadow = originalBox || "";
        }, 1800);
      }
    } catch (err) {
      console.error("Scroll/highlight failed:", err);
    }
    try {
      await updateLastSeen(hiveID, honeycombID, messageID, user.uid);
      setUnreadThreads(prev => ({ ...prev, [messageID]: 0 }));
      const headerCount = await getHoneycombUnreadCount(hiveID, honeycombID, user.uid);
      setUnreadMessageCount(headerCount);
    } catch (err) {
      console.error("Opening thread failed:", err);
    }
  }, [hiveID, honeycombID, user]);

  /* ----------------- HELPER: RENDER MESSAGE TEXT ----------------- */
  const renderMessageText = (text, senderId = null) => {
    if (!text) return null;
    const isAI = senderId === 'AI';

    // Parse code blocks with optional language: ```lang\ncode```
    const nodes = [];
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const full = match[0];
      const lang = match[1];
      const code = match[2];
      const index = match.index;

      if (index > lastIndex) {
        nodes.push({ type: 'text', content: text.slice(lastIndex, index) });
      }

      nodes.push({ type: 'code', content: code, lang: lang || 'javascript' });
      lastIndex = index + full.length;
    }

    if (lastIndex < text.length) {
      nodes.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return nodes.map((node, idx) => {
      if (node.type === 'code') {
        return <CodeBlock key={`code-${idx}`} code={node.content} language={node.lang} />;
      }

      // Convert markdown-like '* ' lines into a proper list
      const part = node.content;
      const lines = part.split(/\r?\n/).map((l) => l.replace(/\u00A0/g, ' '));
      const listItems = lines.filter((l) => l.trim().startsWith('* '));

      if (listItems.length > 0) {
        const items = listItems.map((l) => l.trim().slice(2));
        return (
          <div key={`text-${idx}`} className="mb-3 text-sm text-gray-800 leading-relaxed font-medium">
            <ul className="list-disc list-inside space-y-2 ml-1">
              {items.map((it, i2) => (
                <li key={i2} className="text-sm text-gray-800">{it}</li>
              ))}
            </ul>
          </div>
        );
      }

      return (
        <div key={`text-${idx}`} className={`text-base text-gray-700 whitespace-pre-wrap leading-relaxed mb-4 font-bold p-3 rounded-lg border-l-4 ${
          isAI 
            ? 'bg-gradient-to-r from-blue-50 to-transparent border-blue-400'
            : 'bg-gradient-to-r from-yellow-50 to-transparent border-yellow-400'
        }`}>{part}</div>
      );
    });
  };

  // Filter messages based on search query
  const filteredMessages = messages.filter(m => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      m.text?.toLowerCase().includes(query) ||
      m.sender?.toLowerCase().includes(query)
    );
  });

  if (loading) return <p className="p-4 text-center">Loading user info...</p>;
  if (!user) {
    router.replace("/");
    return null;
  }

  return (
    <div className="flex h-screen bg-yellow-50">
      {/* ----------------- MAIN CHAT PANEL ----------------- */}
      <div className="flex-1 flex flex-col">
        <header className="p-4 bg-yellow-500 text-white border-b border-yellow-700 relative z-10">
          <div className="flex justify-between items-center mb-3">
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
          </div>
          
          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages and users..."
              className="w-full px-4 py-2 pl-10 pr-10 rounded-lg text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white focus:border-white"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          {searchQuery && (
            <p className="text-xs mt-2 text-yellow-100">
              Found {filteredMessages.length} message{filteredMessages.length !== 1 ? 's' : ''}
            </p>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Load More Messages Button */}
          {hasMoreMessages && messages.length > 0 && !searchQuery && (
            <div className="flex justify-center mb-4">
              <button
                onClick={handleLoadOlderMessages}
                disabled={loadingOlderMessages}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 flex items-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingOlderMessages ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    <span>Load Older Messages</span>
                  </>
                )}
              </button>
            </div>
          )}
          
          {filteredMessages.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-lg font-semibold">No messages found</p>
              <p className="text-sm">Try a different search term</p>
            </div>
          ) : null}
          
          {filteredMessages.map((m) => {
            const threadUnread = unreadThreads[m.id] || 0;
            const threadStatus = threads[m.id]?.[0]?.status || "open";

            return (
              <div
                id={`message-${m.id}`}
                key={m.id}
                className={`relative p-3 rounded-lg border-l-4 ${
                  m.senderId === 'AI'
                    ? "bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-500 w-full sm:w-3/4 lg:w-1/2"
                    : `${getUserColor(m.senderId)} w-full sm:w-3/4 lg:w-1/2 ${m.senderId === user.uid ? 'ml-auto' : ''}`
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

                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-bold text-gray-800">
                    {m.senderId === 'AI' ? '🤖 ' : ''}{m.sender}
                  </p>
                  {m.senderId !== 'AI' && userRoles[m.senderId] && (
                    <span className="text-xs" title={userRoles[m.senderId]}>
                      {getRoleEmoji(userRoles[m.senderId])}
                    </span>
                  )}
                </div>
                <div>{renderMessageText(m.text, m.senderId)}</div>

                <div className="flex flex-col sm:flex-row sm:space-x-3 space-y-2 sm:space-y-0 mt-2">
                  {m.senderId === user.uid && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="text-sm p-1 border border-gray-300 rounded bg-white text-gray-800 min-w-[10rem]"
                        title="Model"
                        aria-label="Choose AI model"
                      >
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                      </select>

                      <button
                        className="text-xs sm:text-sm bg-blue-600 text-white px-3 py-1.5 sm:py-1 rounded hover:bg-blue-700 shadow"
                        onClick={() => handleAIReply(m.text)}
                        disabled={loadingAI}
                        aria-disabled={loadingAI}
                      >
                        {loadingAI ? "Thinking..." : "Ask AI 🤖"}
                      </button>
                    </div>
                  )}

                  {/* Start/View/Closed Thread button - styled as a boxed control for consistency */}
                  <button
                    className={`text-xs sm:text-sm px-3 py-1.5 sm:py-1 rounded border font-semibold ${
                      threadStatus === "closed"
                        ? "bg-red-100 border-red-400 text-red-800"
                        : threads[m.id]?.length > 0
                        ? "bg-white border-gray-300 text-gray-800"
                        : "bg-yellow-100 border-yellow-400 text-yellow-800"
                    }`}
                    onClick={() => handleOpenThread(m.id)}
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

        <form onSubmit={handleSendMessage} className="p-2 sm:p-4 flex gap-2 bg-white border-t border-gray-300">
          <div className="flex-1 relative">
            <input
              className="w-full border border-gray-400 rounded-lg p-2 pr-12 text-sm sm:text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
              placeholder={canChat ? "Type or use voice..." : "View-only access"}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!canChat}
            />
            {speechSupported && canChat && (
              <button
                type="button"
                onClick={toggleVoiceRecording}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all duration-200 ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-pulse' 
                    : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                }`}
                title={isRecording ? 'Stop recording' : 'Start voice input'}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="bg-yellow-400 px-3 sm:px-4 py-2 rounded-lg font-semibold hover:bg-yellow-500 border border-yellow-700 flex items-center gap-2"
          >
            <span className="hidden sm:inline">Send</span>
            <svg className="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      </div>

      {/* ----------------- THREAD PANEL ----------------- */}
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
          userRole={userRole}
          loadSummaries={loadSummaries}
          summaries={summaries}
          summariesLoading={summariesLoading}
          onOpenThread={handleOpenThread}
        />
      )}
    </div>
  );
}

function ThreadPanel({ activeThreadMessageID, threads, messages, onClose, onSend, hiveID, honeycombID, user, userRole, loadSummaries, summaries, summariesLoading, onOpenThread }) {
  const canChat = userRole ? checkPermission(userRole, "SEND_MESSAGE") : true;
  const [threadUserColors, setThreadUserColors] = useState({});
  const [threadUserRoles, setThreadUserRoles] = useState({});

  // Generate random color for each user in thread
  const getThreadUserColor = (userId) => {
    if (threadUserColors[userId]) return threadUserColors[userId];
    
    const colors = [
      'border-yellow-500 bg-yellow-50',
      'border-blue-500 bg-blue-50',
      'border-green-500 bg-green-50',
      'border-purple-500 bg-purple-50',
      'border-pink-500 bg-pink-50',
      'border-indigo-500 bg-indigo-50',
      'border-orange-500 bg-orange-50',
      'border-teal-500 bg-teal-50',
      'border-red-500 bg-red-50',
      'border-cyan-500 bg-cyan-50',
    ];
    
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    setThreadUserColors(prev => ({ ...prev, [userId]: randomColor }));
    return randomColor;
  };

  const getRoleEmoji = (role) => {
    const roleMap = {
      'OWNER': '👑',
      'ADMIN': '⚡',
      'MEMBER': '👤',
      'VIEWER': '👁️'
    };
    return roleMap[role] || '👤';
  };

  useEffect(() => {
    if (!hiveID) return;
    
    async function loadMemberRoles() {
      try {
        const { collection, getDocs } = await import('firebase/firestore');
        const membersRef = collection(db, 'Hive', hiveID, 'members');
        const snapshot = await getDocs(membersRef);
        const roles = {};
        snapshot.docs.forEach(doc => {
          roles[doc.id] = doc.data().role;
        });
        setThreadUserRoles(roles);
      } catch (err) {
        console.error('Failed to load member roles:', err);
      }
    }
    
    loadMemberRoles();
  }, [hiveID]);
  
  const currentThread = threads[activeThreadMessageID] || [];
  const parentMessage = messages.find(m => m.id === activeThreadMessageID);
  const replyInputRef = useRef(null);
  
  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(384); // default 96 * 4 = 384px (w-96)
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef(null);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Handle mouse down on resize handle
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Handle mouse move for resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 320 && newWidth <= 800) { // min 320px, max 800px
        setPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Focus the reply input when a thread is opened
  useEffect(() => {
    if (!activeThreadMessageID) return;
    try {
      setTimeout(() => {
        replyInputRef.current && replyInputRef.current.focus && replyInputRef.current.focus();
      }, 80);
    } catch (err) {
      console.error("Failed to focus thread reply input:", err);
    }
  }, [activeThreadMessageID]);

  // UI Guide help panel visibility (persisted)
  const [showHelp, setShowHelp] = useState(true);
  useEffect(() => {
    try {
      const dismissed = typeof window !== "undefined" ? localStorage.getItem("honeycomb_help_dismissed") : null;
      if (dismissed === "1") setShowHelp(false);
    } catch (err) {
      // ignore
    }
  }, []);
  const dismissHelp = () => {
    try {
      if (typeof window !== "undefined") localStorage.setItem("honeycomb_help_dismissed", "1");
    } catch (err) {
      // ignore
    }
    setShowHelp(false);
  };

  return (
    <div 
      ref={panelRef}
      className={`fixed right-0 top-0 h-full bg-white border-l border-gray-300 p-2 sm:p-4 shadow-lg flex flex-col z-50 ${
        isMobile ? 'left-0' : ''
      }`}
      style={isMobile ? {} : { width: `${panelWidth}px` }}
    >
      {/* Resize handle - hide on mobile */}
      {!isMobile && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 w-1 h-full cursor-ew-resize hover:bg-indigo-400 transition-colors group"
          style={{ marginLeft: '-2px' }}
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-16 bg-gray-300 group-hover:bg-indigo-500 rounded-r transition-colors"></div>
        </div>
      )}

      <button
        className="bg-yellow-400 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-semibold hover:bg-yellow-500 border border-yellow-700 mb-3"
        onClick={onClose}
      >
        Close
      </button>

      <div className="flex-1 overflow-y-auto">
        <p className="font-bold mb-2 text-gray-900 whitespace-pre-wrap leading-relaxed">{parentMessage?.text}</p>

        <p className="text-xs font-semibold mb-2">
          Status:{" "}
          <span className={currentThread[0]?.status === "closed" ? "text-red-600 font-bold" : "text-green-600 font-bold"}>
            {currentThread[0]?.status?.toUpperCase() || "OPEN"}
          </span>
        </p>

        {currentThread.map(thread => (
          <div key={thread.id} className={`mb-2 p-2 rounded border-l-4 ${
            thread.senderId === 'AI' 
              ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-500'
              : `${getThreadUserColor(thread.senderId)}`
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-semibold text-gray-700">
                {thread.senderId === 'AI' ? '🤖 ' : ''}{thread.sender}
              </p>
              {thread.senderId !== 'AI' && threadUserRoles[thread.senderId] && (
                <span className="text-xs" title={threadUserRoles[thread.senderId]}>
                  {getRoleEmoji(threadUserRoles[thread.senderId])}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-900 break-words whitespace-pre-wrap leading-relaxed">{thread.text}</p>
          </div>
        ))}
      </div>

      <ThreadInput parentMessageID={activeThreadMessageID} onSend={onSend} inputRef={replyInputRef} />

      {currentThread[0]?.senderId === user.uid && canChat && (
        <button
          onClick={async () => {
            const currentStatus = currentThread[0].status;
            if (currentStatus === "open") {
              // 🔔 Close and notify all participants
              await closeThreadAndNotify(
                hiveID,
                honeycombID,
                activeThreadMessageID,
                currentThread[0].id,
                user
              );
              // refresh summaries panel after closing
              try {
                await loadSummaries();
              } catch (err) {
                console.error("Failed to refresh summaries after close:", err);
              }
            } else {
              // 🔓 Reopen (no notifications)
              await setThreadStatus(hiveID, honeycombID, activeThreadMessageID, currentThread[0].id, "open");
            }
          }}
          className={`mt-2 px-4 py-2 rounded-md font-semibold ${
            currentThread[0]?.status === "open"
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-green-500 text-white hover:bg-green-600"
          }`}
        >
          {currentThread[0]?.status === "open" ? "Close Thread" : "Reopen Thread"}
        </button>
      )}

      {/* Show summary only for THIS thread if it exists and is closed */}
      {currentThread[0]?.status === "closed" && (() => {
        const threadSummary = summaries.find(s => s.threadID === currentThread[0]?.id);
        return threadSummary ? (
          <div className="mt-4 bg-gradient-to-br from-indigo-50 via-blue-50 to-cyan-50 border-2 border-indigo-200 rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3 flex items-center gap-2">
              <span className="text-2xl">✨</span>
              <h2 className="text-base font-bold text-white">
                Thread Summary
              </h2>
            </div>
            
            <div className="p-4">
              <SummaryCard 
                summary={threadSummary}
                threadMessages={currentThread}
                parentMessage={parentMessage}
                showOpenButton={false}
              />
            </div>
          </div>
        ) : null;
      })()}

      {/* UI Guide + Completed subtasks – AI summaries */}
      {showHelp && (
        <div className="mb-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="flex justify-between items-start">
            <h3 className="text-sm font-semibold">UI Guide</h3>
            <button
              onClick={dismissHelp}
              className="text-xs text-gray-500 hover:text-gray-800"
              title="Dismiss help"
            >
              Got it
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2">Quick orientation to the Honeycomb UI:</p>
          <ul className="text-xs text-gray-600 mt-2 list-disc list-inside space-y-1">
            <li><strong>Messages:</strong> Main feed on the left. Click "Start/View Thread" to open a sub-conversation.</li>
            <li><strong>Thread panel:</strong> Right column — shows thread replies and lets you reply or close a thread.</li>
            <li><strong>Ask AI:</strong> Use on a message you sent to generate an AI reply into the conversation.</li>
            <li><strong>Completed subtasks:</strong> When a thread is closed an AI summary is generated and appears below.</li>
            <li><strong>Open thread:</strong> From a summary click "Open thread" to jump back to the original discussion.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ summary, index, onOpenThread, threadMessages, parentMessage, showOpenButton = true }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userColor] = useState(() => {
    const colors = [
      'from-yellow-500 to-yellow-600',
      'from-blue-500 to-blue-600',
      'from-green-500 to-green-600',
      'from-purple-500 to-purple-600',
      'from-pink-500 to-pink-600',
      'from-indigo-500 to-indigo-600',
      'from-orange-500 to-orange-600',
      'from-teal-500 to-teal-600',
      'from-red-500 to-red-600',
      'from-cyan-500 to-cyan-600',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  });

  const getRoleEmoji = (role) => {
    const roleMap = {
      'OWNER': '👑',
      'ADMIN': '⚡',
      'MEMBER': '👤',
      'VIEWER': '👁️'
    };
    return roleMap[role] || '👤';
  };

  const getRelativeTime = (timestamp) => {
    if (!timestamp) return 'Unknown time';
    const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(summary.summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const messageCount = threadMessages?.length || 0;
  
  return (
    <div className="bg-white rounded-xl border-2 border-indigo-100 shadow-sm hover:shadow-md transition-all duration-200">
      <div 
        className="p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1">
            {index !== undefined && (
              <div className={`flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br ${userColor} flex items-center justify-center text-white text-xs font-bold`}>
                {index + 1}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-semibold text-indigo-700">Thread #{summary.threadID.slice(0, 8)}</span>
                {messageCount > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    {messageCount} message{messageCount !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {getRelativeTime(summary.generatedAt)}
                </span>
                {summary.closedByUserName && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    by <span className="font-medium text-gray-700">{summary.closedByUserName}</span>
                    {summary.closedByRole && (
                      <span title={summary.closedByRole}>
                        {getRoleEmoji(summary.closedByRole)}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <p className={`text-sm text-gray-700 leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
                {summary.summaryText}
              </p>
            </div>
          </div>
          <button 
            className="flex-shrink-0 text-indigo-600 hover:text-indigo-800 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="px-3 pb-3 pt-0">
          <div className="bg-gradient-to-br from-gray-50 to-blue-50 p-3 rounded-lg border border-gray-200 mb-3">
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{summary.summaryText}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-gray-200 transition-all duration-200 flex items-center justify-center gap-2"
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
            {showOpenButton && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenThread && onOpenThread(summary.parentMessageID);
                }}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:from-indigo-700 hover:to-blue-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open Thread
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadInput({ parentMessageID, onSend, inputRef }) {
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
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply in thread..."
        className="flex-1 border border-gray-300 rounded-md p-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
      />
      <button type="submit" className="ml-1 px-3 py-1 bg-yellow-400 text-white rounded-md text-sm font-semibold hover:bg-yellow-500">
        Reply
      </button>
    </form>
  );
}
