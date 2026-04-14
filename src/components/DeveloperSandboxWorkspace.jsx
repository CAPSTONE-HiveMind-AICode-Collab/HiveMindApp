"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { extractJsonObject } from "@/lib/ai/structuredOutput";
import {
  subscribeToSandboxSession,
  upsertSandboxSession,
} from "@/lib/data/sandboxSessionRepository";
import { replaceSandboxCollabState } from "@/lib/data/sandboxCollabRepository";
import {
  subscribeToSandboxPresence,
  syncSandboxPresence,
} from "@/lib/data/presenceRepository";
import {
  buildSandboxStreamUrl,
  listSandboxFiles,
  loadSandboxFile,
  saveSandboxFile,
  startSandboxPreview,
  startSandboxRun,
  stopSandboxPreview,
} from "@/lib/data/sandboxRepository";
import {
  buildSandboxTaskAttachment,
  extractFileReferences,
  getFirstCodeBlock,
} from "@/lib/sandbox/codeBlocks";
import {
  canUseSandboxPreview,
  DEFAULT_SANDBOX_CONFIG,
  getSandboxPreviewCommand,
  getSandboxRunCommand,
  normalizeSandboxConfig,
} from "@/lib/sandbox/config";
import SandboxSettingsModal from "@/components/SandboxSettingsModal";
import HighlightedCodeEditor from "@/components/HighlightedCodeEditor";
import SandboxTerminalPanel from "@/components/SandboxTerminalPanel";
import UserAvatar from "@/components/UserAvatar";

function formatStamp(value) {
  if (!value) return "just now";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarizeMessage(text, maxLength = 88) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function summarizeOutputForSession(text, maxLength = 2800) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(value.length - maxLength)}`;
}

function extractMeaningfulOutputLine(text) {
  const candidates = String(text || "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[HiveMind] Workspace copied to"))
    .filter((line) => !line.startsWith("> test"))
    .filter((line) => !line.startsWith("> node "))
    .filter((line) => !line.startsWith("> npm "))
    .filter((line) => !line.startsWith("[HiveMind] Running "))
    .filter((line) => !line.startsWith("[HiveMind] Starting preview with "));

  if (!candidates.length) {
    return "";
  }

  const priorityMatchers = [
    /^PASS\b/i,
    /^FAIL\b/i,
    /Preview live at /i,
    /^[A-Za-z]*Error:/,
    /^Error:/,
    /^SyntaxError:/,
    /^ReferenceError:/,
    /^TypeError:/,
    /^Running /,
    /^Saved /,
    /^Command exited /i,
  ];

  for (const matcher of priorityMatchers) {
    const hit = candidates.find((line) => matcher.test(line));
    if (hit) {
      return hit;
    }
  }

  return candidates[candidates.length - 1];
}

function summarizeSessionResultLine(text, fallback = "", maxLength = 180) {
  const value = extractMeaningfulOutputLine(text) || String(fallback || "").trim();
  if (!value) {
    return "";
  }
  return summarizeMessage(value, maxLength);
}

const DEBUG_FILE_EXTENSION_PATTERN =
  /\.(?:jsx?|tsx?|py|json|css|html|mjs|cjs)$/i;

function decodePathCandidate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function normalizeDebugPathCandidate(value) {
  let normalized = decodePathCandidate(value)
    .replace(/^file:\/\/\/?/i, "")
    .replace(/\\/g, "/")
    .replace(/[),:;]+$/g, "")
    .trim();

  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/^[A-Za-z]:\//, "");

  const repoMarkers = [
    ".sandbox-workspaces/",
    "/workspace/repo/",
    "/repo/",
  ];

  for (const marker of repoMarkers) {
    const markerIndex = normalized.toLowerCase().indexOf(marker.toLowerCase());
    if (markerIndex === -1) {
      continue;
    }

    if (marker === ".sandbox-workspaces/") {
      const repoSegmentIndex = normalized
        .toLowerCase()
        .indexOf("/repo/", markerIndex);
      if (repoSegmentIndex !== -1) {
        normalized = normalized.slice(repoSegmentIndex + "/repo/".length);
      }
      continue;
    }

    normalized = normalized.slice(markerIndex + marker.length);
  }

  normalized = normalizeTargetPath(normalized);
  if (!DEBUG_FILE_EXTENSION_PATTERN.test(normalized)) {
    return "";
  }

  return normalized;
}

function extractDebugFileCandidates(text) {
  const value = String(text || "");
  if (!value.trim()) {
    return [];
  }

  const candidates = [
    ...extractFileReferences(value),
    ...(value.match(/(?:file:\/\/\/)?[A-Za-z]:[^\s"'`<>]+?\.(?:jsx?|tsx?|py|json|css|html|mjs|cjs)/gi) || []),
    ...(value.match(/(?:file:\/\/)?\/[^\s"'`<>]+?\.(?:jsx?|tsx?|py|json|css|html|mjs|cjs)/gi) || []),
  ];

  const seen = new Set();
  const normalized = [];

  for (const candidate of candidates) {
    const nextValue = normalizeDebugPathCandidate(candidate);
    if (!nextValue || seen.has(nextValue)) {
      continue;
    }

    seen.add(nextValue);
    normalized.push(nextValue);
  }

  return normalized;
}

function resolveRelatedDebugFiles({ outputText, summaryText, files, currentTargetFilePath }) {
  if (!Array.isArray(files) || !files.length) {
    return [];
  }

  const currentPath = normalizeTargetPath(currentTargetFilePath).toLowerCase();
  const candidates = extractDebugFileCandidates(
    [summaryText, outputText].filter(Boolean).join("\n")
  );
  const resolved = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const match = findBestMatchingFilePath(candidate, files);
    const normalizedMatch = normalizeTargetPath(match).toLowerCase();

    if (!match || !normalizedMatch || normalizedMatch === currentPath || seen.has(normalizedMatch)) {
      continue;
    }

    seen.add(normalizedMatch);
    resolved.push(match);
  }

  return resolved.slice(0, 4);
}

function buildRunSessionSummary(runState, outputText, command) {
  if (runState.status === "running") {
    return summarizeMessage(
      String(runState.summary || `Running ${command || "sandbox run"}`).trim(),
      180
    );
  }

  if (runState.status === "passed") {
    return summarizeSessionResultLine(
      outputText,
      runState.summary || `${command || "Run"} passed.`,
      180
    );
  }

  if (runState.status === "failed") {
    return summarizeSessionResultLine(
      outputText,
      runState.summary || `${command || "Run"} failed.`,
      180
    );
  }

  return summarizeSessionResultLine(outputText, runState.summary, 180);
}

function buildPreviewSessionSummary(previewState, previewOutputText, command) {
  if (previewState.status === "starting") {
    return summarizeMessage(
      String(previewState.summary || `Starting ${command || "preview server"}`).trim(),
      180
    );
  }

  if (previewState.status === "ready") {
    return summarizeMessage(
      String(previewState.summary || "Preview live.").trim(),
      180
    );
  }

  if (previewState.status === "failed") {
    return summarizeSessionResultLine(
      previewOutputText,
      previewState.summary || "Preview failed.",
      180
    );
  }

  if (previewState.status === "stopped") {
    return summarizeMessage(String(previewState.summary || "Preview stopped.").trim(), 180);
  }

  return summarizeSessionResultLine(previewOutputText, previewState.summary, 180);
}

function normalizeTargetPath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function findBestMatchingFilePath(candidatePath, files = []) {
  const normalizedCandidate = normalizeTargetPath(candidatePath).toLowerCase();
  if (!normalizedCandidate) {
    return "";
  }

  const normalizedFiles = files.map((entry) => ({
    ...entry,
    normalizedPath: normalizeTargetPath(entry.path).toLowerCase(),
  }));

  const exactMatch = normalizedFiles.find(
    (entry) => entry.normalizedPath === normalizedCandidate
  );
  if (exactMatch) {
    return exactMatch.path;
  }

  const slashAwareMatches = normalizedFiles.filter(
    (entry) =>
      entry.normalizedPath === normalizedCandidate ||
      entry.normalizedPath.endsWith(`/${normalizedCandidate}`)
  );
  if (slashAwareMatches.length === 1) {
    return slashAwareMatches[0].path;
  }
  if (slashAwareMatches.length > 1) {
    return slashAwareMatches
      .slice()
      .sort((left, right) => left.normalizedPath.length - right.normalizedPath.length)[0].path;
  }

  const basename = normalizedCandidate.split("/").pop();
  if (!basename) {
    return "";
  }

  const basenameMatches = normalizedFiles.filter((entry) =>
    entry.normalizedPath.endsWith(`/${basename}`) || entry.normalizedPath === basename
  );
  if (basenameMatches.length === 1) {
    return basenameMatches[0].path;
  }

  return "";
}

function makeStatusBadge(runState) {
  if (runState.status === "running") return "Running";
  if (runState.status === "passed") return "Passed";
  if (runState.status === "failed") return "Failed";
  return "Idle";
}

function makeStatusTone(runState) {
  if (runState.status === "running") return "bg-cyan-300/12 text-cyan-100";
  if (runState.status === "passed") return "bg-emerald-300/12 text-emerald-100";
  if (runState.status === "failed") return "bg-rose-300/12 text-rose-100";
  return "";
}

function makePreviewBadge(previewState) {
  if (previewState.status === "starting") return "Starting preview";
  if (previewState.status === "ready") return "Preview live";
  if (previewState.status === "stopped") return "Preview stopped";
  if (previewState.status === "failed") return "Preview failed";
  return "Preview idle";
}

function makePreviewTone(previewState) {
  if (previewState.status === "starting") return "bg-cyan-300/12 text-cyan-100";
  if (previewState.status === "ready") return "bg-emerald-300/12 text-emerald-100";
  if (previewState.status === "stopped") return "bg-slate-300/12 text-slate-100";
  if (previewState.status === "failed") return "bg-rose-300/12 text-rose-100";
  return "";
}

function makeSaveBadge(saveState) {
  if (saveState.status === "saving") return "Saving";
  if (saveState.status === "saved") return "Saved to repo";
  if (saveState.status === "failed") return "Save failed";
  return "Not saved";
}

function makeSaveTone(saveState) {
  if (saveState.status === "saving") return "bg-cyan-300/12 text-cyan-100";
  if (saveState.status === "saved") return "bg-emerald-300/12 text-emerald-100";
  if (saveState.status === "failed") return "bg-rose-300/12 text-rose-100";
  return "";
}

function getReviewStage(runState, previewState) {
  if (runState?.status === "failed" || previewState?.status === "failed") return "debug";
  if (runState?.status === "passed" || previewState?.status === "ready") return "verification";
  return "review";
}

function normalizeReviewList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeAIReviewResponse(raw) {
  const fallback = {
    mode: "review",
    verdict: "needs_manual_check",
    headline: "AI review returned an unstructured reply.",
    rootCause: "",
    recommendedAction: "",
    checks: [],
    risks: [],
    suggestedDraft: "",
    rawText: String(raw || "").trim(),
  };

  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  return {
    mode: String(parsed.mode || fallback.mode).trim() || fallback.mode,
    verdict:
      String(parsed.verdict || fallback.verdict).trim() || fallback.verdict,
    headline:
      String(parsed.headline || parsed.summary || fallback.headline).trim() ||
      fallback.headline,
    rootCause: String(parsed.rootCause || "").trim(),
    recommendedAction: String(
      parsed.recommendedAction || parsed.bestNextFix || ""
    ).trim(),
    checks: normalizeReviewList(parsed.checks || parsed.testsToRun),
    risks: normalizeReviewList(parsed.risks || parsed.edgeCases),
    suggestedDraft: String(parsed.suggestedDraft || parsed.suggestedCode || "").trim(),
    rawText: String(raw || "").trim(),
  };
}

