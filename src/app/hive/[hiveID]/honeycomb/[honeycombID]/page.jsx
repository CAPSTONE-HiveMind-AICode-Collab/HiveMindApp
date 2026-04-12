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
import { callGeminiAPI, askHiveMemory } from "@/lib/data/aiRepository";
import { NectarRepository } from "@/lib/data/nectarRepository";
import { buildAskAIContext } from "@/lib/business/contextBuilderService";
import { db } from "@/lib/firebase/config";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  onSnapshot,
  getDocs,
} from "firebase/firestore";

import { checkPermission } from "@/lib/business/permissionService";
import { listThreadSummaries } from "@/lib/data/summaryRepository";

import CodeBlock from "@/components/CodeBlock";
import FileUploader from "@/components/fileUploader";
import AttachmentList from "@/components/attachmentList";

import CreateTaskModal from "@/components/CreateTaskModal";
import { createTaskFromMessage } from "@/lib/data/taskRepository";

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function HoneycombChatPage() {
  const params = useParams();
  const hiveID = String(params?.hiveID ?? "");
  const honeycombID = String(params?.honeycombID ?? "");

  const router = useRouter();
  const { user, loading } = useUser();

  const [message, setMessage] = useState("");
  // queued attachments (upload now, send later)
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [uploadState, setUploadState] = useState({
    busy: false,
    phase: "idle",
    progress: 0,
  });

  const [selectedModel, setSelectedModel] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_MODEL ||
      (typeof window !== "undefined"
        ? window?.GEMINI_MODEL || process.env.GEMINI_MODEL
        : "gemini-2.5-flash")
  );

  const [aiScope, setAiScope] = useState("message");
  const [allowAIDecrypt, setAllowAIDecrypt] = useState(false);
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState({});
  const [loadingAI, setLoadingAI] = useState(false);
  const [activeThreadMessageID, setActiveThreadMessageID] = useState(null);

  const [userRole, setUserRole] = useState(null);
  const [userRoles, setUserRoles] = useState({});
  const [userColors, setUserColors] = useState({});

  const [summaries, setSummaries] = useState([]);
  const [summariesLoading, setSummariesLoading] = useState(true);

  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [unreadThreads, setUnreadThreads] = useState({});
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);

  const messagesEndRef = useRef(null);

  // Task modal state
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskSourceMsg, setTaskSourceMsg] = useState(null);

  const sendUserMessage = useSendUserMessage();
  const sendThreadMessage = useSendThreadMessage();

  /* ----------------- PERMISSION HELPER ----------------- */
  const canChat = userRole ? checkPermission(userRole, "SEND_MESSAGE") : true;

  /* ----------------- COLORS & ROLE EMOJI ----------------- */
  const getUserColor = (userId) => {
    if (!userId) return "border-gray-400 bg-gray-50";
    if (userColors[userId]) return userColors[userId];

    const colors = [
      "border-amber-300/30 bg-amber-300/10",
      "border-blue-300/30 bg-blue-300/10",
      "border-emerald-300/30 bg-emerald-300/10",
      "border-violet-300/30 bg-violet-300/10",
      "border-pink-300/30 bg-pink-300/10",
      "border-indigo-300/30 bg-indigo-300/10",
      "border-orange-300/30 bg-orange-300/10",
      "border-teal-300/30 bg-teal-300/10",
      "border-rose-300/30 bg-rose-300/10",
      "border-cyan-300/30 bg-cyan-300/10",
    ];

    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    setUserColors((prev) => ({ ...prev, [userId]: randomColor }));
    return randomColor;
  };

  const normalizeAttachments = (msg) => {
  const raw =
    msg?.attachment ??
    msg?.attachments ??
    msg?.files ??
    msg?.file ??
    msg?.meta ??
    null;

  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];

  return arr
    .filter(Boolean)
    .map((a) => ({
      ...a,
      name:
        a.name ??
        a.filename ??
        a.originalName ??
        (typeof a.path === "string" ? a.path.split("/").pop() : undefined) ??
        "file",
      url: a.url ?? a.downloadURL ?? a.downloadUrl ?? a.storageUrl ?? "",
      contentType: a.contentType ?? a.type ?? a.mimeType ?? "unknown",
      size: a.size ?? a.bytes ?? a.fileSize ?? 0,

      text: a.text ?? "",
      extractedText: a.extractedText ?? "",
      imageDescription: a.imageDescription ?? "",

      rawCaption: a.rawCaption ?? "",
      captionRisk: a.captionRisk ?? "",
      captionNotes: Array.isArray(a.captionNotes) ? a.captionNotes : [],

      extractionMethod: a.extractionMethod ?? "",
      extractionStatus: a.extractionStatus ?? "",
      extractionError: a.extractionError ?? "",
      isDocumentLike: !!a.isDocumentLike,
      ocrConfidence: a.ocrConfidence ?? null,
    }));
};

  const getRoleEmoji = (role) => {
    const roleMap = {
      OWNER: "👑",
      ADMIN: "⚡",
      MEMBER: "👤",
      VIEWER: "👁️",
    };
    return roleMap[role] || "👤";
  };

  // --- State: Knowledge Nectar (Memory) ---
const [memoryQuery, setMemoryQuery] = useState("");
const [memoryResponse, setMemoryResponse] = useState("");
const [isSearchingMemory, setIsSearchingMemory] = useState(false);

