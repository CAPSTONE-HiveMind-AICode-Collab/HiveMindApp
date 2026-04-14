"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  connectSandboxCollabAwareness,
  ensureSandboxCollabState,
  mergeSandboxCollabUpdate,
  subscribeToSandboxCollabAwareness,
  subscribeToSandboxCollabState,
  writeSandboxCollabAwareness,
} from "@/lib/data/sandboxCollabRepository";
import { normalizeSandboxEditorLanguage } from "@/lib/sandbox/fileSupport";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[34rem] items-center justify-center rounded-[1.25rem] border border-white/10 bg-[#04101f] text-sm text-slate-300/75">
      Loading editor...
    </div>
  ),
});

const REMOTE_SYNC_ORIGIN = "hivemind-remote-sync";
const REMOTE_AWARENESS_ORIGIN = "hivemind-remote-awareness";

function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("permission-denied") || message.includes("permission_denied");
}

function encodeUint8Array(value) {
  if (!(value instanceof Uint8Array) || !value.length) {
    return "";
  }

  let binary = "";
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary);
}

function decodeUint8Array(value) {
  const encoded = String(value || "").trim();
  if (!encoded) {
    return new Uint8Array();
  }

  const binary = atob(encoded);
  const decoded = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    decoded[index] = binary.charCodeAt(index);
  }
  return decoded;
}

function buildCollaborationClientId(collaboration) {
  const userId = String(collaboration?.currentUserId || "guest").trim() || "guest";
  const targetFilePath =
    String(collaboration?.targetFilePath || "file")
      .trim()
      .replace(/[^\w.-]+/g, "-") || "file";
  return `${userId}-${targetFilePath}-${Math.random().toString(36).slice(2, 10)}`;
}