function buildReviewPrompt({
  config,
  sourceMessage,
  originalCode,
  draftCode,
  runState,
  previewState,
  output,
}) {
  const stage = getReviewStage(runState, previewState);

  return `You are reviewing a repo-backed debug session inside HiveMind.

Runtime: ${config.runtime}
Repo: ${config.repoLabel || config.linkedProjectPath || "unknown repo"}
Branch: ${config.defaultBranch || "main"}
Target file: ${config.targetFilePath || "not set"}
Run command: ${getSandboxRunCommand(config) || "not set"}
Preview command: ${getSandboxPreviewCommand(config, config.previewPort, {
    sourceCode: draftCode,
    targetFilePath: config.targetFilePath,
  }) || "not set"}
Review stage: ${stage}
Run status: ${runState?.status || "idle"}
Preview status: ${previewState?.status || "idle"}

Source message:
${sourceMessage ? `${sourceMessage.sender || "Teammate"}: ${sourceMessage.text || ""}` : "No source message selected."}

Original code:
\`\`\`
${String(originalCode || "").trim()}
\`\`\`

Current draft:
\`\`\`
${String(draftCode || "").trim()}
\`\`\`

Latest output:
\`\`\`
${String(output || "").trim()}
\`\`\`

Return ONLY valid JSON with this shape:
{
  "mode": "debug" | "verification" | "review",
  "verdict": "apply_fix" | "looks_good" | "needs_manual_check",
  "headline": "one short sentence",
  "rootCause": "short explanation",
  "recommendedAction": "single best next action",
  "checks": ["up to 3 concrete checks"],
  "risks": ["up to 3 concrete risks"],
  "suggestedDraft": "full corrected file contents, or empty string if no code change is needed"
}

Rules:
- If the latest run/preview failed, diagnose the likely file-level issue and give a concrete fix.
- For a failed run, suggestedDraft should contain the FULL corrected file contents whenever the bug is reasonably fixable within the current file. Leave it empty only if you truly cannot produce a safe fix.
- If the latest run passed or preview is ready, do NOT invent a bug. Treat this as a save-readiness review. Focus on whether the draft looks safe, what should still be manually checked, and leave suggestedDraft empty unless you found a real remaining issue.
- Keep fields concise and practical.
- Output JSON only, with no markdown fences.`;
}

function getVerificationLabel(runState, previewState) {
  if (previewState.status === "ready") return "Live preview verified";
  if (runState.status === "passed") return "Run verified";
  return "Verified result";
}

function buildVerifiedRoomUpdateText({
  config,
  sourceMessage,
  runState,
  previewState,
  saveState,
}) {
  const targetFile = config?.targetFilePath || "the active file";
  const command =
    previewState.status === "ready"
      ? previewState.command || getSandboxPreviewCommand(config, config?.previewPort)
      : getSandboxRunCommand(config);
  const lines = [`Verified fix for ${targetFile}`];

  lines.push(`${getVerificationLabel(runState, previewState)}${command ? ` with ${command}` : ""}.`);

  if (saveState.status === "saved") {
    lines.push("Saved to the linked repo.");
  }

  const summary = previewState.summary || runState.summary || "";
  if (summary) {
    lines.push(summary);
  }

  if (sourceMessage?.text) {
    lines.push("");
    lines.push(`Source: ${sourceMessage.sender || "Teammate"} reported ${summarizeMessage(sourceMessage.text, 144)}`);
  }

  return lines.filter(Boolean).join("\n");
}

function buildVerifiedDecisionText({
  config,
  sourceMessage,
  runState,
  previewState,
  saveState,
  draftCode,
  latestOutput,
}) {
  const verification = getVerificationLabel(runState, previewState);
  const command =
    previewState.status === "ready"
      ? previewState.command || getSandboxPreviewCommand(config, config?.previewPort)
      : getSandboxRunCommand(config);

  const lines = [
    "Verified sandbox result",
    `Repo: ${config?.repoLabel || config?.linkedProjectPath || "Linked project"}`,
    `Branch: ${config?.defaultBranch || "main"}`,
    `Target file: ${config?.targetFilePath || "not set"}`,
    `Verification: ${verification}`,
  ];

  if (command) {
    lines.push(`Command: ${command}`);
  }

  if (saveState.status === "saved") {
    lines.push("Repo sync: saved to linked repo");
  }

  if (sourceMessage?.text) {
    lines.push("");
    lines.push("Original report:");
    lines.push(`${sourceMessage.sender || "Teammate"}: ${String(sourceMessage.text || "").trim()}`);
  }

  if (previewState.summary || runState.summary) {
    lines.push("");
    lines.push("Verification outcome:");
    lines.push(String(previewState.summary || runState.summary || "").trim());
  }

  if (latestOutput) {
    lines.push("");
    lines.push("Output:");
    lines.push(String(latestOutput).trim());
  }

  if (draftCode) {
    lines.push("");
    lines.push("Verified draft:");
    lines.push("```");
    lines.push(String(draftCode).trim());
    lines.push("```");
  }

  return lines.filter(Boolean).join("\n");
}

export default function DeveloperSandboxWorkspace(props) {
  return <DeveloperSandboxWorkspaceInner {...props} />;
}