// The logic handler for the RAG search
const handleSearchMemory = async (e) => {
  e.preventDefault();
  if (!memoryQuery.trim()) return;
  setIsSearchingMemory(true);
  setMemoryResponse("");
  try {
    const answer = await askHiveMemory(hiveID, memoryQuery, selectedModel);
    setMemoryResponse(answer);
  } catch (err) {
    console.error("Memory search failed:", err);
    setMemoryResponse("Failed to access Hive memory.");
  } finally {
    setIsSearchingMemory(false);
  }
};

  /* ----------------- VOICE-TO-TEXT SETUP (Web Speech API) ----------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    setSpeechSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (!transcript) return;
      setMessage((prev) => prev + (prev ? " " : "") + transcript);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
      if (event.error === "no-speech") {
        alert("No speech detected. Please try again.");
      } else if (event.error === "not-allowed") {
        alert("Microphone access denied. Please enable microphone permissions.");
      }
    };

    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
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
        console.error("Failed to start speech recognition:", error);
        alert("Failed to start voice recording. Please try again.");
      }
    }
  };

  /* ----------------- LOAD THREAD SUMMARIES ----------------- */
  const loadSummaries = useCallback(async () => {
    if (!hiveID || !honeycombID) return;
    try {
      setSummariesLoading(true);
      const data = await listThreadSummaries(hiveID, honeycombID);
      setSummaries(data || []);
    } catch (err) {
      console.error("Failed to load thread summaries:", err);
    } finally {
      setSummariesLoading(false);
    }
  }, [hiveID, honeycombID]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  /* ----------------- LOAD USER ROLE FOR HIVE (real-time) ----------------- */
  useEffect(() => {
    if (!user || !hiveID) return;

    let cancelled = false;
    const userMemberRef = doc(db, "Hive", hiveID, "members", user.uid);

    const unsubscribe = onSnapshot(
      userMemberRef,
      async (docSnap) => {
        if (cancelled) return;

        if (!docSnap.exists()) {
          alert(
            "You don't have access to this honeycomb. Please request access first."
          );
          router.push(`/join?honeycombID=${honeycombID}`);
          return;
        }

        const memberData = docSnap.data();
        const role = memberData?.role || "VIEWER";
        setUserRole(role);

        // Fetch all members roles for display
        const membersRef = collection(db, "Hive", hiveID, "members");
        const snap = await getDocs(membersRef);
        const roles = {};
        snap.docs.forEach((d) => {
          roles[d.id] = d.data()?.role;
        });
        if (!cancelled) setUserRoles(roles);
      },
      (err) => {
        console.error("Failed to load user role for hive:", err);
        if (!cancelled) {
          alert("Error checking access permissions.");
          router.push("/dashboard");
        }
      }
    );

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
      setMessages(msgs || []);
      await markAllRead();
    }, hiveID, honeycombID);

    markAllRead();

    return () => {
      mounted = false;
      unsubscribe && unsubscribe();
    };
  }, [user, hiveID, honeycombID]);

  /* ----------------- THREAD SUBSCRIPTIONS (per message) ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID || messages.length === 0) return;

    const unsubscribers = messages.map((msg) =>
      subscribeToThreadMessages(
        async (msgThreads) => {
          const threadsWithStatus = (msgThreads || []).map((t) => ({
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
            console.error(`getThreadUnreadCount failed for ${msg.id}:`, err);
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

  /* ----------------- SUMMARIES SUBSCRIPTION ----------------- */
  useEffect(() => {
    if (!user || !hiveID || !honeycombID) return;

    const summariesRef = collection(
      db,
      "Hive",
      hiveID,
      "Honeycomb",
      honeycombID,
      "threadSummaries"
    );

    const unsubscribe = onSnapshot(
      summariesRef,
      (snapshot) => {
        const summariesData = snapshot.docs.map((d) => ({
          id: d.id,
          threadID: d.id,
          ...d.data(),
        }));
        setSummaries(summariesData);
        setSummariesLoading(false);
      },
      (error) => {
        console.error("Failed to load summaries:", error);
        setSummariesLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, hiveID, honeycombID]);

  /* ----------------- PAGINATION: LOAD OLDER MESSAGES ----------------- */
  const handleLoadOlderMessages = async () => {
    if (!hiveID || !honeycombID || messages.length === 0 || loadingOlderMessages)
      return;

    setLoadingOlderMessages(true);
    try {
      const oldestMessage = messages[0];
      if (!oldestMessage?.timestamp) {
        setHasMoreMessages(false);
        return;
      }

      const older = await loadOlderMessages(
        hiveID,
        honeycombID,
        oldestMessage.timestamp,
        50
      );

      if (!older || older.length === 0) {
        setHasMoreMessages(false);
      } else {
        setMessages((prev) => [...older, ...prev]);
      }
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  /* ----------------- AUTO-SCROLL ----------------- */
  useEffect(() => {
    if (searchQuery) return;
    if (loadingOlderMessages) return;
    try {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {
      // ignore
    }
  }, [messages, searchQuery, loadingOlderMessages]);


  /* ----------------- FILE UPLOAD (QUEUE ONLY) ----------------- */
  const handleFileUploaded = async (meta) => {
  if (!canChat) {
    alert("You have view-only access in this hive and cannot upload files.");
    return;
  }

  const arr = Array.isArray(meta) ? meta : meta ? [meta] : [];
  if (arr.length === 0) return;

  setPendingAttachments((prev) => [...prev, ...arr]);
};

  /* ----------------- SEND MESSAGE (TEXT + QUEUED FILES) ----------------- */
  const handleSendMessage = async (e) => {
  e.preventDefault();

  if (!canChat) {
    alert("You have view-only access in this hive and cannot send messages.");
    return;
  }

  if (uploadState.busy) {
    alert("Please wait for the file upload to finish before sending.");
    return;
  }

  const text = message.trim();
  const hasAttachments = pendingAttachments.length > 0;

  if (!text && !hasAttachments) return;

  try {
    const attachmentsToSend = pendingAttachments.map((a) => ({
      name: a?.name || "",
      size: a?.size || 0,
      contentType: a?.contentType || "application/octet-stream",
      url: a?.url || "",
      storagePath: a?.storagePath || "",
      uploadedAt: a?.uploadedAt || Date.now(),

      text: a?.text || null,
      extractedText: a?.extractedText || null,
      imageDescription: a?.imageDescription || null,

      rawCaption: a?.rawCaption || null,
      captionRisk: a?.captionRisk || null,
      captionNotes: Array.isArray(a?.captionNotes) ? a.captionNotes : [],

      extractionMethod: a?.extractionMethod || null,
      extractionStatus: a?.extractionStatus || null,
      extractionError: a?.extractionError || null,
      isDocumentLike: !!a?.isDocumentLike,
      ocrConfidence: a?.ocrConfidence ?? null,
    }));

    await sendUserMessage(
      text,
      hiveID,
      honeycombID,
      [],
      attachmentsToSend
    );

    setMessage("");
    setPendingAttachments([]);

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

/* ----------------- AI REPLY (scoped context + attachments + privacy) ----------------- */
const handleAIReply = async (msgOrText, scope = "message") => {
  const msg =
    typeof msgOrText === "object" && msgOrText !== null
      ? msgOrText
      : { text: String(msgOrText ?? ""), attachment: null };

  if (!canChat) {
    alert("You have view-only access in this hive and cannot use AI features.");
    return;
  }

  try {
    setLoadingAI(true);

    const attachments = normalizeAttachments(msg);
    const MAX_ATTACHMENT_CHARS_TO_AI = 8000;

    const hasExtractedAttachmentText = attachments.some(
      (a) => String(a?.extractedText || a?.text || "").trim().length > 0
    );
    const hasDocumentWithoutText = attachments.some(
      (a) => a?.isDocumentLike && !String(a?.extractedText || a?.text || "").trim()
    );

    const attachmentPolicy =
      attachments.length > 0
        ? `You are analyzing chat attachments.
If extracted OCR text or document text is present, base your answer primarily on that text.
Summarize what the text says, identify important fields, and answer the user's question from the extracted text.
Only use image description as fallback context when no extracted text is available.
Do not invent identities, emotions, events, locations, or storylines beyond the stored attachment data.
If a caption is marked as low/medium/high reliability, treat it cautiously and do not embellish.
If the attachment looks document-like but no text was extracted, say clearly that OCR/text extraction was unavailable or failed.`
        : "";

    const attachmentTextBlock = attachments
      .map((a) => {
        const parts = [];

        if (a.extractedText) {
          const sliced = a.extractedText.slice(0, MAX_ATTACHMENT_CHARS_TO_AI);
          const truncated =
            a.extractedText.length > MAX_ATTACHMENT_CHARS_TO_AI
              ? "\n\n[TRUNCATED]"
              : "";
          parts.push(
            `Extracted OCR text (${a.name || "image"}):\n${sliced}${truncated}`
          );
        } else if (a.text && !a.imageDescription) {
          const sliced = a.text.slice(0, MAX_ATTACHMENT_CHARS_TO_AI);
          const truncated =
            a.text.length > MAX_ATTACHMENT_CHARS_TO_AI
              ? "\n\n[TRUNCATED]"
              : "";
          parts.push(
            `Attached text content (${a.name || "file"}):\n${sliced}${truncated}`
          );
        }

        if (a.imageDescription) {
          parts.push(
            `Safer image description (${a.name || "image"}): ${a.imageDescription}`
          );
        }

        if (
          a.rawCaption &&
          a.rawCaption !== a.imageDescription &&
          a.captionRisk === "low"
        ) {
          parts.push(
            `Raw model caption (${a.name || "image"}): ${a.rawCaption}`
          );
        }

        if (a.extractionMethod) {
          parts.push(
            `Attachment extraction method (${a.name || "image"}): ${a.extractionMethod}`
          );
        }

        if (a.extractionStatus) {
          parts.push(
            `Attachment extraction status (${a.name || "image"}): ${a.extractionStatus}`
          );
        }

        if (a.extractionError) {
          parts.push(
            `Attachment extraction error (${a.name || "image"}): ${a.extractionError}`
          );
        }

        if (a.captionRisk) {
          parts.push(
            `Caption reliability (${a.name || "image"}): ${a.captionRisk}`
          );
        }

        return parts.join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n");

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

    let promptBody = `${attachmentPolicy}\n\n${baseText}${attachmentTextBlock}${attachmentMetaBlock}`.trim();

    if (!baseText && hasExtractedAttachmentText) {
      promptBody =
        `${attachmentPolicy}\n\n` +
        `The user clicked Ask AI on an attachment-focused message.\n` +
        `Explain what you understand from the extracted attachment text.\n` +
        `If it is a document, summarize the key contents and notable fields.\n\n` +
        `${attachmentTextBlock}${attachmentMetaBlock}`.trim();
    }

    if (!baseText && hasDocumentWithoutText && !hasExtractedAttachmentText) {
      promptBody =
        `${attachmentPolicy}\n\n` +
        `The user clicked Ask AI on a document-like attachment, but no text was extracted.\n` +
        `Do not describe the image generically unless explicitly asked.\n` +
        `Instead, explain that text extraction was unavailable and suggest re-uploading a clearer image or using a PDF/text source.\n\n` +
        `${attachmentTextBlock}${attachmentMetaBlock}`.trim();
    }

    if (!promptBody && attachments.length > 0) {
      promptBody =
        `A user uploaded file(s) to a chat message, but plain text content was not extracted.\n` +
        `${attachmentMetaBlock}\n\nReply with:\n` +
        `1) A short acknowledgement\n` +
        `2) What you can and cannot do without parsing the file contents\n` +
        `3) Next best step\n` +
        `4) Suggestions.`;
    }

    if (!promptBody) return;

    const { prompt, history } = await buildAskAIContext({
      scope,
      messages,
      targetMessage: msg,
      promptBody,
      decryptForAI: allowAIDecrypt,
    });

    console.log("ASK AI DEBUG", {
      scope,
      attachments,
      prompt,
      history,
    });

    const aiText = await callGeminiAPI(prompt, selectedModel, history);

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
      const arr = normalizeAttachments(msg);
      const firstTextAttachment = arr.find((x) => x?.text);

      const combinedDescription = firstTextAttachment?.text
        ? `${description}\n\n[Attachment: ${firstTextAttachment.name || "file.txt"}]\n${firstTextAttachment.text}`
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

      setTaskModalOpen(false);
      setTaskSourceMsg(null);
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
        const el = document.getElementById(`message-${messageID}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const originalBox = el.style.boxShadow;
          el.style.boxShadow = "0 0 0 6px rgba(245,158,11,0.35)";
          setTimeout(() => {
            el.style.boxShadow = originalBox || "";
          }, 1800);
        }
      } catch (err) {
        console.error("Scroll/highlight failed:", err);
      }

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

  /* ----------------- RENDER MESSAGE TEXT ----------------- */
  const renderMessageText = (text, senderId = null) => {
    if (!text) return null;
    const isAI = senderId === "AI";

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
        nodes.push({ type: "text", content: text.slice(lastIndex, index) });
      }

      nodes.push({ type: "code", content: code, lang: lang || "javascript" });
      lastIndex = index + full.length;
    }

    if (lastIndex < text.length) {
      nodes.push({ type: "text", content: text.slice(lastIndex) });
    }

    return nodes.map((node, idx) => {
      if (node.type === "code") {
        return (
          <CodeBlock key={`code-${idx}`} code={node.content} language={node.lang} />
        );
      }

      const part = node.content;
      const lines = part.split(/\r?\n/).map((l) => l.replace(/\u00A0/g, " "));
      const listItems = lines.filter((l) => l.trim().startsWith("* "));

      if (listItems.length > 0) {
        const items = listItems.map((l) => l.trim().slice(2));
        return (
          <div
            key={`text-${idx}`}
            className="mb-3 rounded-2xl border border-white/8 bg-white/6 p-4 text-sm font-medium leading-relaxed text-slate-100"
          >
            <ul className="list-disc list-inside space-y-2 ml-1">
              {items.map((it, i2) => (
                <li key={i2} className="text-sm text-slate-100">
                  {it}
                </li>
              ))}
            </ul>
          </div>
        );
      }

      return (
        <div
          key={`text-${idx}`}
          className={`mb-4 whitespace-pre-wrap rounded-2xl border p-4 text-base font-semibold leading-relaxed ${
            isAI
              ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-50"
              : "border-amber-200/20 bg-amber-200/10 text-slate-50"
          }`}
        >
          {part}
        </div>
      );
    });
  };

  /* ----------------- FILTERED MESSAGES ----------------- */
  const filteredMessages = messages.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.text?.toLowerCase().includes(q) || m.sender?.toLowerCase().includes(q)
    );
  });

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

  
  const sendDisabled =
    !canChat ||
    uploadState.busy ||
    (!message.trim() && pendingAttachments.length === 0);
  const participantCount = Object.keys(userRoles).length;
  const permissionLabel = toTitleCase(userRole || "viewer");
  const activeNowCount = new Set(
    messages
      .slice(-12)
      .map((chatMessage) => chatMessage.senderId)
      .filter((senderId) => senderId && senderId !== "AI")
  ).size;

  return (
    <div className="page-shell">
      <div className="page-frame">
      <div className={`flex min-h-[calc(100vh-2rem)] flex-col gap-4 ${activeThreadMessageID ? "xl:pr-[26rem]" : ""}`}>
        {/* Header with Search */}
        <header className="workspace-shell">
          <div className="workspace-topbar">
            <h1 className="workspace-brand-title text-[clamp(1.8rem,3vw,3rem)]">
              🐝 {hiveID} / {honeycombID}
              {unreadMessageCount > 0 && (
                <span
                  className="ml-3 inline-flex rounded-full border border-rose-300/20 bg-rose-300/15 px-3 py-1 align-middle text-xs font-semibold uppercase tracking-[0.16em] text-rose-100"
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
              className="button-ghost"
              type="button"
            >
              Back to hive
            </button>
          </div>

          <div className="glass-panel relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages and users..."
              className="input-shell pl-10 pr-10"
            />
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>

            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                type="button"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {searchQuery && (
            <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-300/70">
              Found {filteredMessages.length} message
              {filteredMessages.length !== 1 ? "s" : ""}
            </p>
          )}
        </header>

        {/* Main feed */}
        <main className="chat-feed flex-1 space-y-6">
          {hasMoreMessages && messages.length > 0 && !searchQuery && (
            <div className="mb-4 flex justify-center">
              <button
                onClick={handleLoadOlderMessages}
                disabled={loadingOlderMessages}
                className="button-secondary"
                type="button"
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
            <div className="empty-state flex h-64 flex-col items-center justify-center">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-lg font-semibold text-white">No messages found</p>
              <p className="text-sm text-slate-300">Try a different search term</p>
            </div>
          ) : null}

          {filteredMessages.map((m) => {
            const attachments = normalizeAttachments(m);
            const threadUnread = unreadThreads[m.id] || 0;
            const threadStatus = threads[m.id]?.[0]?.status || "open";

            return (
              <div
                id={`message-${m.id}`}
                key={m.id}
                className={`relative max-w-[52rem] rounded-[1.5rem] border p-4 shadow-lg shadow-slate-950/20 transition-transform duration-200 hover:-translate-y-0.5 ${
                  m.senderId === "AI"
                    ? "w-full border-cyan-300/20 bg-gradient-to-br from-cyan-300/12 to-slate-900/70"
                    : `${getUserColor(m.senderId)} w-full ${
                        m.senderId === user.uid ? "ml-auto" : ""
                      }`
                }`}
              >
                {threadUnread > 0 && (
                  <span
                    className="absolute -right-2 -top-2 rounded-full bg-cyan-400 px-2.5 py-1 text-xs font-bold text-slate-950 shadow-lg"
                    title={`${threadUnread} unread thread message${threadUnread > 1 ? "s" : ""}`}
                  >
                    {threadUnread}
                  </span>
                )}

                <div className="mb-3 flex items-center gap-2">
                  <p className="text-sm font-bold text-white">
                    {m.senderId === "AI" ? "🤖 " : ""}
                    {m.sender}
                  </p>
                  {m.senderId !== "AI" && userRoles[m.senderId] && (
                    <span className="text-xs text-slate-300" title={userRoles[m.senderId]}>
                      {getRoleEmoji(userRoles[m.senderId])}
                    </span>
                  )}
                </div>

                <div>{renderMessageText(m.text, m.senderId)}</div>

                {/*  Attachments displayed ONCE */}
                {attachments.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                      📎 {attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
                    </div>
                    <AttachmentList attachments={attachments} />
                  </div>
                )}

                {Array.isArray(m.linkedTaskIds) && m.linkedTaskIds.length > 0 && (
                  <div className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">
                    ✅ Task created ({m.linkedTaskIds.length})
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                    {m.senderId === user.uid && (
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                      {/* Model picker */}
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="input-shell min-w-[12rem] py-2 text-sm"
                        title="Model"
                        aria-label="Choose AI model"
                      >
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                      </select>

                      {/* NEW: scope picker */}
                      <select
                        value={aiScope}
                        onChange={(e) => setAiScope(e.target.value)}
                        className="input-shell min-w-[12rem] py-2 text-sm"
                        title="How much chat context to send to AI"
                        aria-label="Ask AI context scope"
                      >
                        <option value="message">This message only</option>
                        <option value="last_2">Last 2 messages</option>
                        <option value="last_3">Last 3 messages</option>
                        <option value="last_5">Last 5 messages</option>
                        <option value="last_20">Last 20 messages</option>
                        <option value="entire_chat">Entire chat</option>
                      </select>

                      {/* Ask AI uses the selected scope */}
                      <button
                        className="button-secondary"
                        onClick={() => handleAIReply(m, aiScope)}
                        disabled={loadingAI || !canChat}
                        aria-disabled={loadingAI || !canChat}
                        type="button"
                      >
                        {loadingAI ? "Thinking..." : "Ask AI 🤖"}
                      </button>

                      <button
                        className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                          allowAIDecrypt
                            ? "border-amber-300/30 bg-amber-300/18 text-amber-100"
                            : "border-white/12 bg-white/6 text-slate-200 hover:bg-white/10"
                        }`}
                        onClick={() => setAllowAIDecrypt((prev) => !prev)}
                        disabled={!canChat}
                        type="button"
                        title="Allow AI to reverse protected values for this request"
                      >
                        {allowAIDecrypt ? "Decrypt for AI: On" : "Decrypt for AI"}
                      </button>

                      <button
                        className="button-primary"
                        onClick={() => openCreateTask(m)}
                        disabled={!canChat}
                        type="button"
                      >
                        Create task
                      </button>
                    </div>
                  )}

                  <button
                    className={`button-ghost text-xs sm:text-sm ${
                      threadStatus === "closed"
                        ? "border-rose-300/25 text-rose-100"
                        : threads[m.id]?.length > 0
                        ? "border-white/16 text-white"
                        : "border-amber-300/25 text-amber-100"
                    }`}
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

          <div ref={messagesEndRef} />
        </main>

        {/* Composer */}
        <form
          onSubmit={handleSendMessage}
          className="chat-composer flex flex-col gap-3 p-4"
        >
          {/* ✅ Pending attachment queue UI */}
          {pendingAttachments.length > 0 && (
            <div className="w-full rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">
                  📎 Ready to send ({pendingAttachments.length})
                </p>

                <button
                  type="button"
                  className="text-xs font-semibold text-cyan-100 underline transition hover:text-white"
                  onClick={() => setPendingAttachments([])}
                >
                  Clear
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((a, idx) => (
                  <div
                    key={`${a?.url || a?.name || "file"}-${idx}`}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/40 px-3 py-2"
                  >
                    <span className="max-w-[240px] break-all text-xs text-slate-100">
                      {a?.name || "file"}
                    </span>

                    <button
                      type="button"
                      className="text-xs text-rose-200 transition hover:text-rose-100"
                      onClick={() =>
                        setPendingAttachments((prev) =>
                          prev.filter((_, i) => i !== idx)
                        )
                      }
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <p className="mt-2 text-[11px] text-cyan-100/80">
                Uploads are queued. Click <b>Send</b> to post them to the chat.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="flex-1 relative">
              <input
                className="input-shell pr-12"
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
                      ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                      : "bg-cyan-300/12 text-cyan-100 hover:bg-cyan-300/20"
                  }`}
                  title={isRecording ? "Stop recording" : "Start voice input"}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>

            {canChat && (
            <FileUploader
              hiveID={hiveID}
              honeycombID={honeycombID}
              userId={user.uid}
              onUploaded={handleFileUploaded}
              onUploadStateChange={setUploadState}
            />
          )}

            <button
              type="submit"
              disabled={sendDisabled}
              className="button-primary min-w-[8rem]"
              title={uploadState.busy ? "Wait for file processing to finish" : "Send"}
            >
              <span className="hidden sm:inline">
                {uploadState.phase === "processing"
                  ? "Processing..."
                  : uploadState.phase === "uploading"
                  ? `Uploading ${uploadState.progress}%`
                  : "Send"}
              </span>
              <svg
                className="w-5 h-5 sm:hidden"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </form>
      </div>

      {/* Thread Panel */}
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

          memoryQuery={memoryQuery}
          setMemoryQuery={setMemoryQuery}
          memoryResponse={memoryResponse}
          handleSearchMemory={handleSearchMemory}
          isSearchingMemory={isSearchingMemory}
        />
      )}

      {/* Create Task Modal */}
      <CreateTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onSave={saveTask}
        messageText={taskSourceMsg?.text || ""}
        attachmentText={modalAttachmentText}
      />
    </div>
    </div>
  );
}

/* ----------------- THREAD PANEL ----------------- */
function ThreadPanel({
  activeThreadMessageID,
  threads,
  messages,
  onClose,
  onSend,
  hiveID,
  honeycombID,
  user,
  userRole,
  loadSummaries,
  summaries,
  onOpenThread,
  memoryQuery,
  setMemoryQuery,
  memoryResponse,
  handleSearchMemory,
  isSearchingMemory
}) {
  const canChat = userRole ? checkPermission(userRole, "SEND_MESSAGE") : true;

  const [threadUserColors, setThreadUserColors] = useState({});
  const [threadUserRoles, setThreadUserRoles] = useState({});

  const currentThread = threads[activeThreadMessageID] || [];
  const parentMessage = messages.find((m) => m.id === activeThreadMessageID);

  const replyInputRef = useRef(null);

  const [panelWidth, setPanelWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef(null);

  const getThreadUserColor = (userId) => {
    if (!userId) return "border-gray-400 bg-gray-50";
    if (threadUserColors[userId]) return threadUserColors[userId];

    const colors = [
      "border-amber-300/30 bg-amber-300/10",
      "border-blue-300/30 bg-blue-300/10",
      "border-emerald-300/30 bg-emerald-300/10",
      "border-violet-300/30 bg-violet-300/10",
      "border-pink-300/30 bg-pink-300/10",
      "border-indigo-300/30 bg-indigo-300/10",
      "border-orange-300/30 bg-orange-300/10",
      "border-teal-300/30 bg-teal-300/10",
      "border-rose-300/30 bg-rose-300/10",
      "border-cyan-300/30 bg-cyan-300/10",
    ];

    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    setThreadUserColors((prev) => ({ ...prev, [userId]: randomColor }));
    return randomColor;
  };

  const getRoleEmoji = (role) => {
    const roleMap = {
      OWNER: "👑",
      ADMIN: "⚡",
      MEMBER: "👤",
      VIEWER: "👁️",
    };
    return roleMap[role] || "👤";
  };

  useEffect(() => {
    if (!hiveID) return;

    async function loadMemberRoles() {
      try {
        const membersRef = collection(db, "Hive", hiveID, "members");
        const snapshot = await getDocs(membersRef);
        const roles = {};
        snapshot.docs.forEach((d) => {
          roles[d.id] = d.data()?.role;
        });
        setThreadUserRoles(roles);
      } catch (err) {
        console.error("Failed to load member roles:", err);
      }
    }

    loadMemberRoles();
  }, [hiveID]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 320 && newWidth <= 800) setPanelWidth(newWidth);
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  useEffect(() => {
    if (!activeThreadMessageID) return;
    try {
      setTimeout(() => {
        replyInputRef.current?.focus?.();
      }, 80);
    } catch (err) {
      console.error("Failed to focus thread reply input:", err);
    }
  }, [activeThreadMessageID]);

  const [showHelp, setShowHelp] = useState(true);
  useEffect(() => {
    try {
      const dismissed =
        typeof window !== "undefined"
          ? localStorage.getItem("honeycomb_help_dismissed")
          : null;
      if (dismissed === "1") setShowHelp(false);
    } catch {
      // ignore
    }
  }, []);

  const dismissHelp = () => {
    try {
      localStorage.setItem("honeycomb_help_dismissed", "1");
    } catch {
      // ignore
    }
    setShowHelp(false);
  };

  const threadStatus = currentThread[0]?.status || "open";
  const threadClosed = threadStatus === "closed";

  const handleToggleThreadStatus = async () => {
    const currentStatus = currentThread[0]?.status || "open";

    if (currentStatus === "open") {
      // 1. Standard L3/L4 Closure & Notification
      await closeThreadAndNotify(
        hiveID,
        honeycombID,
        activeThreadMessageID,
        currentThread[0].id,
        user
      );

      // 2. Advanced CS: Knowledge Nectar Distillation
      try {
        console.log("🐝 HiveMind is distilling Knowledge Nectar...");
        
        // Ensure we combine the parent message and all replies for full context
        const fullDiscussionContext = `
          PRIMARY QUESTION/TOPIC: ${parentMessage?.text || "No topic provided"}
          
          TEAM DISCUSSION:
          ${currentThread.map(m => `${m.sender}: ${m.text}`).join("\n")}
        `;

        // L4 Repository call to AI Gateway
        await NectarRepository.distillAndSave(hiveID, fullDiscussionContext);
        
        console.log("🍯 Knowledge Nectar successfully stored in Hive Memory!");
      } catch (err) {
        // We catch errors here so the UI doesn't crash if the AI fails
        console.error("Knowledge Nectar extraction failed:", err);
      }

      // 3. UI Refresh
      try {
        await loadSummaries();
      } catch (err) {
        console.error("Failed to refresh summaries after close:", err);
      }
    } else {
      // Reopen logic
      await setThreadStatus(
        hiveID,
        honeycombID,
        activeThreadMessageID,
        currentThread[0].id,
        "open"
      );
    }
  };

  return (
    <div
      ref={panelRef}
      className={`thread-panel-shell fixed right-0 top-0 z-50 flex h-full flex-col p-3 sm:p-4 ${
        isMobile ? "left-0" : ""
      }`}
      style={isMobile ? {} : { width: `${panelWidth}px` }}
    >
      {!isMobile && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 w-1 h-full cursor-ew-resize hover:bg-indigo-400 transition-colors group"
          style={{ marginLeft: "-2px" }}
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-16 bg-gray-300 group-hover:bg-indigo-500 rounded-r transition-colors"></div>
        </div>
      )}

      <button
        className="button-ghost mb-3 text-sm sm:text-base"
        onClick={onClose}
        type="button"
      >
        Close
      </button>

      <div className="flex-1 overflow-y-auto rounded-[1.5rem] border border-white/10 bg-slate-950/30 p-4">
        <p className="mb-3 whitespace-pre-wrap text-base font-bold leading-relaxed text-white">
          {parentMessage?.text}
        </p>

        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
          Status:{" "}
          <span
            className={
              threadClosed ? "font-bold text-rose-200" : "font-bold text-emerald-200"
            }
          >
            {threadStatus.toUpperCase()}
          </span>
        </p>

        {currentThread.map((thread) => (
          <div
            key={thread.id}
            className={`mb-3 rounded-2xl border p-3 ${
              thread.senderId === "AI"
                ? "border-cyan-300/20 bg-cyan-300/10"
                : `${getThreadUserColor(thread.senderId)}`
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <p className="text-xs font-semibold text-slate-100">
                {thread.senderId === "AI" ? "🤖 " : ""}
                {thread.sender}
              </p>
              {thread.senderId !== "AI" && threadUserRoles[thread.senderId] && (
                <span className="text-xs text-slate-300" title={threadUserRoles[thread.senderId]}>
                  {getRoleEmoji(threadUserRoles[thread.senderId])}
                </span>
              )}
            </div>
            <p className="break-words whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
              {thread.text}
            </p>
          </div>
        ))}
      </div>
        <div className="mb-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-white shadow-lg">
  <h3 className="text-sm font-bold flex items-center gap-2 mb-3">🧠 Ask Hive Mind</h3>
  <input 
    value={memoryQuery} 
    onChange={(e) => setMemoryQuery(e.target.value)} 
    className="input-shell mb-2 text-sm" 
    placeholder="Ask a previous decision..." 
  />
  <button 
    onClick={handleSearchMemory} 
    disabled={isSearchingMemory}
    className="button-primary w-full text-xs"
  >
    {isSearchingMemory ? "Thinking..." : "Query Memory"}
  </button>
  {memoryResponse && (
    <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-100">
      {memoryResponse}
    </div>
  )}
</div>
      <ThreadInput
        parentMessageID={activeThreadMessageID}
        onSend={onSend}
        inputRef={replyInputRef}
        disabled={!canChat || threadClosed}
      />

      {currentThread[0]?.senderId === user.uid && canChat && (
        <button
  onClick={handleToggleThreadStatus} // Much cleaner!
  className={`mt-2 rounded-full px-4 py-2 font-semibold ${
    threadClosed
      ? "bg-emerald-500 text-white hover:bg-emerald-600"
      : "bg-rose-500 text-white hover:bg-rose-600"
  }`}
  type="button"
>
  {threadClosed ? "Reopen Thread" : "Close Thread"}
</button>
      )}
      {/* Summary only for this thread if closed */}
      {threadClosed &&
        (() => {
          const threadSummary = (summaries || []).find(
            (s) => s.threadID === currentThread[0]?.id
          );
          return threadSummary ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg">
              <div className="flex items-center gap-2 border-b border-white/10 bg-cyan-300/10 px-4 py-3">
                <span className="text-2xl">✨</span>
                <h2 className="text-base font-bold text-white">Thread Summary</h2>
              </div>

                <div className="p-4">
                  <SummaryCard
                    summary={threadSummary}
                    onOpenThread={onOpenThread}
                    threadMessages={currentThread}
                    parentMessage={parentMessage}
                    showOpenButton={false}
                  />
                </div>
              </div>
            ) : null;
          })()}


      {showHelp && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 shadow-sm">
          <div className="flex items-start justify-between">
            <h3 className="text-sm font-semibold text-white">UI Guide</h3>
            <button
              onClick={dismissHelp}
              className="text-xs text-slate-400 hover:text-white"
              title="Dismiss help"
              type="button"
            >
              Got it
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-300">
            Quick orientation to the Honeycomb UI:
          </p>
          <ul className="mt-2 list-disc list-inside space-y-1 text-xs text-slate-300">
            <li>
              <strong>Messages:</strong> Main feed on the left. Click
              “Start/View Thread” to open a sub-conversation.
            </li>
            <li>
              <strong>Thread panel:</strong> Right column — shows thread replies
              and lets you reply or close a thread.
            </li>
            <li>
              <strong>Ask AI:</strong> Use on a message you sent to generate an
              AI reply into the conversation.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/* ----------------- SUMMARY CARD ----------------- */
function SummaryCard({
        summary,
        index,
        onOpenThread,
        threadMessages,
        showOpenButton = true,
      }) {
        const [expanded, setExpanded] = useState(false);
        const [copied, setCopied] = useState(false);

        const [userColor] = useState(() => {
          const colors = [
            "from-yellow-500 to-yellow-600",
            "from-blue-500 to-blue-600",
            "from-green-500 to-green-600",
            "from-purple-500 to-purple-600",
            "from-pink-500 to-pink-600",
            "from-indigo-500 to-indigo-600",
            "from-orange-500 to-orange-600",
            "from-teal-500 to-teal-600",
            "from-red-500 to-red-600",
            "from-cyan-500 to-cyan-600",
          ];
          return colors[Math.floor(Math.random() * colors.length)];
        });

        const getRoleEmoji = (role) => {
          const roleMap = {
            OWNER: "👑",
            ADMIN: "⚡",
            MEMBER: "👤",
            VIEWER: "👁️",
          };
          return roleMap[role] || "👤";
        };

        const getRelativeTime = (timestamp) => {
          if (!timestamp) return "Unknown time";
          const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
          const now = new Date();
          const diff = now - date;

          const minutes = Math.floor(diff / 60000);
          const hours = Math.floor(diff / 3600000);
          const days = Math.floor(diff / 86400000);

          if (minutes < 1) return "Just now";
          if (minutes < 60) return `${minutes}m ago`;
          if (hours < 24) return `${hours}h ago`;
          if (days < 7) return `${days}d ago`;
          return date.toLocaleDateString();
        };

        const handleCopy = async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(summary.summaryText || "");
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch (err) {
            console.error("Failed to copy:", err);
          }
        };

        const messageCount = threadMessages?.length || 0;

        return (
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 shadow-sm transition-all duration-200 hover:border-cyan-300/20 hover:shadow-lg">
            <div className="p-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1">
                  {index !== undefined && (
                    <div
                      className={`flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br ${userColor} flex items-center justify-center text-white text-xs font-bold`}
                    >
                      {index + 1}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-semibold text-cyan-100">
                        Thread #{String(summary.threadID || "").slice(0, 8)}
                      </span>

                      {messageCount > 0 && (
                        <span className="rounded-full bg-cyan-300/12 px-2 py-0.5 text-xs font-medium text-cyan-100">
                          {messageCount} message{messageCount !== 1 ? "s" : ""}
                        </span>
                      )}

                      <span className="text-xs text-slate-400">
                        {getRelativeTime(summary.generatedAt)}
                      </span>

                      {summary.closedByUserName && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          by{" "}
                          <span className="font-medium text-slate-200">
                            {summary.closedByUserName}
                          </span>
                          {summary.closedByRole && (
                            <span title={summary.closedByRole}>
                              {getRoleEmoji(summary.closedByRole)}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    <p
                      className={`text-sm leading-relaxed text-slate-100 ${
                        !expanded ? "line-clamp-2" : ""
                      }`}
                    >
                      {summary.summaryText}
                    </p>
                  </div>
                </div>

                <button
                  className="flex-shrink-0 text-cyan-100 transition-transform duration-200 hover:text-white"
                  style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  type="button"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {expanded && (
              <div className="px-3 pb-3 pt-0">
                <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                    {summary.summaryText}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="button-ghost flex-1 text-sm"
                    type="button"
                  >
                    {copied ? "✓ Copied!" : "📋 Copy"}
                  </button>

                  {showOpenButton && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenThread && onOpenThread(summary.parentMessageID);
                      }}
                      className="button-primary flex-1 text-sm"
                      type="button"
                    >
                      Open Thread
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      }


/* ----------------- THREAD INPUT ----------------- */
function ThreadInput({ parentMessageID, onSend, inputRef, disabled }) {
  const [text, setText] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled) return;
    if (!text.trim()) return;
    onSend(text, parentMessageID);
    setText("");
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? "Thread is closed or view-only" : "Reply in thread..."}
        disabled={disabled}
        className="input-shell flex-1 text-sm"
      />
      <button
        type="submit"
        disabled={disabled}
        className="button-primary text-sm"
      >
        Reply
      </button>
    </form>
  );
}