function pickCollaborationColor(seed = "") {
  const palette = [
    "#22d3ee",
    "#f59e0b",
    "#34d399",
    "#f472b6",
    "#60a5fa",
    "#c084fc",
    "#fb7185",
    "#facc15",
  ];

  const text = String(seed || "guest");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

export default function HighlightedCodeEditor({
  value,
  language = "javascript",
  minHeight = "34rem",
  readOnly = false,
  onChange,
  collaboration = null,
  externalChangeKey = 0,
}) {
  const editorRef = useRef(null);
  const modelRef = useRef(null);
  const bindingRef = useRef(null);
  const ydocRef = useRef(null);
  const ytextRef = useRef(null);
  const awarenessRef = useRef(null);
  const unsubscribeCollabRef = useRef(null);
  const unsubscribeAwarenessRef = useRef(null);
  const disconnectAwarenessRef = useRef(null);
  const localObserverRef = useRef(null);
  const localUpdateHandlerRef = useRef(null);
  const localAwarenessHandlerRef = useRef(null);
  const flushTimerRef = useRef(null);
  const awarenessFlushTimerRef = useRef(null);
  const pendingUpdatesRef = useRef([]);
  const pendingAwarenessUpdateRef = useRef("");
  const lastAppliedStateRef = useRef("");
  const remoteAwarenessStatesRef = useRef(new Map());
  const clientIdRef = useRef("");
  const [collabDisabled, setCollabDisabled] = useState(false);
  const [collabReady, setCollabReady] = useState(false);

  const collabConfig = useMemo(() => {
    if (
      !collaboration?.enabled ||
      !collaboration?.hiveID ||
      !collaboration?.honeycombID ||
      !collaboration?.targetFilePath
    ) {
      return null;
    }

    return {
      enabled: true,
      hiveID: String(collaboration.hiveID),
      honeycombID: String(collaboration.honeycombID),
      targetFilePath: String(collaboration.targetFilePath),
      currentUserId: String(collaboration.currentUserId || ""),
      currentUserName: String(collaboration.currentUserName || ""),
      currentUserEmail: String(collaboration.currentUserEmail || ""),
      currentUserPhotoURL: String(collaboration.currentUserPhotoURL || ""),
    };
  }, [
    collaboration?.enabled,
    collaboration?.hiveID,
    collaboration?.honeycombID,
    collaboration?.targetFilePath,
    collaboration?.currentUserId,
    collaboration?.currentUserName,
    collaboration?.currentUserEmail,
    collaboration?.currentUserPhotoURL,
  ]);

  const effectiveCollabConfig = collabConfig && !collabDisabled ? collabConfig : null;

  const editorKey = useMemo(() => {
    if (effectiveCollabConfig) {
      return `collab:${effectiveCollabConfig.hiveID}:${effectiveCollabConfig.honeycombID}:${effectiveCollabConfig.targetFilePath}`;
    }

    return `local:${normalizeSandboxEditorLanguage(language)}`;
  }, [effectiveCollabConfig, language]);

  useEffect(() => {
    setCollabDisabled(false);
  }, [collabConfig?.hiveID, collabConfig?.honeycombID, collabConfig?.targetFilePath]);

  useEffect(() => {
    if (!effectiveCollabConfig || !collabReady || !ydocRef.current || !ytextRef.current) {
      return;
    }

    const incomingValue = String(value || "");
    const currentValue = ytextRef.current.toString();
    if (!incomingValue || incomingValue === currentValue) {
      return;
    }

    // Recover older blank shared sessions that were seeded before the real file loaded.
    if (currentValue.trim().length > 0) {
      return;
    }

    ydocRef.current.transact(() => {
      const text = ytextRef.current;
      text.delete(0, text.length);
      text.insert(0, incomingValue);
    }, "hivemind-prop-hydrate");
  }, [collabReady, effectiveCollabConfig, value]);

  useEffect(() => {
    if (!effectiveCollabConfig || !collabReady || !ydocRef.current || !ytextRef.current) {
      return;
    }

    const nextValue = String(value || "");
    const currentValue = ytextRef.current.toString();
    if (nextValue === currentValue) {
      return;
    }

    ydocRef.current.transact(() => {
      const text = ytextRef.current;
      text.delete(0, text.length);
      if (nextValue) {
        text.insert(0, nextValue);
      }
    }, "hivemind-external-apply");
  }, [collabReady, effectiveCollabConfig, externalChangeKey, value]);

  const disposeCollaboration = () => {
    unsubscribeCollabRef.current?.();
    unsubscribeCollabRef.current = null;
    unsubscribeAwarenessRef.current?.();
    unsubscribeAwarenessRef.current = null;
    disconnectAwarenessRef.current?.();
    disconnectAwarenessRef.current = null;

    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    if (awarenessFlushTimerRef.current) {
      window.clearTimeout(awarenessFlushTimerRef.current);
      awarenessFlushTimerRef.current = null;
    }

    if (localObserverRef.current && ytextRef.current) {
      ytextRef.current.unobserve(localObserverRef.current);
      localObserverRef.current = null;
    }

    if (localUpdateHandlerRef.current && ydocRef.current) {
      ydocRef.current.off("update", localUpdateHandlerRef.current);
      localUpdateHandlerRef.current = null;
    }

    if (localAwarenessHandlerRef.current && awarenessRef.current) {
      awarenessRef.current.off("update", localAwarenessHandlerRef.current);
      localAwarenessHandlerRef.current = null;
    }

    bindingRef.current?.destroy();
    bindingRef.current = null;

    awarenessRef.current = null;
    ydocRef.current?.destroy();
    ydocRef.current = null;
    ytextRef.current = null;

    pendingUpdatesRef.current = [];
    pendingAwarenessUpdateRef.current = "";
    lastAppliedStateRef.current = "";
    remoteAwarenessStatesRef.current = new Map();
    clientIdRef.current = "";
    setCollabReady(false);
  };

  useEffect(() => () => disposeCollaboration(), []);

  async function flushPendingUpdates() {
    if (!effectiveCollabConfig || !pendingUpdatesRef.current.length) {
      return;
    }

    const nextDoc = new Y.Doc();
    const updates = pendingUpdatesRef.current.splice(0);
    updates.forEach((update) => {
      Y.applyUpdate(nextDoc, update);
    });

    try {
      await mergeSandboxCollabUpdate({
        hiveID: effectiveCollabConfig.hiveID,
        honeycombID: effectiveCollabConfig.honeycombID,
        targetFilePath: effectiveCollabConfig.targetFilePath,
        updateBase64: encodeUint8Array(Y.encodeStateAsUpdate(nextDoc)),
        clientId: clientIdRef.current,
      });
    } catch (error) {
      pendingUpdatesRef.current = [...updates, ...pendingUpdatesRef.current];
      if (isPermissionDeniedError(error)) {
        setCollabDisabled(true);
        return;
      }
      console.error("Sandbox collaboration update failed:", error);
    }
  }

  function scheduleFlush() {
    if (flushTimerRef.current || !effectiveCollabConfig) {
      return;
    }

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flushPendingUpdates();
    }, 120);
  }

  async function flushAwarenessUpdate() {
    if (!effectiveCollabConfig || !pendingAwarenessUpdateRef.current || !ydocRef.current) {
      return;
    }

    const updateBase64 = pendingAwarenessUpdateRef.current;
    pendingAwarenessUpdateRef.current = "";

    try {
      await writeSandboxCollabAwareness({
        hiveID: effectiveCollabConfig.hiveID,
        honeycombID: effectiveCollabConfig.honeycombID,
        targetFilePath: effectiveCollabConfig.targetFilePath,
        clientId: ydocRef.current.clientID,
        userId: effectiveCollabConfig.currentUserId,
        displayName: effectiveCollabConfig.currentUserName,
        email: effectiveCollabConfig.currentUserEmail,
        photoURL: effectiveCollabConfig.currentUserPhotoURL,
        color: pickCollaborationColor(effectiveCollabConfig.currentUserId),
        updateBase64,
      });
    } catch (error) {
      pendingAwarenessUpdateRef.current = updateBase64;
      if (isPermissionDeniedError(error)) {
        setCollabDisabled(true);
        return;
      }
      console.error("Sandbox awareness update failed:", error);
    }
  }

  function scheduleAwarenessFlush() {
    if (awarenessFlushTimerRef.current || !effectiveCollabConfig) {
      return;
    }

    awarenessFlushTimerRef.current = window.setTimeout(() => {
      awarenessFlushTimerRef.current = null;
      void flushAwarenessUpdate();
    }, 80);
  }

  async function setupCollaboration(model) {
    if (!effectiveCollabConfig || !editorRef.current || !model) {
      return;
    }

    try {
      disposeCollaboration();
      clientIdRef.current = buildCollaborationClientId(effectiveCollabConfig);

      const doc = new Y.Doc();
      const text = doc.getText("content");
      const awareness = new Awareness(doc);

      const initialState = await ensureSandboxCollabState({
        hiveID: effectiveCollabConfig.hiveID,
        honeycombID: effectiveCollabConfig.honeycombID,
        targetFilePath: effectiveCollabConfig.targetFilePath,
        initialText: String(value || ""),
        clientId: clientIdRef.current,
      });

      const initialUpdate = String(initialState?.update || "").trim();
      if (initialUpdate) {
        lastAppliedStateRef.current = initialUpdate;
        Y.applyUpdate(doc, decodeUint8Array(initialUpdate), REMOTE_SYNC_ORIGIN);
      }

      const userColor = pickCollaborationColor(effectiveCollabConfig.currentUserId);

      ydocRef.current = doc;
      ytextRef.current = text;
      awarenessRef.current = awareness;

      awareness.setLocalStateField("user", {
        name:
          effectiveCollabConfig.currentUserName ||
          effectiveCollabConfig.currentUserEmail ||
          effectiveCollabConfig.currentUserId ||
          "Teammate",
        color: userColor,
        photoURL: effectiveCollabConfig.currentUserPhotoURL,
      });

      bindingRef.current = new MonacoBinding(
        text,
        model,
        new Set([editorRef.current]),
        awareness
      );

      const handleTextChange = () => {
        onChange?.(text.toString());
      };

      const handleDocUpdate = (update, origin) => {
        if (origin === REMOTE_SYNC_ORIGIN) {
          return;
        }

        pendingUpdatesRef.current.push(update);
        scheduleFlush();
      };

      const handleAwarenessUpdate = () => {
        pendingAwarenessUpdateRef.current = encodeUint8Array(
          encodeAwarenessUpdate(awareness, [doc.clientID])
        );
        scheduleAwarenessFlush();
      };

      localObserverRef.current = handleTextChange;
      localUpdateHandlerRef.current = handleDocUpdate;
      localAwarenessHandlerRef.current = handleAwarenessUpdate;
      text.observe(handleTextChange);
      doc.on("update", handleDocUpdate);
      awareness.on("update", handleAwarenessUpdate);

      disconnectAwarenessRef.current = connectSandboxCollabAwareness({
        hiveID: effectiveCollabConfig.hiveID,
        honeycombID: effectiveCollabConfig.honeycombID,
        targetFilePath: effectiveCollabConfig.targetFilePath,
        clientId: doc.clientID,
        userId: effectiveCollabConfig.currentUserId,
        displayName: effectiveCollabConfig.currentUserName,
        email: effectiveCollabConfig.currentUserEmail,
        photoURL: effectiveCollabConfig.currentUserPhotoURL,
        color: userColor,
      });

      unsubscribeCollabRef.current = subscribeToSandboxCollabState(
        {
          hiveID: effectiveCollabConfig.hiveID,
          honeycombID: effectiveCollabConfig.honeycombID,
          targetFilePath: effectiveCollabConfig.targetFilePath,
        },
      (nextState) => {
        const nextUpdate = String(nextState?.update || "").trim();
        if (!nextUpdate || nextUpdate === lastAppliedStateRef.current || !ydocRef.current) {
          return;
        }

        lastAppliedStateRef.current = nextUpdate;
        Y.applyUpdate(
          ydocRef.current,
          decodeUint8Array(nextUpdate),
          REMOTE_SYNC_ORIGIN
        );
      }
    );

      unsubscribeAwarenessRef.current = subscribeToSandboxCollabAwareness(
        {
          hiveID: effectiveCollabConfig.hiveID,
          honeycombID: effectiveCollabConfig.honeycombID,
          targetFilePath: effectiveCollabConfig.targetFilePath,
        },
      (nextAwareness) => {
        const nextEntries = Object.values(nextAwareness || {}).filter(Boolean);
        const nextRemoteIds = new Set();

        nextEntries.forEach((entry) => {
          const nextClientId = Number(entry?.clientId);
          const nextUpdateBase64 = String(entry?.updateBase64 || "").trim();

          if (
            !Number.isFinite(nextClientId) ||
            nextClientId === doc.clientID ||
            !nextUpdateBase64
          ) {
            return;
          }

          nextRemoteIds.add(nextClientId);

          if (remoteAwarenessStatesRef.current.get(nextClientId) === nextUpdateBase64) {
            return;
          }

          remoteAwarenessStatesRef.current.set(nextClientId, nextUpdateBase64);
          applyAwarenessUpdate(
            awareness,
            decodeUint8Array(nextUpdateBase64),
            REMOTE_AWARENESS_ORIGIN
          );
        });

        Array.from(remoteAwarenessStatesRef.current.keys()).forEach((clientId) => {
          if (nextRemoteIds.has(clientId)) {
            return;
          }

          remoteAwarenessStatesRef.current.delete(clientId);
          removeAwarenessStates(awareness, [clientId], REMOTE_AWARENESS_ORIGIN);
        });
      }
    );

      onChange?.(text.toString());
      setCollabReady(true);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setCollabDisabled(true);
        setCollabReady(false);
        onChange?.(String(value || ""));
        return;
      }

      throw error;
    }
  }

  const editorProps = effectiveCollabConfig
    ? { defaultValue: String(value || "") }
    : { value: String(value || "") };

  return (
    <div
      className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#04101f]"
      style={{ minHeight }}
    >
      {effectiveCollabConfig && !collabReady ? (
        <div className="border-b border-cyan-300/12 bg-cyan-300/8 px-4 py-2 text-xs uppercase tracking-[0.18em] text-cyan-100/75">
          Connecting live co-editing...
        </div>
      ) : null}

      {collabConfig && collabDisabled ? (
        <div className="border-b border-amber-300/18 bg-amber-300/8 px-4 py-2 text-xs uppercase tracking-[0.18em] text-amber-100/80">
          Live collaboration is unavailable until Firebase Realtime Database rules are updated.
        </div>
      ) : null}

      <MonacoEditor
        key={editorKey}
        height={minHeight}
        defaultLanguage={normalizeSandboxEditorLanguage(language)}
        language={normalizeSandboxEditorLanguage(language)}
        theme="vs-dark"
        onMount={(editor) => {
          editorRef.current = editor;
          modelRef.current = editor.getModel();

          if (effectiveCollabConfig && modelRef.current) {
            void setupCollaboration(modelRef.current).catch((error) => {
              console.error("Sandbox collaboration setup failed:", error);
            });
          }
        }}
        onChange={
          effectiveCollabConfig ? undefined : (nextValue) => onChange?.(String(nextValue || ""))
        }
        options={{
          automaticLayout: true,
          readOnly,
          minimap: { enabled: false },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: "smart",
          snippetSuggestions: "inline",
          wordBasedSuggestions: "currentDocument",
          inlineSuggest: { enabled: false },
          parameterHints: { enabled: true },
          lightbulb: { enabled: "off" },
          tabCompletion: "on",
          fontSize: 15,
          lineHeight: 30,
          fontFamily:
            '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, "Courier New", monospace',
          fontLigatures: false,
          padding: {
            top: 18,
            bottom: 18,
          },
          renderLineHighlight: "line",
          roundedSelection: false,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          mouseWheelScrollSensitivity: 1,
          mouseWheelZoom: false,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: "off",
          folding: true,
          fixedOverflowWidgets: false,
          lineNumbersMinChars: 3,
          guides: {
            indentation: true,
          },
          scrollbar: {
            vertical: "visible",
            horizontal: "visible",
            alwaysConsumeMouseWheel: true,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
        {...editorProps}
      />
    </div>
  );
}