function DeveloperSandboxWorkspaceInner({
  hiveID,
  honeycombID,
  sandboxConfig = DEFAULT_SANDBOX_CONFIG,
  codeAwareMessages = [],
  roomMessages = [],
  roomTasks = [],
  roomDecisions = [],
  currentUserId = "",
  currentUserName = "",
  currentUserEmail = "",
  currentUserPhotoURL = "",
  roomMembers = [],
  canChat = true,
  canManageSettings = false,
  unreadMessageCount = 0,
  requestedSourceId = "",
  requestedTargetFilePath = "",
  onRequestedSandboxHandled,
  onJumpToChat,
  onOpenThread,
  onSendRoomMessage,
  onPostRoomUpdate,
  onSaveSettings,
  onCreateTask,
  onLogDecisionRequest,
  onOpenTasksTab,
  onOpenDecisionsTab,
  onLayoutModeChange,
}) {
  const config = useMemo(() => normalizeSandboxConfig(sandboxConfig), [sandboxConfig]);
  const [layoutMode, setLayoutMode] = useState("split");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReview, setAiReview] = useState(null);
  const [fileSearch, setFileSearch] = useState("");
  const [availableFiles, setAvailableFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [relatedFilesLoading, setRelatedFilesLoading] = useState(false);
  const [chatToast, setChatToast] = useState(null);
  const [splitChatMessage, setSplitChatMessage] = useState("");
  const [splitChatSending, setSplitChatSending] = useState(false);
  const [workflowTrayDismissed, setWorkflowTrayDismissed] = useState(false);
  const [workflowRoomPostState, setWorkflowRoomPostState] = useState("idle");
  const [originalCode, setOriginalCode] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [sharedSession, setSharedSession] = useState(null);
  const [sessionPresence, setSessionPresence] = useState({});
  const [sessionNoteDraft, setSessionNoteDraft] = useState("");
  const [sessionActionState, setSessionActionState] = useState("idle");
  const [language, setLanguage] = useState(config.runtime === "python" ? "python" : "jsx");
  const [consolePanelTab, setConsolePanelTab] = useState("output");
  const [fileStatus, setFileStatus] = useState({ loading: false, error: "", mode: "snippet" });
  const [saveState, setSaveState] = useState({
    status: "idle",
    summary: "",
    savedAt: null,
  });
  const [editorExternalChangeKey, setEditorExternalChangeKey] = useState(0);
  const [activeTargetFilePath, setActiveTargetFilePath] = useState(config.targetFilePath || "");
  const [runState, setRunState] = useState({
    status: "idle",
    attempt: 0,
    lines: [],
    sessionId: "",
    exitCode: null,
    summary: "",
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState({
    status: "idle",
    sessionId: "",
    lines: [],
    summary: "",
    previewUrl: "",
    previewPort: null,
    command: "",
  });

  const eventSourceRef = useRef(null);
  const previewEventSourceRef = useRef(null);
  const lastSeenRoomMessageIdRef = useRef("");
  const latestSharedSessionRef = useRef(null);
  const lastLoadedFileKeyRef = useRef("");
  const latestDraftCodeRef = useRef("");
  const lastCollabSeedKeyRef = useRef("");
  const messages = Array.isArray(codeAwareMessages) ? codeAwareMessages : [];
  const liveRoomMessages = Array.isArray(roomMessages) ? roomMessages : [];
  const memberDirectory = Array.isArray(roomMembers) ? roomMembers : [];
  const memberDirectoryMap = useMemo(
    () =>
      memberDirectory.reduce((accumulator, member) => {
        const uid = String(member?.uid || "").trim();
        if (uid) {
          accumulator[uid] = member;
        }
        return accumulator;
      }, {}),
    [memberDirectory]
  );
  const activeConfig = useMemo(
    () =>
      normalizeSandboxConfig({
        ...config,
        targetFilePath: activeTargetFilePath || config.targetFilePath,
      }),
    [activeTargetFilePath, config]
  );
  const sessionTargetFilePath = activeConfig.targetFilePath || "";
  const selectedSourceMessage =
    liveRoomMessages.find((entry) => String(entry.id) === String(selectedSourceId)) ||
    messages.find((entry) => String(entry.id) === String(selectedSourceId)) ||
    messages[0] ||
    liveRoomMessages.find((entry) => entry?.senderId !== "AI") ||
    liveRoomMessages[0] ||
    null;
  const outputText = runState.lines.map((line) => line.text).join("");
  const previewOutputText = previewState.lines.map((line) => line.text).join("");
  const runCommand = getSandboxRunCommand(activeConfig);
  const previewSupported = canUseSandboxPreview(
    activeConfig,
    draftCode,
    activeConfig.targetFilePath
  );
  const previewCommand = getSandboxPreviewCommand(activeConfig, activeConfig.previewPort, {
    sourceCode: draftCode,
    targetFilePath: activeConfig.targetFilePath,
  });
  const sessionRunSummary = useMemo(
    () => buildRunSessionSummary(runState, outputText, runCommand),
    [outputText, runCommand, runState]
  );
  const sessionPreviewSummary = useMemo(
    () => buildPreviewSessionSummary(previewState, previewOutputText, previewCommand),
    [previewCommand, previewOutputText, previewState]
  );
  const verificationReady =
    runState.status === "passed" || previewState.status === "ready";
  const hasTargetFile = Boolean(activeConfig.linkedProjectPath && activeConfig.targetFilePath);
  const needsSetup =
    !activeConfig.enabled || !activeConfig.linkedProjectPath || !activeConfig.targetFilePath;
  const filteredFiles = useMemo(() => {
    const query = String(fileSearch || "").trim().toLowerCase();
    if (!query) return availableFiles;
    return availableFiles.filter((entry) =>
      String(entry.path || "")
        .toLowerCase()
        .includes(query)
    );
  }, [availableFiles, fileSearch]);
  const relatedDebugFiles = useMemo(
    () =>
      resolveRelatedDebugFiles({
        outputText: outputText || previewOutputText,
        summaryText: previewState.summary || runState.summary || "",
        files: availableFiles,
        currentTargetFilePath: sessionTargetFilePath,
      }),
    [
      availableFiles,
      outputText,
      previewOutputText,
      previewState.summary,
      runState.summary,
      sessionTargetFilePath,
    ]
  );
  const shouldSuggestRelatedFiles =
    runState.status === "failed" || previewState.status === "failed";
  const activeSessionOwnerId = String(sharedSession?.ownerUserId || "").trim();
  const currentUserLabel = String(currentUserName || currentUserEmail || currentUserId || "Teammate").trim();
  const isOwnedByCurrentUser = Boolean(
    currentUserId && activeSessionOwnerId && activeSessionOwnerId === String(currentUserId)
  );
  const sessionAvailable = Boolean(
    hiveID && honeycombID && activeConfig.enabled && sessionTargetFilePath
  );
  const collaborativeEditingEnabled = false;
  const sessionOwnerIsPresent = Boolean(
    activeSessionOwnerId &&
      Object.values(sessionPresence || {}).some(
        (entry) => String(entry?.uid || "").trim() === activeSessionOwnerId
      )
  );
  const canControlSharedSession =
    !activeSessionOwnerId || isOwnedByCurrentUser || !sessionOwnerIsPresent;
  const canRun = Boolean(
    activeConfig.enabled &&
      hasTargetFile &&
      canControlSharedSession &&
      draftCode.trim() &&
      runCommand.trim()
  );
  const canPreview = Boolean(
      activeConfig.enabled &&
      previewSupported &&
      hasTargetFile &&
      canControlSharedSession &&
      draftCode.trim() &&
      previewCommand.trim()
  );
  const canSaveToRepo = Boolean(
      activeConfig.enabled &&
      hasTargetFile &&
      fileStatus.mode === "repo" &&
      canControlSharedSession &&
      draftCode.trim() &&
      (runState.status === "passed" || previewState.status === "ready")
  );
  const shouldApplyDraftToTerminal = Boolean(
    activeConfig.targetFilePath &&
      fileStatus.mode === "repo"
  );
  const terminalPanelKey = [
    hiveID,
    honeycombID,
    activeConfig.executionMode,
    activeConfig.linkedProjectPath,
    activeConfig.runtime,
    activeConfig.dockerImage,
    activeConfig.targetFilePath,
  ]
    .map((entry) => String(entry || "").trim())
    .join("::");
  const shouldSyncSessionStatus =
    ["passed", "failed"].includes(runState.status) ||
    ["ready", "stopped", "failed"].includes(previewState.status) ||
    ["saved", "failed"].includes(saveState.status);
  const sessionPresenceList = useMemo(
    () =>
      Object.values(sessionPresence || {})
        .filter(Boolean)
        .map((entry) => {
          const member = memberDirectoryMap[String(entry?.uid || "").trim()] || {};
          return {
            ...entry,
            displayName:
              entry?.displayName ||
              member?.displayName ||
              member?.email ||
              entry?.email ||
              entry?.uid ||
              "Teammate",
          };
        })
        .sort((left, right) =>
          String(left?.displayName || left?.email || left?.uid || "").localeCompare(
            String(right?.displayName || right?.email || right?.uid || "")
          )
        ),
    [memberDirectoryMap, sessionPresence]
  );
  const visiblePresenceList = useMemo(() => {
    const deduped = new Map();

    sessionPresenceList.forEach((entry) => {
      const key = String(entry?.uid || entry?.email || entry?.displayName || "").trim();
      if (!key) {
        return;
      }
      deduped.set(key, entry);
    });

    if (currentUserId || currentUserName || currentUserEmail) {
      const selfKey = String(currentUserId || currentUserEmail || currentUserName).trim();
      if (selfKey && !deduped.has(selfKey)) {
        deduped.set(selfKey, {
          uid: currentUserId,
          email: currentUserEmail,
          photoURL: currentUserPhotoURL,
          displayName: currentUserLabel,
          state: "editing",
        });
      }
    }

    return Array.from(deduped.values());
  }, [
    currentUserEmail,
    currentUserId,
    currentUserLabel,
    currentUserName,
    currentUserPhotoURL,
    sessionPresenceList,
  ]);
  const recentRoomMessages = useMemo(
    () => [...liveRoomMessages].slice(-10).reverse(),
    [liveRoomMessages]
  );
  const activeOtherPresenceCount = useMemo(
    () =>
      visiblePresenceList.filter(
        (entry) => String(entry?.uid || "").trim() !== String(currentUserId || "").trim()
      ).length,
    [currentUserId, visiblePresenceList]
  );
  const linkedTask = useMemo(
    () =>
      Array.isArray(roomTasks)
        ? roomTasks.find(
            (task) =>
              String(task?.source?.honeycombID || "") === String(honeycombID) &&
              String(task?.source?.messageID || "") === String(selectedSourceMessage?.id || "")
          ) || null
        : null,
    [honeycombID, roomTasks, selectedSourceMessage]
  );
  const linkedDecision = useMemo(
    () =>
      Array.isArray(roomDecisions)
        ? roomDecisions.find(
            (record) =>
              String(record?.source?.honeycombID || record?.honeycombID || "") ===
                String(honeycombID) &&
              String(record?.source?.parentMessageID || record?.parentMessageID || "") ===
                String(selectedSourceMessage?.id || "")
          ) || null
        : null,
    [honeycombID, roomDecisions, selectedSourceMessage]
  );
  const verifiedTaskAttachment = useMemo(
    () =>
      buildSandboxTaskAttachment({
        config: activeConfig,
        sourceMessage: selectedSourceMessage,
        latestOutput: outputText || previewOutputText,
        draftCode,
        verification:
          previewState.status === "ready" ? "repo-backed live preview verified" : "repo-backed run passed",
      }),
    [
      activeConfig,
      draftCode,
      outputText,
      previewOutputText,
      previewState.status,
      selectedSourceMessage,
    ]
  );
  const verifiedRoomUpdateText = useMemo(
    () =>
      buildVerifiedRoomUpdateText({
        config: activeConfig,
        sourceMessage: selectedSourceMessage,
        runState,
        previewState,
        saveState,
      }),
    [activeConfig, previewState, runState, saveState, selectedSourceMessage]
  );
  const verifiedDecisionText = useMemo(
    () =>
      buildVerifiedDecisionText({
        config: activeConfig,
        sourceMessage: selectedSourceMessage,
        runState,
        previewState,
        saveState,
        draftCode,
        latestOutput: outputText || previewOutputText,
      }),
    [
      activeConfig,
      draftCode,
      outputText,
      previewOutputText,
      previewState,
      runState,
      saveState,
      selectedSourceMessage,
    ]
  );

  const openRepoFile = (nextPath, options = {}) => {
    const normalizedPath = normalizeTargetPath(nextPath);
    if (!normalizedPath) {
      return;
    }

    setActiveTargetFilePath(normalizedPath);
    setFileStatus((current) => ({
      ...current,
      error: "",
    }));
    setWorkflowTrayDismissed(false);

    if (options.closePicker) {
      setFilePickerOpen(false);
    }
  };

  useEffect(() => {
    if (selectedSourceId) return;
    const fallbackSource =
      messages[0] ||
      liveRoomMessages.find((entry) => entry?.senderId !== "AI") ||
      liveRoomMessages[0] ||
      null;
    if (!fallbackSource?.id) {
      return;
    }
    setSelectedSourceId(String(fallbackSource.id));
  }, [liveRoomMessages, messages, selectedSourceId]);

  useEffect(() => {
    if (!requestedSourceId && !requestedTargetFilePath) {
      return;
    }

    let active = true;

    async function applySandboxLaunchRequest() {
      if (requestedSourceId) {
        setSelectedSourceId(String(requestedSourceId));
      }

      if (requestedTargetFilePath && !activeConfig.linkedProjectPath) {
        setActiveTargetFilePath(normalizeTargetPath(requestedTargetFilePath));
      }

      if (requestedTargetFilePath && activeConfig.linkedProjectPath) {
        try {
          const payload = await listSandboxFiles({
            hiveID,
            honeycombID,
            linkedProjectPath: activeConfig.linkedProjectPath,
            allowedPaths: activeConfig.allowedPaths,
          });
          if (!active) {
            return;
          }

          const files = Array.isArray(payload.files) ? payload.files : [];
          const resolvedTargetPath =
            findBestMatchingFilePath(requestedTargetFilePath, files) ||
            normalizeTargetPath(requestedTargetFilePath);

          if (resolvedTargetPath) {
            setActiveTargetFilePath(resolvedTargetPath);
            setAvailableFiles(files);
            setFileStatus((current) => ({
              ...current,
              error: "",
            }));
          }
        } catch (error) {
          if (!active) {
            return;
          }

          console.error("Sandbox launch target resolution failed:", error);
          setFileStatus((current) => ({
            ...current,
            error: String(error?.message || "Could not resolve the requested repo file."),
          }));
        }
      }

      if (active) {
        onRequestedSandboxHandled?.();
      }
    }

    void applySandboxLaunchRequest();

    return () => {
      active = false;
    };
  }, [
    activeConfig.allowedPaths,
    activeConfig.linkedProjectPath,
    hiveID,
    honeycombID,
    onRequestedSandboxHandled,
    requestedSourceId,
    requestedTargetFilePath,
  ]);

  useEffect(() => {
    setActiveTargetFilePath(config.targetFilePath || "");
  }, [config.targetFilePath]);

  useEffect(() => {
    setSaveState({
      status: "idle",
      summary: "",
      savedAt: null,
    });
  }, [activeTargetFilePath]);

  useEffect(() => {
    const block = getFirstCodeBlock(selectedSourceMessage?.text || "");
    if (!block || fileStatus.mode === "repo") return;

    setOriginalCode(block.code);
    setDraftCode(block.code);
    setLanguage(block.language || language);
  }, [fileStatus.mode, language, selectedSourceMessage]);

  useEffect(() => {
    setSaveState((current) => {
      if (current.status === "saving") {
        return current;
      }

      if (draftCode === originalCode) {
        return current;
      }

      if (current.status === "saved" || current.status === "failed") {
        return {
          status: "idle",
          summary: "",
          savedAt: null,
        };
      }

      return current;
    });
  }, [draftCode, originalCode]);

  useEffect(() => {
    setWorkflowTrayDismissed(false);
    setWorkflowRoomPostState("idle");
  }, [activeTargetFilePath, selectedSourceId, draftCode, runState.attempt, previewState.sessionId]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      previewEventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    onLayoutModeChange?.(layoutMode);
  }, [layoutMode, onLayoutModeChange]);

  useEffect(() => {
    latestSharedSessionRef.current = sharedSession;
  }, [sharedSession]);

  useEffect(() => {
    latestDraftCodeRef.current = draftCode;
  }, [draftCode]);

  useEffect(() => {
    if (!sessionAvailable) {
      setSharedSession(null);
      setSessionNoteDraft("");
      return undefined;
    }

    return subscribeToSandboxSession(
      {
        hiveID,
        honeycombID,
        targetFilePath: sessionTargetFilePath,
      },
      (nextSession) => {
        setSharedSession(nextSession);
        setSessionNoteDraft(String(nextSession?.handoffNote || ""));

        if (collaborativeEditingEnabled) {
          return;
        }

        const remoteDraft = String(nextSession?.draftCode || "");
        const remoteOwnerId = String(nextSession?.ownerUserId || "");
        const remoteIsCurrentUser =
          remoteOwnerId && remoteOwnerId === String(currentUserId || "");
        const localHasUnsavedDraft =
          String(latestSharedSessionRef.current?.draftCode || "") !==
          String(latestDraftCodeRef.current || "");

        if (!remoteDraft || remoteDraft === String(latestDraftCodeRef.current || "")) {
          return;
        }

        if (remoteIsCurrentUser && localHasUnsavedDraft) {
          return;
        }

        if (!remoteIsCurrentUser || !localHasUnsavedDraft) {
          setDraftCode(remoteDraft);
        }
      }
    );
  }, [
    collaborativeEditingEnabled,
    currentUserId,
    hiveID,
    honeycombID,
    sessionAvailable,
    sessionTargetFilePath,
  ]);

  useEffect(() => {
    if (!sessionAvailable) {
      setSessionPresence({});
      return undefined;
    }

    return subscribeToSandboxPresence(
      {
        hiveID,
        honeycombID,
        targetFilePath: sessionTargetFilePath,
      },
      (nextPresence) => {
        setSessionPresence(nextPresence || {});
      }
    );
  }, [hiveID, honeycombID, sessionAvailable, sessionTargetFilePath]);

  useEffect(() => {
    if (!sessionAvailable || !currentUserId) {
      return undefined;
    }

    return syncSandboxPresence({
      hiveID,
      honeycombID,
      targetFilePath: sessionTargetFilePath,
      user: {
        uid: currentUserId,
        displayName: currentUserName,
        email: currentUserEmail,
        photoURL: currentUserPhotoURL,
      },
      state: "editing",
      layoutMode,
    });
  }, [
    currentUserEmail,
    currentUserId,
    currentUserName,
    currentUserPhotoURL,
    hiveID,
    honeycombID,
    layoutMode,
    sessionAvailable,
    sessionTargetFilePath,
  ]);

  useEffect(() => {
    if (
      !sessionAvailable ||
      !canControlSharedSession ||
      fileStatus.mode !== "repo" ||
      !draftCode.trim() ||
      !currentUserId
    ) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      upsertSandboxSession({
        hiveID,
        honeycombID,
        targetFilePath: sessionTargetFilePath,
        runtime: activeConfig.runtime,
        repoLabel: activeConfig.repoLabel,
        defaultBranch: activeConfig.defaultBranch,
        sourceMessageID: selectedSourceMessage?.id || "",
        sourceMessageText: selectedSourceMessage?.text || "",
        language,
        draftCode,
        ownerUserId: currentUserId,
        ownerDisplayName: currentUserLabel,
        ownerEmail: currentUserEmail,
        status: "in_progress",
        handoffNote: sessionNoteDraft,
        lastEditedByUserId: currentUserId,
        lastEditedByDisplayName: currentUserLabel,
      }).catch((error) => {
        console.error("Sandbox session autosave failed:", error);
      });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeConfig.defaultBranch,
    activeConfig.repoLabel,
    activeConfig.runtime,
    canControlSharedSession,
    currentUserEmail,
    currentUserId,
    currentUserLabel,
    draftCode,
    fileStatus.mode,
    hiveID,
    honeycombID,
    language,
    selectedSourceMessage,
    sessionAvailable,
    sessionNoteDraft,
    sessionTargetFilePath,
  ]);

  useEffect(() => {
    if (!sessionAvailable || !shouldSyncSessionStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      upsertSandboxSession({
        hiveID,
        honeycombID,
        targetFilePath: sessionTargetFilePath,
        runtime: activeConfig.runtime,
        repoLabel: activeConfig.repoLabel,
        defaultBranch: activeConfig.defaultBranch,
        sourceMessageID: selectedSourceMessage?.id || "",
        sourceMessageText: selectedSourceMessage?.text || "",
        language,
        draftCode,
        ownerUserId: canControlSharedSession ? currentUserId : activeSessionOwnerId,
        ownerDisplayName: canControlSharedSession
          ? currentUserLabel
          : String(sharedSession?.ownerDisplayName || ""),
        ownerEmail: canControlSharedSession
          ? currentUserEmail
          : String(sharedSession?.ownerEmail || ""),
        status:
          previewState.status === "ready" || runState.status === "passed"
            ? "verified"
            : String(sharedSession?.status || "in_progress"),
        handoffNote: sessionNoteDraft,
        lastEditedByUserId: currentUserId || String(sharedSession?.lastEditedByUserId || ""),
        lastEditedByDisplayName:
          currentUserLabel || String(sharedSession?.lastEditedByDisplayName || ""),
        runStatus: runState.status,
        runSummary: sessionRunSummary,
        previewStatus: previewState.status,
        previewSummary: sessionPreviewSummary,
        previewUrl: previewState.previewUrl,
        saveStatus: saveState.status,
        saveSummary: saveState.summary,
        savedByUserId: saveState.status === "saved" ? currentUserId : "",
        savedByDisplayName: saveState.status === "saved" ? currentUserLabel : "",
      }).catch((error) => {
        console.error("Sandbox session status sync failed:", error);
      });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeConfig.defaultBranch,
    activeConfig.repoLabel,
    activeConfig.runtime,
    activeSessionOwnerId,
    canControlSharedSession,
    currentUserEmail,
    currentUserId,
    currentUserLabel,
    hiveID,
    honeycombID,
    language,
    previewState.previewUrl,
    previewState.status,
    runState.status,
    saveState.status,
    saveState.summary,
    selectedSourceMessage,
    sessionPreviewSummary,
    sessionRunSummary,
    sessionAvailable,
    sessionNoteDraft,
    sessionTargetFilePath,
    shouldSyncSessionStatus,
    sharedSession?.lastEditedByDisplayName,
    sharedSession?.lastEditedByUserId,
    sharedSession?.ownerDisplayName,
    sharedSession?.ownerEmail,
    sharedSession?.status,
  ]);

  useEffect(() => {
    if (!liveRoomMessages.length) {
      return;
    }

    const latestMessage = liveRoomMessages[liveRoomMessages.length - 1];
    const latestId = String(latestMessage?.id || "");
    if (!latestId) {
      return;
    }

    if (!lastSeenRoomMessageIdRef.current) {
      lastSeenRoomMessageIdRef.current = latestId;
      return;
    }

    if (lastSeenRoomMessageIdRef.current === latestId) {
      return;
    }

    lastSeenRoomMessageIdRef.current = latestId;

    const senderId = String(
      latestMessage?.senderId || latestMessage?.uid || latestMessage?.createdBy || ""
    );
    if (currentUserId && senderId === String(currentUserId)) {
      return;
    }

    setChatToast({
      id: latestId,
      sender: latestMessage?.sender || "Teammate",
      text: summarizeMessage(latestMessage?.text || "New message in the room.", 108),
    });
  }, [currentUserId, liveRoomMessages]);

  useEffect(() => {
    if (!chatToast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setChatToast(null);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [chatToast]);

  useEffect(() => {
    if (!hasTargetFile || !activeConfig.enabled || !honeycombID) return;

    const controller = new AbortController();
    const fileKey = `${hiveID}::${honeycombID}::${activeConfig.linkedProjectPath}::${activeConfig.targetFilePath}`;

    if (
      lastLoadedFileKeyRef.current === fileKey &&
      fileStatus.mode === "repo" &&
      !fileStatus.loading &&
      !fileStatus.error
    ) {
      return () => {
        controller.abort();
      };
    }

    async function loadLinkedFile() {
      try {
        setFileStatus((current) => ({
          loading: true,
          error: "",
          mode: current?.mode === "repo" ? "repo" : "loading",
        }));
        const payload = await loadSandboxFile({
          hiveID,
          honeycombID,
          linkedProjectPath: activeConfig.linkedProjectPath,
          targetFilePath: activeConfig.targetFilePath,
          signal: controller.signal,
        });

        const nextContent = String(payload.content || "");
        const resumedDraft = String(latestSharedSessionRef.current?.draftCode || "");
        setOriginalCode(nextContent);
        setDraftCode(resumedDraft || nextContent);
        setLanguage(String(payload.language || language));
        setFileStatus({ loading: false, error: "", mode: "repo" });
        lastLoadedFileKeyRef.current = fileKey;
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Sandbox file load failed:", error);
        const block = getFirstCodeBlock(selectedSourceMessage?.text || "");
        if (block) {
          setOriginalCode(block.code);
          setDraftCode(block.code);
          setLanguage(block.language || language);
          setFileStatus({
            loading: false,
            error: String(error?.message || "Using the source snippet fallback."),
            mode: "snippet",
          });
          return;
        }

        setFileStatus({
          loading: false,
          error: String(error?.message || "Could not load the linked file."),
          mode: "snippet",
        });
      }
    }

    loadLinkedFile();

    return () => {
      controller.abort();
    };
  }, [
    activeConfig.enabled,
    activeConfig.linkedProjectPath,
    activeConfig.targetFilePath,
    hasTargetFile,
    hiveID,
    honeycombID,
    fileStatus.error,
    fileStatus.loading,
    fileStatus.mode,
    selectedSourceMessage?.id,
  ]);

  useEffect(() => {
    if (
      !collaborativeEditingEnabled ||
      !sessionTargetFilePath ||
      !originalCode ||
      sessionOwnerIsPresent ||
      activeOtherPresenceCount > 0
    ) {
      return;
    }

    const sharedDraft = String(sharedSession?.draftCode || "");
    const shouldRebaseToRepo =
      !sharedDraft ||
      sharedDraft === originalCode ||
      !String(sharedSession?.ownerUserId || "").trim();

    if (!shouldRebaseToRepo) {
      return;
    }

    const seedKey = `${hiveID}:${honeycombID}:${sessionTargetFilePath}:${originalCode}`;
    if (lastCollabSeedKeyRef.current === seedKey) {
      return;
    }

    lastCollabSeedKeyRef.current = seedKey;
    replaceSandboxCollabState({
      hiveID,
      honeycombID,
      targetFilePath: sessionTargetFilePath,
      text: originalCode,
      clientId: currentUserId || "repo-seed",
    }).catch((error) => {
      console.error("Sandbox repo seed failed:", error);
    });
  }, [
    activeOtherPresenceCount,
    collaborativeEditingEnabled,
    currentUserId,
    hiveID,
    honeycombID,
    originalCode,
    sessionOwnerIsPresent,
    sessionTargetFilePath,
    sharedSession?.draftCode,
    sharedSession?.ownerUserId,
  ]);

  const requestAIReview = async () => {
    try {
      setAiReviewOpen(true);
      setAiLoading(true);
      setAiReview(null);

      const reply = await callGeminiAPI(
         buildReviewPrompt({
            config: activeConfig,
            sourceMessage: selectedSourceMessage,
            originalCode,
            draftCode,
            runState,
            previewState,
            output: outputText || previewOutputText,
          }),
          "gemini-2.5-flash",
          [],
        {
          hiveID,
          honeycombID,
          scope: "message",
          feature: "sandbox_review",
        }
        );

        setAiReview(normalizeAIReviewResponse(reply || "No review returned."));
      } catch (error) {
        console.error("Sandbox AI review failed:", error);
        setAiReview(
          normalizeAIReviewResponse("AI review failed for this run.")
        );
      } finally {
        setAiLoading(false);
      }
  };

  const handleCreateTask = () => {
    if (!selectedSourceMessage) return;
    const currentDraft = getLatestDraftSnapshot();
    onCreateTask?.({
      sourceMessage: selectedSourceMessage,
      attachmentText: buildSandboxTaskAttachment({
        config: activeConfig,
        sourceMessage: selectedSourceMessage,
        latestOutput: outputText,
        draftCode: currentDraft,
        verification:
          runState.status === "passed" ? "repo-backed sandbox passed" : "sandbox draft in progress",
      }),
    });
  };

  const handleWorkflowTaskAction = () => {
    if (!selectedSourceMessage) return;
    if (linkedTask) {
      onOpenTasksTab?.();
      return;
    }

    onCreateTask?.({
      sourceMessage: selectedSourceMessage,
      attachmentText: verifiedTaskAttachment,
    });
  };

  const handleWorkflowDecisionAction = () => {
    if (!selectedSourceMessage) return;
    if (linkedDecision) {
      onOpenDecisionsTab?.();
      return;
    }

    onLogDecisionRequest?.({
      sourceMessage: selectedSourceMessage,
      summaryText: verifiedDecisionText,
    });
  };

  const handleWorkflowRoomPost = async () => {
    if (!selectedSourceMessage || workflowRoomPostState === "posting") {
      return;
    }

    try {
      setWorkflowRoomPostState("posting");
      const posted = await onPostRoomUpdate?.({
        sourceMessage: selectedSourceMessage,
        resultText: verifiedRoomUpdateText,
      });
      setWorkflowRoomPostState(posted === false ? "failed" : "posted");
    } catch (error) {
      console.error("Sandbox workflow room post failed:", error);
      setWorkflowRoomPostState("failed");
    }
  };

  const handleDraftChange = (nextValue) => {
    setDraftCode(nextValue);
  };

  const applyExternalDraft = (nextValue) => {
    setDraftCode(String(nextValue || ""));
    setEditorExternalChangeKey((current) => current + 1);
  };

  const getLatestDraftSnapshot = () => String(latestDraftCodeRef.current || draftCode || "");

  const handleTakeOverSession = async () => {
    if (!sessionAvailable || !currentUserId) {
      return;
    }

    const currentDraft = getLatestDraftSnapshot();

    try {
      setSessionActionState("taking_over");
      await upsertSandboxSession({
        hiveID,
        honeycombID,
        targetFilePath: sessionTargetFilePath,
        runtime: activeConfig.runtime,
        repoLabel: activeConfig.repoLabel,
        defaultBranch: activeConfig.defaultBranch,
        sourceMessageID: selectedSourceMessage?.id || sharedSession?.sourceMessageID || "",
        sourceMessageText:
          selectedSourceMessage?.text || sharedSession?.sourceMessageText || "",
        language,
        draftCode: currentDraft,
        ownerUserId: currentUserId,
        ownerDisplayName: currentUserLabel,
        ownerEmail: currentUserEmail,
        status: "in_progress",
        handoffNote: sessionNoteDraft,
        lastEditedByUserId: currentUserId,
        lastEditedByDisplayName: currentUserLabel,
        runStatus: runState.status,
        runSummary: sessionRunSummary,
        previewStatus: previewState.status,
        previewSummary: sessionPreviewSummary,
        previewUrl: previewState.previewUrl,
        saveStatus: saveState.status,
        saveSummary: saveState.summary,
      });
    } catch (error) {
      console.error("Sandbox takeover failed:", error);
      alert("Could not take over this sandbox session right now.");
    } finally {
      setSessionActionState("idle");
    }
  };

  const handleHandOffSession = async () => {
    if (!sessionAvailable || !currentUserId) {
      return;
    }

    const currentDraft = getLatestDraftSnapshot();

    try {
      setSessionActionState("handing_off");
      await upsertSandboxSession({
        hiveID,
        honeycombID,
        targetFilePath: sessionTargetFilePath,
        runtime: activeConfig.runtime,
        repoLabel: activeConfig.repoLabel,
        defaultBranch: activeConfig.defaultBranch,
        sourceMessageID: selectedSourceMessage?.id || sharedSession?.sourceMessageID || "",
        sourceMessageText:
          selectedSourceMessage?.text || sharedSession?.sourceMessageText || "",
        language,
        draftCode: currentDraft,
        ownerUserId: "",
        ownerDisplayName: "",
        ownerEmail: "",
        status: "needs_help",
        handoffNote:
          String(sessionNoteDraft || "").trim() ||
          `Please continue ${sessionTargetFilePath || "this file"} from the current draft.`,
        lastEditedByUserId: currentUserId,
        lastEditedByDisplayName: currentUserLabel,
        runStatus: runState.status,
        runSummary: sessionRunSummary,
        previewStatus: previewState.status,
        previewSummary: sessionPreviewSummary,
        previewUrl: previewState.previewUrl,
        saveStatus: saveState.status,
        saveSummary: saveState.summary,
      });
    } catch (error) {
      console.error("Sandbox handoff failed:", error);
      alert("Could not hand off this sandbox session right now.");
    } finally {
      setSessionActionState("idle");
    }
  };

  const handleSplitChatSend = async (event) => {
    event?.preventDefault?.();
    const cleanedMessage = String(splitChatMessage || "").trim();
    if (!cleanedMessage || splitChatSending || !canChat) {
      return;
    }

    try {
      setSplitChatSending(true);
      const sent = await onSendRoomMessage?.(cleanedMessage);
      if (sent !== false) {
        setSplitChatMessage("");
      }
    } finally {
      setSplitChatSending(false);
    }
  };

  useEffect(() => {
    if (!filePickerOpen || !activeConfig.linkedProjectPath || !honeycombID) return;

    let active = true;

    async function loadFiles() {
      try {
        setFilesLoading(true);
        setFilesError("");
        const payload = await listSandboxFiles({
          hiveID,
          honeycombID,
          linkedProjectPath: activeConfig.linkedProjectPath,
          allowedPaths: activeConfig.allowedPaths,
        });
        if (!active) return;
        setAvailableFiles(Array.isArray(payload.files) ? payload.files : []);
      } catch (error) {
        if (!active) return;
        console.error("Sandbox file list failed:", error);
        setFilesError(String(error?.message || "Could not load project files."));
      } finally {
        if (active) {
          setFilesLoading(false);
        }
      }
    }

    loadFiles();

    return () => {
      active = false;
    };
  }, [activeConfig.allowedPaths, activeConfig.linkedProjectPath, filePickerOpen, hiveID, honeycombID]);

  useEffect(() => {
    if (
      !shouldSuggestRelatedFiles ||
      !activeConfig.linkedProjectPath ||
      !honeycombID ||
      availableFiles.length ||
      relatedFilesLoading
    ) {
      return;
    }

    let active = true;

    async function loadRelatedFiles() {
      try {
        setRelatedFilesLoading(true);
        const payload = await listSandboxFiles({
          hiveID,
          honeycombID,
          linkedProjectPath: activeConfig.linkedProjectPath,
          allowedPaths: activeConfig.allowedPaths,
        });

        if (!active) {
          return;
        }

        setAvailableFiles(Array.isArray(payload.files) ? payload.files : []);
      } catch (error) {
        if (!active) {
          return;
        }

        console.error("Sandbox related file lookup failed:", error);
      } finally {
        if (active) {
          setRelatedFilesLoading(false);
        }
      }
    }

    void loadRelatedFiles();

    return () => {
      active = false;
    };
  }, [
    activeConfig.allowedPaths,
    activeConfig.linkedProjectPath,
    availableFiles.length,
    hiveID,
    honeycombID,
    relatedFilesLoading,
    shouldSuggestRelatedFiles,
  ]);

  const openRunStream = (streamUrl) => {
    eventSourceRef.current?.close();

    const source = new EventSource(streamUrl);
    eventSourceRef.current = source;

    source.addEventListener("output", (event) => {
      const payload = JSON.parse(event.data);
      setRunState((current) => ({
        ...current,
        lines: [...current.lines, payload],
      }));
    });

    source.addEventListener("done", (event) => {
      const payload = JSON.parse(event.data);
      setRunState((current) => ({
        ...current,
        status: payload.success ? "passed" : "failed",
        exitCode: payload.exitCode,
        summary: payload.summary || "",
      }));
      source.close();
    });

    source.addEventListener("error", () => {
      setRunState((current) => {
        if (current.status !== "running") {
          return current;
        }

        return {
          ...current,
          status: "failed",
          summary:
            current.summary ||
            "The live run stream disconnected before the sandbox session finished.",
          lines: current.lines.length
            ? current.lines
            : [
                {
                  stream: "stderr",
                  text: "[HiveMind] The live run stream disconnected before the sandbox session finished.\n",
                },
              ],
        };
      });
      source.close();
    });
  };

  const openPreviewStream = (streamUrl) => {
    previewEventSourceRef.current?.close();

    const source = new EventSource(streamUrl);
    previewEventSourceRef.current = source;

    source.addEventListener("output", (event) => {
      const payload = JSON.parse(event.data);
      setPreviewState((current) => ({
        ...current,
        lines: [...current.lines, payload],
      }));
    });

    source.addEventListener("meta", (event) => {
      const payload = JSON.parse(event.data);
      setPreviewState((current) => ({
        ...current,
        command: payload.command || current.command,
        previewUrl: payload.previewUrl || current.previewUrl,
        previewPort: payload.previewPort || current.previewPort,
      }));
    });

    source.addEventListener("preview", (event) => {
      const payload = JSON.parse(event.data);
      setPreviewState((current) => ({
        ...current,
        status: "ready",
        previewUrl: payload.previewUrl || current.previewUrl,
        previewPort: payload.previewPort || current.previewPort,
        summary: payload.previewUrl
          ? `Preview live at ${payload.previewUrl}`
          : current.summary || "Preview is live.",
      }));
    });

    source.addEventListener("status", (event) => {
      const payload = JSON.parse(event.data);
      setPreviewState((current) => ({
        ...current,
        status: payload.status || current.status,
        summary: payload.summary || current.summary,
      }));
    });

    source.addEventListener("done", (event) => {
      const payload = JSON.parse(event.data);
      setPreviewState((current) => ({
        ...current,
        status: payload.status || (payload.success ? "stopped" : "failed"),
        summary: payload.summary || current.summary,
      }));
      source.close();
    });

    source.addEventListener("error", () => {
      setPreviewState((current) => {
        if (!["starting", "ready"].includes(current.status)) {
          return current;
        }

        return {
          ...current,
          status: "failed",
          summary:
            current.summary ||
            "The live preview stream disconnected before the sandbox session finished.",
          lines: current.lines.length
            ? current.lines
            : [
                {
                  stream: "stderr",
                  text: "[HiveMind] The live preview stream disconnected before the sandbox session finished.\n",
                },
              ],
        };
      });
      source.close();
    });
  };

  const handleRun = async () => {
    const currentDraft = getLatestDraftSnapshot();
    try {
      setConsolePanelTab("output");
      setRunState((current) => ({
        status: "running",
        attempt: current.attempt + 1,
        lines: [],
        sessionId: "",
        exitCode: null,
        summary: "",
      }));

      const payload = await startSandboxRun({
        hiveID,
        honeycombID,
        config: activeConfig,
        draftCode: currentDraft,
        language,
        sourceMessageID: selectedSourceMessage?.id || "",
      });

      setRunState((current) => ({
        ...current,
        sessionId: payload.sessionId,
        summary: `Running ${payload.command || runCommand}`,
      }));

      const streamUrl = await buildSandboxStreamUrl(payload.sessionId);
      openRunStream(streamUrl);
    } catch (error) {
      console.error("Sandbox run failed to start:", error);
      setRunState((current) => ({
        ...current,
        status: "failed",
        summary: String(error?.message || "Could not start the sandbox run."),
      }));
    }
  };

  const handleStopPreview = async (reason = "Preview stopped.") => {
    const activeSessionId = String(previewState.sessionId || "").trim();
    if (!activeSessionId) {
      setPreviewState((current) => ({
        ...current,
        status: "stopped",
        summary: reason,
      }));
      return;
    }

    try {
      previewEventSourceRef.current?.close();
      await stopSandboxPreview({
        hiveID,
        sessionId: activeSessionId,
        reason,
      });
    } catch (error) {
      console.error("Sandbox preview stop failed:", error);
    } finally {
      setPreviewState((current) => ({
        ...current,
        status: "stopped",
        summary: reason,
      }));
    }
  };

  const handleStartPreview = async ({ forceRestart = false } = {}) => {
    const currentDraft = getLatestDraftSnapshot();
    try {
      const hasActivePreview = ["starting", "ready"].includes(previewState.status);
      if (hasActivePreview && !forceRestart) {
        setPreviewOpen(true);
        return;
      }

      if (hasActivePreview && forceRestart) {
        await handleStopPreview("Preview restarting...");
      }

      setPreviewOpen(true);
      setPreviewState((current) => ({
        status: "starting",
        sessionId: "",
        lines: [],
        summary: "",
        previewUrl: "",
        previewPort: null,
        command: "",
      }));

      const payload = await startSandboxPreview({
        hiveID,
        honeycombID,
        config: activeConfig,
        draftCode: currentDraft,
        language,
        sourceMessageID: selectedSourceMessage?.id || "",
      });

      setPreviewState((current) => ({
        ...current,
        sessionId: payload.sessionId,
        command: payload.command || previewCommand,
        previewUrl: payload.previewUrl || current.previewUrl,
        previewPort: payload.previewPort || current.previewPort,
        summary: `Starting ${payload.command || previewCommand || "preview server"}`,
      }));

      const streamUrl = await buildSandboxStreamUrl(payload.sessionId, "preview");
      openPreviewStream(streamUrl);
    } catch (error) {
      console.error("Sandbox preview failed to start:", error);
      setPreviewState((current) => ({
        ...current,
        status: "failed",
        summary: String(error?.message || "Could not start the live preview."),
      }));
    }
  };

  const handlePreviewButton = async () => {
    await handleStartPreview();
  };

  const handleSaveToRepo = async () => {
    if (!canSaveToRepo) {
      return;
    }

    const currentDraft = getLatestDraftSnapshot();

    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Save the current draft back to ${activeConfig.targetFilePath}? This updates the linked repo file on disk.`
          );

    if (!confirmed) {
      return;
    }

    try {
      setSaveState({
        status: "saving",
        summary: "",
        savedAt: null,
      });

      const payload = await saveSandboxFile({
        hiveID,
        honeycombID,
        config: activeConfig,
        draftCode: currentDraft,
      });

      const savedAt = Number(payload?.savedAt || Date.now());
      setOriginalCode(currentDraft);
      setSaveState({
        status: "saved",
        summary: `Saved ${payload?.targetFilePath || activeConfig.targetFilePath} to the linked repo.`,
        savedAt,
      });
      if (collaborativeEditingEnabled && sessionTargetFilePath) {
        await replaceSandboxCollabState({
          hiveID,
          honeycombID,
          targetFilePath: sessionTargetFilePath,
          text: currentDraft,
          clientId: currentUserId || "repo-save",
        });
      }
    } catch (error) {
      console.error("Sandbox save failed:", error);
      setSaveState({
        status: "failed",
        summary: String(error?.message || "Could not save the linked repo file."),
        savedAt: null,
      });
    }
  };

  const splitLayout = layoutMode === "split";
  const editorHeight = splitLayout ? "42rem" : "calc(100vh - 24rem)";
  const outputHeight = splitLayout ? "15rem" : "19rem";
  const terminalHeight = layoutMode === "focus" ? "24rem" : splitLayout ? "18rem" : "20rem";

  return (
    <>
      <section className={`glass-panel overflow-hidden ${layoutMode === "focus" ? "min-h-[calc(100vh-14rem)]" : ""}`}>
        <div className={`chat-header gap-4 border-b border-white/10 pb-4 ${layoutMode === "focus" ? "items-start" : ""}`}>
          <div className="min-w-0 space-y-3">
            <div className="flex w-full max-w-full flex-wrap items-start gap-2">
              <span className="hero-chip">Developer sandbox</span>
              <span className={`status-pill ${makeStatusTone(runState)}`}>{makeStatusBadge(runState)}</span>
              {previewSupported ? (
                <span className={`status-pill ${makePreviewTone(previewState)}`}>
                  {makePreviewBadge(previewState)}
                </span>
              ) : null}
              {saveState.status !== "idle" ? (
                <span className={`status-pill ${makeSaveTone(saveState)}`}>
                  {makeSaveBadge(saveState)}
                </span>
              ) : null}
              <span className="status-pill">{activeConfig.repoLabel || "No repo linked yet"}</span>
              <span className="status-pill">{activeConfig.defaultBranch || "main"}</span>
              <span className="status-pill">{activeConfig.targetFilePath || "Pick a target file"}</span>
            </div>

            <div className="panel-subtitle max-w-3xl">
              Repo-backed debug sessions live here. Keep the room conversation nearby, run the
              real command, and hand verified fixes off to the task board.
            </div>

            {selectedSourceMessage ? (
              <div className="max-w-full rounded-[1.1rem] border border-violet-300/18 bg-violet-300/10 px-4 py-3 text-sm text-slate-100">
                <span className="text-[11px] uppercase tracking-[0.18em] text-violet-100/75">
                  Source message
                </span>
                <div className="mt-2 leading-6">
                  {selectedSourceMessage.sender || "Teammate"}:{" "}
                  {summarizeMessage(selectedSourceMessage.text || "", layoutMode === "focus" ? 180 : 120)}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className={`mt-5 grid gap-4 ${splitLayout ? "xl:grid-cols-[22rem_minmax(0,1fr)]" : ""}`}>
          {splitLayout ? (
            <aside className="space-y-4">
              <div className="hud-panel border border-white/10">
                <div className="chat-header items-start gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">
                      Live room activity
                    </div>
                    <div className="mt-2 text-sm text-slate-300/80">
                      New chat messages stay visible here while you keep debugging.
                    </div>
                  </div>
                </div>

                {canChat ? (
                  <form className="mt-4 space-y-3" onSubmit={handleSplitChatSend}>
                    <label className="block text-xs uppercase tracking-[0.16em] text-slate-300/60">
                      Quick reply
                    </label>
                    <textarea
                      className="input-shell min-h-[7rem] resize-none py-3 leading-6"
                      value={splitChatMessage}
                      onChange={(event) => setSplitChatMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSplitChatSend(event);
                        }
                      }}
                      placeholder="Reply to the room without leaving split mode..."
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-300/60">
                        Press Enter to send. Shift+Enter adds a new line.
                      </span>
                      <button
                        type="submit"
                        className="button-primary text-sm"
                        disabled={!splitChatMessage.trim() || splitChatSending}
                      >
                        {splitChatSending ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/20 p-4 text-sm text-slate-300/75">
                    You have view-only access in this room.
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  {recentRoomMessages.length ? (
                    recentRoomMessages.map((entry) => {
                      const active = String(entry.id) === String(selectedSourceId);
                      const sourceCandidate = messages.some(
                        (candidate) => String(candidate.id) === String(entry.id)
                      );
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={`w-full rounded-2xl border p-3 text-left transition ${
                            active
                              ? "border-cyan-200/30 bg-cyan-300/12"
                              : "border-white/10 bg-slate-950/25 hover:border-white/20"
                          }`}
                          onClick={() => {
                            if (sourceCandidate) {
                              setSelectedSourceId(String(entry.id));
                              return;
                            }

                            onOpenThread?.(entry.id);
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">
                              {entry.sender || "Teammate"}
                            </div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-300/55">
                              {formatStamp(entry.timestamp)}
                            </div>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-300/85">
                            {summarizeMessage(entry.text)}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {sourceCandidate ? (
                              <span className="status-pill bg-cyan-300/12 text-cyan-100">
                                Use as source
                              </span>
                            ) : null}
                            <span className="status-pill">Open thread</span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/12 bg-slate-950/20 p-4 text-sm text-slate-300/75">
                      Room messages will appear here once the team starts chatting in this room.
                    </div>
                  )}
                </div>

                {selectedSourceMessage ? (
                  <button
                    type="button"
                    className="workspace-inline-link mt-1"
                    onClick={() => onOpenThread?.(selectedSourceMessage.id)}
                  >
                    Open selected thread
                  </button>
                ) : null}
              </div>
            </aside>
          ) : null}

          <div className="min-w-0 space-y-4">
            {needsSetup ? (
              <div className="rounded-[1.25rem] border border-amber-300/18 bg-amber-300/8 px-5 py-4 text-sm text-amber-100">
                Set up this room’s sandbox with a linked project path, target file, and allowed run
                command. Once those are saved, the editor will load the real file and the Run button
                will activate.
              </div>
            ) : null}

            {sessionAvailable ? (
              <SandboxSessionCard
                session={sharedSession}
                presenceList={sessionPresenceList}
                currentUserId={currentUserId}
                currentUserLabel={currentUserLabel}
                targetFilePath={sessionTargetFilePath}
                noteValue={sessionNoteDraft}
                onNoteChange={setSessionNoteDraft}
                onTakeOver={handleTakeOverSession}
                onHandOff={handleHandOffSession}
                actionState={sessionActionState}
                canEdit={canControlSharedSession}
              />
            ) : null}

            <div className="min-w-0 overflow-x-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/35">
              <div className="chat-header gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                    Repo-backed editor
                  </div>
                  <div className="mt-2 text-sm text-slate-300/75">
                    {fileStatus.loading
                      ? "Loading the linked file..."
                      : fileStatus.mode === "repo"
                      ? "Editing the real linked file inside the sandbox workspace."
                      : "Editing the selected source snippet while the repo file is still being set up."}
                  </div>
                </div>

                <div className="flex basis-full min-w-0 max-w-full flex-wrap items-start gap-2">
                  <IconToolbarButton
                    title="Open chat"
                    active={false}
                    badge={unreadMessageCount > 0 ? unreadMessageCount : null}
                    onClick={onJumpToChat}
                  >
                    <ChatBubbleIcon />
                  </IconToolbarButton>
                  <IconToolbarButton
                    title="Split mode"
                    active={layoutMode === "split"}
                    onClick={() => setLayoutMode("split")}
                  >
                    <SplitViewIcon />
                  </IconToolbarButton>
                  <IconToolbarButton
                    title="Focus mode"
                    active={layoutMode === "focus"}
                    onClick={() => setLayoutMode("focus")}
                  >
                    <FocusViewIcon />
                  </IconToolbarButton>
                  <IconToolbarButton
                    title="Live preview"
                    active={previewState.status === "ready" && previewOpen}
                    onClick={handlePreviewButton}
                    disabled={!canPreview}
                  >
                    <PreviewIcon />
                  </IconToolbarButton>
                  <IconToolbarButton title="Review with AI" onClick={requestAIReview}>
                    <SparkBotIcon />
                  </IconToolbarButton>
                  <IconToolbarButton title="Choose file" onClick={() => setFilePickerOpen(true)}>
                    <FolderIcon />
                  </IconToolbarButton>
                  <IconToolbarButton title="Diff review" onClick={() => setDiffOpen(true)}>
                    <DiffIcon />
                  </IconToolbarButton>
                  <IconToolbarButton
                    title="Save to linked repo"
                    onClick={handleSaveToRepo}
                    disabled={!canSaveToRepo || saveState.status === "saving"}
                  >
                    <SaveIcon />
                  </IconToolbarButton>
                  <IconToolbarButton
                    title="Create task"
                    onClick={handleCreateTask}
                    disabled={!selectedSourceMessage}
                  >
                    <TaskIcon />
                  </IconToolbarButton>
                  {canManageSettings ? (
                    <IconToolbarButton title="Settings" onClick={() => setSettingsOpen(true)}>
                      <CogIcon />
                    </IconToolbarButton>
                  ) : null}
                  <span className="status-pill">
                    Mode: {activeConfig.runtime === "python" ? "python" : "web/node"}
                  </span>
                  <span className="status-pill">Attempt {runState.attempt || 0}</span>
                  <span className="status-pill">{activeTargetFilePath || "No active file"}</span>
                  <span className="status-pill">{runCommand || "Command not set"}</span>
                  {previewSupported ? (
                    <span className="status-pill">
                      {previewCommand || "Preview command not set"}
                    </span>
                  ) : null}
                  {saveState.summary ? <span className="status-pill">{saveState.summary}</span> : null}
                  <button
                    type="button"
                    className="button-secondary text-sm"
                    onClick={() => applyExternalDraft(originalCode)}
                    disabled={!originalCode}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="button-primary text-sm"
                    onClick={handleRun}
                    disabled={!canRun || runState.status === "running"}
                  >
                    {runState.status === "running" ? "Running..." : "Run"}
                  </button>
                </div>
              </div>

              {fileStatus.error ? (
                <div className="border-b border-amber-300/18 bg-amber-300/8 px-5 py-3 text-sm text-amber-100">
                  {fileStatus.error}
                </div>
              ) : null}

              {shouldSuggestRelatedFiles ? (
                <div className="border-b border-white/8 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300/55">
                      Related files from error
                    </span>
                    {relatedFilesLoading && !relatedDebugFiles.length ? (
                      <span className="status-pill">Checking stack trace...</span>
                    ) : null}
                    {relatedDebugFiles.length ? (
                      relatedDebugFiles.map((path) => (
                        <button
                          key={path}
                          type="button"
                          className="status-pill transition hover:border-cyan-300/25 hover:bg-cyan-300/12 hover:text-cyan-50"
                          onClick={() => openRepoFile(path)}
                        >
                          Open {path}
                        </button>
                      ))
                    ) : !relatedFilesLoading ? (
                      <span className="text-sm text-slate-300/72">
                        No matched repo files were detected from the latest error output.
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {visiblePresenceList.length ? (
                <div className="border-b border-white/8 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300/55">
                      Live in file
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {visiblePresenceList.map((entry) => {
                        const isCurrentUser =
                          String(entry?.uid || "").trim() === String(currentUserId || "").trim();
                        return (
                          <div
                            key={`${entry?.uid || entry?.email || entry?.displayName}-${entry?.state || "editing"}`}
                            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                              isCurrentUser
                                ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-50"
                                : "border-white/10 bg-slate-950/35 text-slate-200"
                            }`}
                            title={entry.displayName}
                          >
                            <UserAvatar
                              name={entry.displayName}
                              email={entry.email}
                              photoURL={entry.photoURL}
                              size="sm"
                            />
                            <span className="max-w-[10rem] truncate">
                              {isCurrentUser ? "You" : entry.displayName}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="px-5 py-5">
                <HighlightedCodeEditor
                  value={draftCode}
                  language={language}
                  minHeight={editorHeight}
                  readOnly={!canControlSharedSession}
                  onChange={handleDraftChange}
                  externalChangeKey={editorExternalChangeKey}
                  collaboration={{
                    enabled: collaborativeEditingEnabled,
                    hiveID,
                    honeycombID,
                    targetFilePath: sessionTargetFilePath,
                    currentUserId,
                    currentUserName,
                    currentUserEmail,
                    currentUserPhotoURL,
                  }}
                />
              </div>
            </div>

            {verificationReady && !workflowTrayDismissed ? (
              <VerificationWorkflowTray
                verificationLabel={getVerificationLabel(runState, previewState)}
                targetFilePath={activeConfig.targetFilePath}
                summary={previewState.summary || runState.summary || ""}
                saved={saveState.status === "saved"}
                roomPosted={workflowRoomPostState === "posted"}
                roomPostFailed={workflowRoomPostState === "failed"}
                linkedTask={linkedTask}
                linkedDecision={linkedDecision}
                onSave={
                  canSaveToRepo && saveState.status !== "saving" ? handleSaveToRepo : undefined
                }
                onPostResult={canChat ? handleWorkflowRoomPost : undefined}
                onTaskAction={handleWorkflowTaskAction}
                onDecisionAction={handleWorkflowDecisionAction}
                onDismiss={() => setWorkflowTrayDismissed(true)}
                postingResult={workflowRoomPostState === "posting"}
                saving={saveState.status === "saving"}
              />
            ) : null}

            <div className="min-w-0 overflow-x-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/40">
              <div className="chat-header gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                    Console
                  </div>
                  <div className="mt-2 text-sm text-slate-300/75">
                    Switch between run output and the interactive terminal without stacking two
                    console panes in the workspace.
                  </div>
                </div>

                <div className="flex basis-full min-w-0 max-w-full flex-wrap items-start gap-2">
                  <button
                    type="button"
                    className={`tab-button ${consolePanelTab === "output" ? "active" : ""}`}
                    onClick={() => setConsolePanelTab("output")}
                  >
                    Run output
                  </button>
                  <button
                    type="button"
                    className={`tab-button ${consolePanelTab === "terminal" ? "active" : ""}`}
                    onClick={() => setConsolePanelTab("terminal")}
                  >
                    Terminal
                  </button>
                  {consolePanelTab === "output" && runState.exitCode !== null ? (
                    <span className="status-pill">Exit code {runState.exitCode}</span>
                  ) : null}
                  {consolePanelTab === "output" && runState.summary ? (
                    <span
                      className="status-pill max-w-full sm:max-w-[28rem]"
                      title={runState.summary}
                    >
                      {runState.summary}
                    </span>
                  ) : null}
                </div>
              </div>

              {consolePanelTab === "output" ? (
                <pre
                  className="min-w-0 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all px-5 py-5 font-mono text-sm leading-7 text-slate-200"
                  style={{ minHeight: outputHeight, maxHeight: layoutMode === "focus" ? "24rem" : "18rem" }}
                >
                  {outputText || "Run output will stream here once a session starts."}
                </pre>
              ) : (
                <SandboxTerminalPanel
                  key={terminalPanelKey}
                  hiveID={hiveID}
                  honeycombID={honeycombID}
                  config={activeConfig}
                  draftCode={draftCode}
                  applyDraft={shouldApplyDraftToTerminal}
                  sourceMessageID={selectedSourceMessage?.id || ""}
                  canControlSharedSession={canControlSharedSession}
                  embedded
                  panelHeight={terminalHeight}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {chatToast ? (
        <div className="fixed bottom-6 right-6 z-[104] w-full max-w-sm">
          <div className="rounded-[1.25rem] border border-cyan-300/18 bg-slate-950/92 p-4 shadow-[0_18px_48px_rgba(1,8,20,0.45)] backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-100/70">
                  New room message
                </div>
                <div className="mt-2 text-sm font-semibold text-white">{chatToast.sender}</div>
                <div className="mt-1 text-sm leading-6 text-slate-300">{chatToast.text}</div>
              </div>
              <button
                type="button"
                className="text-slate-400 transition hover:text-white"
                onClick={() => setChatToast(null)}
                aria-label="Dismiss message notification"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                className="button-primary text-sm"
                onClick={() => {
                  setChatToast(null);
                  onJumpToChat?.();
                }}
              >
                Open chat
              </button>
              <button
                type="button"
                className="button-ghost text-sm"
                onClick={() => setChatToast(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <LivePreviewOverlay
          runtime={activeConfig.runtime}
          previewState={previewState}
          onClose={() => setPreviewOpen(false)}
          onRestart={() => handleStartPreview({ forceRestart: true })}
          onStop={() => handleStopPreview("Preview stopped.")}
        />
      ) : null}

      <SandboxSettingsModal
        open={settingsOpen && canManageSettings}
        onClose={() => setSettingsOpen(false)}
        onSave={async (nextConfig) => {
          await onSaveSettings?.(nextConfig);
          setSettingsOpen(false);
        }}
        config={config}
      />

      {filePickerOpen ? (
        <OverlayPanel title="Choose a repo file" onClose={() => setFilePickerOpen(false)}>
          <div className="space-y-4">
            <input
              className="input-shell"
              value={fileSearch}
              onChange={(event) => setFileSearch(event.target.value)}
              placeholder="Search the linked project..."
            />

            {filesLoading ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300/75">
                Loading files from the linked project...
              </div>
            ) : filesError ? (
              <div className="rounded-2xl border border-rose-300/18 bg-rose-300/10 p-4 text-sm text-rose-100">
                {filesError}
              </div>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto rounded-[1.25rem] border border-white/10 bg-slate-950/35">
                {filteredFiles.length ? (
                  filteredFiles.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 border-b border-white/6 px-4 py-3 text-left transition last:border-b-0 ${
                        entry.path === activeTargetFilePath
                          ? "bg-cyan-300/12"
                          : "hover:bg-white/6"
                      }`}
                      onClick={() => openRepoFile(entry.path, { closePicker: true })}
                    >
                      <span className="font-mono text-sm text-slate-100">{entry.path}</span>
                      <span className="status-pill">{entry.language || "text"}</span>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-sm text-slate-300/75">
                    No files matched that search.
                  </div>
                )}
              </div>
            )}

            <p className="text-xs uppercase tracking-[0.16em] text-slate-300/55">
              File picker changes the active debug target for this session. Save room settings if
              you want to make a file the default for everyone.
            </p>
          </div>
        </OverlayPanel>
      ) : null}

      {aiReviewOpen ? (
        <OverlayPanel
          title={
            getReviewStage(runState, previewState) === "debug"
              ? "AI fix"
              : "AI review"
          }
          onClose={() => setAiReviewOpen(false)}
        >
          {aiLoading ? (
            <div className="text-sm leading-7 text-slate-200">
              Reviewing the current draft...
            </div>
          ) : (
            <AIReviewPanel
              review={aiReview}
              canApplySuggestion={
                Boolean(aiReview?.suggestedDraft) &&
                aiReview?.suggestedDraft !== draftCode
              }
              onApplySuggestion={() => {
                if (!aiReview?.suggestedDraft) return;
                applyExternalDraft(aiReview.suggestedDraft);
                setAiReviewOpen(false);
              }}
            />
          )}
        </OverlayPanel>
      ) : null}

      {diffOpen ? (
        <OverlayPanel title="Diff review" onClose={() => setDiffOpen(false)}>
          <div className="grid gap-4 lg:grid-cols-2">
            <CodePreview label="Original" value={originalCode} />
            <CodePreview label="Current draft" value={draftCode} />
          </div>
        </OverlayPanel>
      ) : null}
    </>
  );
}

function VerificationWorkflowTray({
  verificationLabel,
  targetFilePath,
  summary,
  saved,
  roomPosted,
  roomPostFailed,
  linkedTask,
  linkedDecision,
  onSave,
  onPostResult,
  onTaskAction,
  onDecisionAction,
  onDismiss,
  postingResult = false,
  saving = false,
}) {
  return (
    <div className="rounded-[1.35rem] border border-emerald-300/18 bg-emerald-300/10 px-5 py-5">
      <div className="chat-header items-start gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-emerald-100/70">
            Verified result
          </div>
          <div className="mt-2 text-lg font-semibold text-white">
            {verificationLabel} for {targetFilePath || "the active file"}
          </div>
          <div className="mt-2 text-sm leading-6 text-emerald-50/85">
            {summary ||
              "The current draft has been verified. Pick the next handoff so the room, repo, and workflow stay in sync."}
          </div>
        </div>

        <button type="button" className="button-ghost text-sm" onClick={onDismiss}>
          Close
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`status-pill ${saved ? "bg-emerald-300/18 text-emerald-50" : ""}`}>
          {saved ? "Saved to repo" : "Not saved yet"}
        </span>
        <span
          className={`status-pill ${
            roomPosted
              ? "bg-cyan-300/18 text-cyan-50"
              : roomPostFailed
              ? "bg-rose-300/16 text-rose-100"
              : ""
          }`}
        >
          {roomPosted
            ? "Posted to room"
            : roomPostFailed
            ? "Room update failed"
            : "Room update pending"}
        </span>
        <span className={`status-pill ${linkedTask ? "bg-violet-300/18 text-violet-50" : ""}`}>
          {linkedTask ? "Task already linked" : "Task not linked yet"}
        </span>
        <span className={`status-pill ${linkedDecision ? "bg-amber-300/18 text-amber-50" : ""}`}>
          {linkedDecision ? "Decision already logged" : "Decision not logged yet"}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          className="button-primary text-sm"
          onClick={onSave}
          disabled={!onSave || saving || saved}
        >
          {saved ? "Saved" : saving ? "Saving..." : "Save to repo"}
        </button>
        <button
          type="button"
          className="button-secondary text-sm"
          onClick={onPostResult}
          disabled={!onPostResult || postingResult || roomPosted}
        >
          {roomPosted ? "Posted to room" : postingResult ? "Posting..." : "Post result to room"}
        </button>
        <button type="button" className="button-secondary text-sm" onClick={onTaskAction}>
          {linkedTask ? "Open task board" : "Create task"}
        </button>
        <button type="button" className="button-ghost text-sm" onClick={onDecisionAction}>
          {linkedDecision ? "Open decisions" : "Log decision"}
        </button>
      </div>
    </div>
  );
}

function SandboxSessionCard({
  session,
  presenceList = [],
  currentUserId = "",
  currentUserLabel = "",
  targetFilePath = "",
  noteValue = "",
  onNoteChange,
  onTakeOver,
  onHandOff,
  actionState = "idle",
  canEdit = true,
}) {
  const ownerId = String(session?.ownerUserId || "").trim();
  const ownerLabel = String(
    session?.ownerDisplayName || session?.ownerEmail || ownerId || ""
  ).trim();
  const isOwnedByCurrentUser =
    Boolean(currentUserId) && ownerId === String(currentUserId);
  const sessionStatus = String(session?.status || "idle").trim() || "idle";
  const helperText = ownerId
    ? isOwnedByCurrentUser
      ? "You are leading this shared sandbox session. Everyone can co-edit live, and you control run, preview, save, and handoff."
      : `${ownerLabel || "Another teammate"} is leading this shared sandbox session. You can still co-edit live, or take over controls when needed.`
    : "No one owns this session right now. The room can co-edit live, and the next teammate to take over gets the run and save controls.";
  const latestSummary =
    session?.previewSummary ||
    session?.runSummary ||
    session?.saveSummary ||
    "";

  return (
    <div className="rounded-[1.35rem] border border-cyan-300/18 bg-cyan-300/8 px-5 py-5">
      <div className="chat-header items-start gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">
            Shared sandbox session
          </div>
          <div className="mt-2 text-lg font-semibold text-white">
            {targetFilePath || "Active file"}
          </div>
          <div className="mt-2 text-sm leading-7 text-slate-100">{helperText}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="status-pill">{sessionStatus}</span>
          <span className="status-pill">
            {ownerLabel
              ? `Lead: ${ownerLabel}`
              : "Lead: available"}
          </span>
        </div>
      </div>

      {presenceList.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {presenceList.map((entry, index) => (
            <span key={`${entry.uid || entry.displayName || "presence"}-${index}`} className="status-pill">
              {(entry.displayName || entry.email || entry.uid || "Teammate").trim()} | {entry.state || "watching"}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            Handoff note
          </div>
          <textarea
            className="textarea-shell mt-3 min-h-[110px]"
            value={noteValue}
            onChange={(event) => onNoteChange?.(event.target.value)}
            readOnly={!canEdit}
            placeholder="Leave context for the next teammate before you hand off the draft."
          />
          {latestSummary ? (
            <div className="mt-3 text-sm leading-7 text-slate-200/85">
              Latest result: {latestSummary}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-stretch gap-3 lg:w-52">
          {canEdit ? (
            <button
              type="button"
              className="button-secondary text-sm"
              onClick={onHandOff}
              disabled={actionState !== "idle"}
            >
              {actionState === "handing_off" ? "Handing off..." : "Hand off"}
            </button>
          ) : (
            <button
              type="button"
              className="button-primary text-sm"
              onClick={onTakeOver}
              disabled={actionState !== "idle"}
            >
              {actionState === "taking_over" ? "Taking over..." : "Take over controls"}
            </button>
          )}

          {!canEdit ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-4 text-sm leading-6 text-slate-300/80">
              Live draft sync stays on, but only the lead teammate edits, runs, previews, saves, and manages the handoff note.
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-4 text-sm leading-6 text-slate-300/80">
              You are the lead for this shared draft. Teammates will see your updates live and can take over when needed.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AIReviewPanel({ review, canApplySuggestion = false, onApplySuggestion }) {
  if (!review) {
    return (
      <div className="text-sm leading-7 text-slate-200">
        No review yet.
      </div>
    );
  }

  const verdictTone =
    review.verdict === "looks_good"
      ? "bg-emerald-300/14 text-emerald-50"
      : review.verdict === "apply_fix"
      ? "bg-amber-300/14 text-amber-50"
      : "bg-slate-300/12 text-slate-100";
  const hasSuggestedDraft = Boolean(review.suggestedDraft);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[1.25rem] border border-white/10 bg-slate-950/35 px-5 py-5">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            AI recommendation
          </div>
          <div className="mt-2 text-lg font-semibold text-white">
            {review.headline || "AI review"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`status-pill ${verdictTone}`}>
            {review.verdict === "looks_good"
              ? "Looks good"
              : review.verdict === "apply_fix"
              ? "Fix suggested"
              : "Manual check"}
          </span>
          {review.mode ? (
            <span className="status-pill">{review.mode}</span>
          ) : null}
        </div>
      </div>

      {hasSuggestedDraft ? (
        <section className="rounded-[1.25rem] border border-cyan-300/18 bg-cyan-300/8 px-5 py-5">
          <div className="chat-header items-start gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">
                AI fix
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-100">
                Gemini generated a full corrected draft for this file. Review it below, then apply it to the editor if it looks right.
              </p>
            </div>
            {canApplySuggestion ? (
              <button type="button" className="button-primary text-sm" onClick={onApplySuggestion}>
                Apply AI fix
              </button>
            ) : (
              <span className="status-pill bg-emerald-300/16 text-emerald-50">
                Already matches editor
              </span>
            )}
          </div>
        </section>
      ) : null}

      {review.rootCause ? (
        <section className="rounded-[1.25rem] border border-white/10 bg-slate-950/30 px-5 py-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            Root cause
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-100">{review.rootCause}</p>
        </section>
      ) : null}

      {review.recommendedAction ? (
        <section className="rounded-[1.25rem] border border-white/10 bg-slate-950/30 px-5 py-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            Best next step
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-100">
            {review.recommendedAction}
          </p>
        </section>
      ) : null}

      {review.checks?.length ? (
        <section className="rounded-[1.25rem] border border-white/10 bg-slate-950/30 px-5 py-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            Checks to run
          </div>
          <div className="mt-3 space-y-2">
            {review.checks.map((item, index) => (
              <div key={`${item}-${index}`} className="text-sm leading-7 text-slate-100">
                {index + 1}. {item}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {review.risks?.length ? (
        <section className="rounded-[1.25rem] border border-white/10 bg-slate-950/30 px-5 py-5">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            Remaining risks
          </div>
          <div className="mt-3 space-y-2">
            {review.risks.map((item, index) => (
              <div key={`${item}-${index}`} className="text-sm leading-7 text-slate-100">
                {index + 1}. {item}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {hasSuggestedDraft ? (
        <CodePreview label="Suggested code fix" value={review.suggestedDraft} />
      ) : null}

      {review.rawText && !review.rootCause && !review.recommendedAction && !review.checks?.length && !review.risks?.length ? (
        <pre className="overflow-auto rounded-[1.25rem] border border-white/10 bg-slate-950/35 px-5 py-5 font-mono text-sm leading-7 text-slate-200 whitespace-pre-wrap">
          {review.rawText}
        </pre>
      ) : null}
    </div>
  );
}

function IconToolbarButton({ title, children, active = false, disabled = false, badge = null, onClick }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
        active
          ? "border-cyan-200/30 bg-cyan-300/16 text-cyan-50 shadow-[0_12px_24px_rgba(25,181,186,0.18)]"
          : "border-white/10 bg-slate-950/40 text-slate-200 hover:border-white/20 hover:bg-white/8"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <span className="pointer-events-none h-5 w-5">{children}</span>
      {badge ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full border border-rose-300/20 bg-rose-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function iconProps() {
  return {
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    className: "h-5 w-5",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
}

function ChatBubbleIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v5A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" />
    </svg>
  );
}

function SplitViewIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <path d="M12 5v14" />
    </svg>
  );
}

function FocusViewIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12s-3.2 5.5-9.2 5.5S2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

function SparkBotIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="5" y="7" width="14" height="10" rx="3" />
      <path d="M9 11h.01" />
      <path d="M15 11h.01" />
      <path d="M9 14h6" />
      <path d="M12 4v2" />
      <path d="M20 6l-1 1" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
    </svg>
  );
}

function DiffIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M7 6v12" />
      <path d="M17 6v12" />
      <path d="M4 9h6" />
      <path d="M14 15h6" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 4.5h9l3 3v12A2.5 2.5 0 0 1 15.5 22h-9A2.5 2.5 0 0 1 4 19.5v-12A3 3 0 0 1 7 4.5z" />
      <path d="M8 4.5v5h7v-5" />
      <path d="M8.5 17h7" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="5" y="4.5" width="14" height="15" rx="2.5" />
      <path d="M9 11.5l2 2 4-4" />
      <path d="M9 4.5h6" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M10.2 4.4a1 1 0 0 1 1.6 0l.9 1.2a1 1 0 0 0 1.05.36l1.48-.45a1 1 0 0 1 1.17.68l.35 1.5a1 1 0 0 0 .78.79l1.5.35a1 1 0 0 1 .68 1.17l-.45 1.48a1 1 0 0 0 .36 1.05l1.2.9a1 1 0 0 1 0 1.6l-1.2.9a1 1 0 0 0-.36 1.05l.45 1.48a1 1 0 0 1-.68 1.17l-1.5.35a1 1 0 0 0-.78.79l-.35 1.5a1 1 0 0 1-1.17.68l-1.48-.45a1 1 0 0 0-1.05.36l-.9 1.2a1 1 0 0 1-1.6 0l-.9-1.2a1 1 0 0 0-1.05-.36l-1.48.45a1 1 0 0 1-1.17-.68l-.35-1.5a1 1 0 0 0-.79-.79l-1.5-.35a1 1 0 0 1-.68-1.17l.45-1.48a1 1 0 0 0-.36-1.05l-1.2-.9a1 1 0 0 1 0-1.6l1.2-.9a1 1 0 0 0 .36-1.05L3.8 10a1 1 0 0 1 .68-1.17l1.5-.35a1 1 0 0 0 .79-.79l.35-1.5a1 1 0 0 1 1.17-.68l1.48.45a1 1 0 0 0 1.05-.36z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function OverlayPanel({ title, children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[105] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="glass-panel flex max-h-[min(92vh,64rem)] w-full max-w-5xl flex-col overflow-hidden border border-cyan-300/18"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-header flex-shrink-0 border-b border-white/10 pb-4">
          <div>
            <span className="hero-chip">Sandbox overlay</span>
            <h2 className="panel-title mt-4 text-2xl">{title}</h2>
          </div>
          <button type="button" className="button-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

function LivePreviewOverlay({ runtime = "react", previewState, onClose, onRestart, onStop }) {
  const statusTone = makePreviewTone(previewState);
  const previewUrl = String(previewState.previewUrl || "").trim();
  const previewReady = previewState.status === "ready" && previewUrl;
  const logText = previewState.lines.map((line) => line.text).join("");
  const runtimeLabel = runtime === "python" ? "Python" : "React";
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frameUrl = useMemo(() => {
    if (!previewReady) {
      return "";
    }

    const separator = previewUrl.includes("?") ? "&" : "?";
    const cacheKey = String(
      previewState.sessionId || previewState.previewPort || Date.now()
    ).trim();
    return `${previewUrl}${separator}hmPreview=${encodeURIComponent(cacheKey)}`;
  }, [previewReady, previewState.previewPort, previewState.sessionId, previewUrl]);

  useEffect(() => {
    setFrameLoaded(false);
  }, [frameUrl]);

  return (
    <div
      className="fixed inset-0 z-[106] flex items-start justify-center overflow-y-auto bg-slate-950/78 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="glass-panel flex max-h-[92vh] w-full max-w-[min(95vw,110rem)] flex-col overflow-hidden border border-cyan-300/18"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-header flex-shrink-0 items-start gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <span className="hero-chip">Live preview</span>
            <h2 className="panel-title mt-4 text-2xl">Repo-backed {runtimeLabel} preview</h2>
            <p className="panel-subtitle mt-3 max-w-3xl">
              The preview server is running from the current sandbox draft so you can verify the
              live UI before handing the fix off.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={`status-pill ${statusTone}`}>{makePreviewBadge(previewState)}</span>
            {previewState.previewPort ? (
              <span className="status-pill">Port {previewState.previewPort}</span>
            ) : null}
            {previewState.command ? (
              <span className="status-pill">{previewState.command}</span>
            ) : null}
            <button type="button" className="button-secondary text-sm" onClick={onRestart}>
              Restart preview
            </button>
            <button type="button" className="button-ghost text-sm" onClick={onStop}>
              Stop preview
            </button>
            {previewReady ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="button-primary text-sm"
              >
                Open in tab
              </a>
            ) : null}
            <button type="button" className="button-ghost text-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="mt-5 grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/40">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                Preview frame
              </div>
              <div className="mt-2 text-sm text-slate-300/75">
                {previewReady
                  ? previewUrl
                  : previewState.summary || "Starting the preview server and waiting for it to respond..."}
              </div>
            </div>

            <div className="min-h-[26rem] flex-1 bg-[#03101f]">
              {previewReady ? (
                <div className="relative h-full min-h-[26rem]">
                  {!frameLoaded ? (
                    <div className="absolute inset-0 z-[1] flex items-center justify-center bg-[#03101f] px-6 text-center text-sm leading-7 text-slate-300/80">
                      Loading the preview frame...
                    </div>
                  ) : null}
                  <iframe
                    title="Sandbox live preview"
                    src={frameUrl}
                    className="h-full min-h-[26rem] w-full border-0 bg-white"
                    onLoad={() => {
                      setFrameLoaded(true);
                    }}
                  />
                </div>
              ) : (
                <div className="flex h-full min-h-[26rem] items-center justify-center px-6 text-center text-sm leading-7 text-slate-300/80">
                  Waiting for the preview server to come online. If the repo never responds, the
                  preview logs on the right will usually say why.
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/40">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                Preview logs
              </div>
              <div className="mt-2 text-sm text-slate-300/75">
                Startup logs stay live here so preview issues are easy to spot.
              </div>
            </div>

            <pre className="min-h-[20rem] flex-1 overflow-auto px-5 py-5 font-mono text-sm leading-7 text-slate-200">
              {logText || "Preview logs will appear here as the server starts."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function CodePreview({ label, value }) {
  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-slate-950/40">
      <div className="border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-300/60">
        {label}
      </div>
      <pre className="min-h-[20rem] overflow-x-auto px-4 py-4 font-mono text-sm leading-7 text-slate-200">
        {value || "Nothing here yet."}
      </pre>
    </div>
  );
}
