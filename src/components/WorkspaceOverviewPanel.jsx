"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { callGeminiAPI } from "@/lib/data/aiRepository";
import { getLastSeen, updateLastSeen } from "@/lib/business/chatService";
import UserAvatar from "@/components/UserAvatar";

const CLOSED_TASK_STATUSES = new Set([
  "done",
  "closed",
  "complete",
  "completed",
  "archived",
  "cancelled",
  "canceled",
]);

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function formatRelativeTime(value) {
  const timestamp = toMillis(value);
  if (!timestamp) return "just now";

  const diff = timestamp - Date.now();
  const absolute = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units = [
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  for (const [unit, step] of units) {
    if (absolute >= step || unit === "minute") {
      return formatter.format(Math.round(diff / step), unit);
    }
  }

  return "just now";
}

function formatCount(value, label) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function truncateText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function getTaskDueValue(task) {
  return task?.dueAt || task?.dueDate || null;
}

function isOpenTask(task) {
  return !CLOSED_TASK_STATUSES.has(String(task?.status || "").toLowerCase());
}

function isOverdueTask(task) {
  const dueValue = toMillis(getTaskDueValue(task));
  return Boolean(dueValue && dueValue < Date.now() && isOpenTask(task));
}

function formatCatchupContextLabel(lastSeenMs) {
  if (!lastSeenMs) return "Recent workspace summary";

  const date = new Date(lastSeenMs);
  return `Since your last visit | ${date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function buildFallbackCatchup({ hiveName, messages, decisions, tasks }) {
  const latestMessage = messages[0];
  const latestDecision = decisions[0];
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const activeCount = tasks.filter((task) => isOpenTask(task)).length;

  const parts = [
    `Here is the latest on ${hiveName || "this workspace"}.`,
  ];

  if (latestMessage?.text) {
    parts.push(
      `${latestMessage.sender || "A teammate"} was recently active in ${
        latestMessage.honeycombName || latestMessage.honeycombID || "a room"
      } and raised: ${truncateText(latestMessage.text, 110)}`
    );
  }

  if (latestDecision) {
    parts.push(
      `The newest decision is ${
        latestDecision.title || "an updated decision record"
      }, which currently reads: ${truncateText(
        latestDecision.summary || latestDecision.decision,
        120
      )}`
    );
  }

  if (activeCount || blockedCount) {
    parts.push(
      `${formatCount(activeCount, "active task")} remain in motion, with ${blockedCount} blocked right now.`
    );
  }

  parts.push("Use the decision view and task board for deeper detail.");
  return parts.join(" ");
}

async function loadRecentHiveMessages(
  hiveID,
  honeycombs,
  perRoomLimit = 3,
  maxMessages = 8,
  sinceMs = 0
) {
  if (!hiveID || !Array.isArray(honeycombs) || honeycombs.length === 0) {
    return [];
  }

  const roomMessages = await Promise.all(
    honeycombs.map(async (honeycomb) => {
      try {
        const messagesRef = query(
          collection(db, "Hive", String(hiveID), "Honeycomb", String(honeycomb.id), "messages"),
          orderBy("timestamp", "desc"),
          limit(perRoomLimit)
        );
        const snapshot = await getDocs(messagesRef);

        return snapshot.docs.map((messageDoc) => ({
          id: messageDoc.id,
          honeycombID: honeycomb.id,
          honeycombName: honeycomb.displayName || honeycomb.name || honeycomb.id,
          ...messageDoc.data(),
        }));
      } catch (error) {
        console.error(`Failed to load recent messages for honeycomb ${honeycomb.id}:`, error);
        return [];
      }
    })
  );

  return roomMessages
    .flat()
    .filter((message) => String(message.text || "").trim() || Array.isArray(message.attachment))
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp))
    .filter((message) => (sinceMs ? toMillis(message.timestamp) > sinceMs : true))
    .slice(0, maxMessages);
}

function summarizeSourcesForPrompt(messages, decisions, tasks) {
  return {
    messages: messages.slice(0, 8).map((message) => ({
      id: message.id,
      honeycombID: message.honeycombID || "",
      honeycombName: message.honeycombName || message.honeycombID || "Room",
      sender: message.sender || "User",
      text: truncateText(message.text || "No message text", 180),
      timestamp: formatRelativeTime(message.timestamp),
    })),
    decisions: decisions.slice(0, 4).map((decision) => ({
      id: decision.id,
      title: decision.title || "Decision Record",
      summary: truncateText(decision.summary || decision.decision || "No summary available.", 180),
      owner: decision.ownerDisplayName || decision.createdByDisplayName || "Team",
      updatedAt: formatRelativeTime(decision.updatedAt || decision.createdAt || decision.closedAt),
      honeycombID: decision.honeycombID || decision.source?.honeycombID || "",
      parentMessageID: decision.parentMessageID || decision.source?.parentMessageID || "",
    })),
    tasks: tasks.slice(0, 6).map((task) => ({
      id: task.id,
      title: task.title || "Untitled task",
      status: task.status || "todo",
      priority: task.priority || "medium",
      linkedDecisionTitle: task.linkedDecisionTitle || "",
      blockReason: task.blockReason || "",
    })),
  };
}

function getPulseTone({ blockedCount, onlineState }) {
  if (blockedCount > 0) {
    return { label: "At risk", tone: "warning" };
  }

  if (onlineState === "online" || onlineState === "idle") {
    return { label: "On track", tone: "healthy" };
  }

  return { label: "Offline", tone: "muted" };
}

export default function WorkspaceOverviewPanel({
  hiveID,
  hiveName,
  currentUser,
  decisions = [],
  tasks = [],
  honeycombs = [],
  members = [],
  presenceMap = {},
  onOpenThread,
  onOpenDecisionMemory,
  onOpenTaskBoard,
}) {
  const promptInputRef = useRef(null);
  const lastCatchupKeyRef = useRef("");
  const catchupBaselineRef = useRef(0);
  const catchupBaselineLoadedRef = useRef(false);
  const catchupSeenMarkedRef = useRef(false);

  const [prompt, setPrompt] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState("");
  const [loadingCopilot, setLoadingCopilot] = useState(false);
  const [catchupText, setCatchupText] = useState("");
  const [catchupWindow, setCatchupWindow] = useState("Recent workspace summary");
  const [loadingCatchup, setLoadingCatchup] = useState(false);
  const [lastSources, setLastSources] = useState({ messages: [], decisions: [], tasks: [] });

  useEffect(() => {
    lastCatchupKeyRef.current = "";
    catchupBaselineRef.current = 0;
    catchupBaselineLoadedRef.current = false;
    catchupSeenMarkedRef.current = false;
  }, [currentUser?.uid, hiveID]);

  const recentDecisions = useMemo(() => decisions.slice(0, 3), [decisions]);
  const roomNameById = useMemo(
    () =>
      Object.fromEntries(
        honeycombs.map((room) => [String(room.id), room.displayName || room.name || room.id])
      ),
    [honeycombs]
  );
  const openTasks = useMemo(
    () => tasks.filter((task) => isOpenTask(task)),
    [tasks]
  );
  const overdueTasks = useMemo(
    () => tasks.filter((task) => isOverdueTask(task)),
    [tasks]
  );
  const createdThisWeek = useMemo(() => {
    const since = Date.now() - 1000 * 60 * 60 * 24 * 7;

    return {
      honeycombs: honeycombs.filter((room) => toMillis(room.createdAt) >= since).length,
      decisions: decisions.filter(
        (decision) => toMillis(decision.updatedAt || decision.createdAt || decision.closedAt) >= since
      ).length,
    };
  }, [decisions, honeycombs]);
  const onlineCount = useMemo(
    () => {
      const knownPresenceEntries = members.filter((member) => Boolean(presenceMap?.[member.uid]));
      if (!knownPresenceEntries.length) return 0;

      return knownPresenceEntries.filter((member) => {
        const state = String(presenceMap?.[member.uid]?.state || "").toLowerCase();
        return state === "online";
      }).length;
    },
    [members, presenceMap]
  );

  const hasPresenceData = useMemo(
    () => members.some((member) => Boolean(presenceMap?.[member.uid])),
    [members, presenceMap]
  );

  const pulseEntries = useMemo(() => {
    return members
      .map((member) => {
        const memberTasks = tasks.filter((task) => Array.isArray(task.assignees) && task.assignees.includes(member.uid));
        const blockedCount = memberTasks.filter((task) => isOverdueTask(task) || task.status === "blocked").length;
        const activeTask = memberTasks.find((task) =>
          ["doing", "in-progress", "todo"].includes(String(task.status || "").toLowerCase())
        );
        const primaryRoomId = String(
          activeTask?.source?.honeycombID || memberTasks[0]?.source?.honeycombID || ""
        );
        const primaryRoomLabel = roomNameById[primaryRoomId] || primaryRoomId || "workspace";
        const presence = presenceMap?.[member.uid] || null;
        const hasPresence = Boolean(presence);
        const onlineState = hasPresence ? String(presence?.state || "offline").toLowerCase() : "unavailable";
        const tone = hasPresence
          ? getPulseTone({ blockedCount, onlineState })
          : { label: "Unavailable", tone: "unavailable" };
        const label = member.displayName || member.email || member.uid;

        let detail = "No active assignments";
        if (blockedCount > 0) {
          detail = `${formatCount(blockedCount, "task")} overdue`;
        } else if (onlineState === "online") {
          detail = primaryRoomId ? `Active in #${primaryRoomLabel}` : "Active in workspace";
        } else if (activeTask?.title) {
          detail = `Working on ${activeTask.title}`;
        } else if (onlineState === "idle") {
          detail = "Away from keyboard";
        }

        let activity = "Presence unavailable";
        if (onlineState === "online") {
          activity = presence?.lastChanged
            ? `Active ${formatRelativeTime(presence.lastChanged)}`
            : "Active now";
        } else if (onlineState === "idle") {
          activity = `Idle ${formatRelativeTime(presence?.lastChanged)}`;
        } else if (presence?.lastChanged) {
          activity = `Offline ${formatRelativeTime(presence.lastChanged)}`;
        }

        return {
          uid: member.uid,
          label,
          photoURL: String(presence?.photoURL || member.photoURL || "").trim(),
          detail,
          activity,
          tone,
          onlineRank: onlineState === "online" ? 0 : onlineState === "idle" ? 1 : 2,
          blockedCount,
        };
      })
      .sort((left, right) => {
        if (left.onlineRank !== right.onlineRank) return left.onlineRank - right.onlineRank;
        if (left.blockedCount !== right.blockedCount) return right.blockedCount - left.blockedCount;
        return left.label.localeCompare(right.label);
      });
  }, [members, presenceMap, roomNameById, tasks]);

  const topMetrics = useMemo(
    () => [
      {
        value: honeycombs.length,
        label: "Honeycombs",
        note: `+${createdThisWeek.honeycombs} this week`,
        accent: "amber",
      },
      {
        value: decisions.length,
        label: "Decisions",
        note: `+${createdThisWeek.decisions} this week`,
        accent: "gold",
      },
      {
        value: openTasks.length,
        label: "Open Tasks",
        note: overdueTasks.length ? `${overdueTasks.length} overdue` : "No overdue work",
        accent: "rose",
        noteTone: overdueTasks.length ? "danger" : "",
      },
      {
        value: onlineCount,
        label: "Online Now",
        note: hasPresenceData ? `of ${members.length} members` : "Presence unavailable",
        accent: "green",
      },
    ],
    [createdThisWeek.decisions, createdThisWeek.honeycombs, decisions.length, hasPresenceData, honeycombs.length, members.length, onlineCount, openTasks.length, overdueTasks.length]
  );

  const catchupKey = useMemo(
    () =>
      [
        String(hiveID),
        honeycombs.map((item) => item.id).sort().join("|"),
        decisions
          .slice(0, 4)
          .map((item) => `${item.id}:${toMillis(item.updatedAt || item.createdAt || item.closedAt)}`)
          .join("|"),
        tasks
          .slice(0, 6)
          .map((item) => `${item.id}:${item.status}:${toMillis(item.updatedAt || item.createdAt)}`)
          .join("|"),
      ].join("::"),
    [decisions, hiveID, honeycombs, tasks]
  );

  const requestCatchup = useCallback(async (detail = "brief", sinceMs = 0) => {
    const recentMessages = await loadRecentHiveMessages(
      hiveID,
      honeycombs,
      detail === "full" ? 8 : 5,
      detail === "full" ? 24 : 16,
      sinceMs
    );
    const recentDecisions = sinceMs
      ? decisions.filter(
          (decision) =>
            toMillis(decision.updatedAt || decision.createdAt || decision.closedAt) > sinceMs
        )
      : decisions;
    const recentTasks = sinceMs
      ? tasks.filter((task) => toMillis(task.updatedAt || task.createdAt) > sinceMs)
      : tasks;
    const sourceBundle = summarizeSourcesForPrompt(recentMessages, recentDecisions, recentTasks);
    const nextWindow = formatCatchupContextLabel(sinceMs);

    if (
      sourceBundle.messages.length === 0 &&
      sourceBundle.decisions.length === 0 &&
      sourceBundle.tasks.length === 0
    ) {
      return {
        text: sinceMs
          ? "No major updates landed since your last visit."
          : "No recent workspace activity yet. Start a room discussion, close a thread, or create a task to generate a catch-up briefing.",
        sourceBundle,
        window: nextWindow,
      };
    }

    const promptText = `
    You are writing the AI catch-up card for the HiveMind workspace "${hiveName || hiveID}".
    The returning teammate is ${currentUser?.displayName || currentUser?.email || "a team member"}.

    Return plain text only.
    Write ${detail === "full" ? "a detailed 120-160 word briefing" : "a concise 70-110 word briefing"}.
    ${sinceMs ? "Summarize only what changed since the user's last visit." : "Summarize the latest visible workspace state."}
    Focus on:
    - the most important recent messages
    - the latest decisions
    - blockers or active tasks
    - the most important next step

Do not invent facts. Do not use bullet points. Keep it readable inside a dashboard card.

Recent messages:
${sourceBundle.messages.map((message) => `- [${message.honeycombName}] ${message.sender} (${message.timestamp}): ${message.text}`).join("\n") || "- none"}

Recent decisions:
${sourceBundle.decisions.map((decision) => `- ${decision.title} (${decision.updatedAt}, ${decision.owner}): ${decision.summary}`).join("\n") || "- none"}

Current tasks:
${sourceBundle.tasks.map((task) => `- ${task.title} | status: ${task.status} | priority: ${task.priority} | decision: ${task.linkedDecisionTitle || "none"}${task.blockReason ? ` | blocked because: ${task.blockReason}` : ""}`).join("\n") || "- none"}
    `.trim();

    const reply = await callGeminiAPI(promptText, "gemini-2.5-flash", [], {
      hiveID,
      feature: "workspace_catchup",
      scope: "hive",
    });

    return {
      text:
        String(reply || "").trim() ||
        buildFallbackCatchup({
          hiveName,
          messages: recentMessages,
          decisions: recentDecisions,
          tasks: recentTasks,
        }),
      sourceBundle,
      window: nextWindow,
    };
  }, [currentUser?.displayName, currentUser?.email, decisions, hiveID, hiveName, honeycombs, tasks]);

  useEffect(() => {
    const hasData = honeycombs.length > 0 || decisions.length > 0 || tasks.length > 0;

    if (!hasData) {
      setCatchupText(
        "No recent workspace activity yet. Start a room discussion, close a thread, or create a task to generate a catch-up briefing."
      );
      setCatchupWindow("Recent workspace summary");
      return;
    }

    if (lastCatchupKeyRef.current === catchupKey) {
      return;
    }

    lastCatchupKeyRef.current = catchupKey;
    let cancelled = false;

    async function hydrateCatchup() {
      try {
        setLoadingCatchup(true);
        let sinceMs = catchupBaselineRef.current;
        if (!catchupBaselineLoadedRef.current) {
          sinceMs = currentUser?.uid
            ? await getLastSeen(hiveID, null, null, currentUser.uid)
            : 0;
          catchupBaselineRef.current = sinceMs;
          catchupBaselineLoadedRef.current = true;
        }
        const response = await requestCatchup("brief", sinceMs);
        if (!cancelled) {
          setLastSources(response.sourceBundle);
          setCatchupWindow(response.window);
          setCatchupText(response.text);
        }
        if (currentUser?.uid && !catchupSeenMarkedRef.current) {
          await updateLastSeen(hiveID, null, null, currentUser.uid);
          catchupSeenMarkedRef.current = true;
        }
      } catch (error) {
        console.error("Failed to build workspace catchup:", error);
        if (!cancelled) {
          setCatchupText(
            buildFallbackCatchup({
              hiveName,
              messages: [],
              decisions,
              tasks,
            })
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCatchup(false);
        }
      }
    }

    hydrateCatchup();

    return () => {
      cancelled = true;
    };
  }, [catchupKey, currentUser?.uid, decisions, hiveID, hiveName, honeycombs.length, tasks, requestCatchup]);

  const askCopilot = async (event) => {
    event?.preventDefault?.();
    if (!prompt.trim()) return;

    try {
      setLoadingCopilot(true);
      const recentMessages =
        lastSources.messages.length > 0
          ? lastSources.messages
          : summarizeSourcesForPrompt(await loadRecentHiveMessages(hiveID, honeycombs), decisions, tasks).messages;
      const sourceBundle = {
        messages: recentMessages,
        decisions: lastSources.decisions.length ? lastSources.decisions : summarizeSourcesForPrompt([], decisions, tasks).decisions,
        tasks: lastSources.tasks.length ? lastSources.tasks : summarizeSourcesForPrompt([], decisions, tasks).tasks,
      };

      setLastSources(sourceBundle);

      const groundedPrompt = `
You are the HiveMind dashboard copilot for workspace "${hiveName || hiveID}".
Answer the user's question using only the workspace state below.
Be concrete and action-oriented. If the answer is uncertain, say so briefly.

Recent messages:
${sourceBundle.messages.map((message) => `- [${message.honeycombName}] ${message.sender}: ${message.text}`).join("\n") || "- none"}

Recent decisions:
${sourceBundle.decisions.map((decision) => `- ${decision.title}: ${decision.summary}`).join("\n") || "- none"}

Current tasks:
${sourceBundle.tasks.map((task) => `- ${task.title} | ${task.status} | priority ${task.priority} | decision ${task.linkedDecisionTitle || "none"}${task.blockReason ? ` | blocked because ${task.blockReason}` : ""}`).join("\n") || "- none"}

User question:
${prompt.trim()}
      `.trim();

      const reply = await callGeminiAPI(groundedPrompt, "gemini-2.5-flash", [], {
        hiveID,
        feature: "workspace_copilot",
        scope: "hive",
      });
      setCopilotAnswer(String(reply || "").trim() || "The project copilot could not respond right now.");
    } catch (error) {
      console.error("Workspace copilot failed:", error);
      setCopilotAnswer("The project copilot could not respond right now.");
    } finally {
      setLoadingCopilot(false);
    }
  };

  const refreshCatchup = async (detail) => {
    try {
      setLoadingCatchup(true);
      const response = await requestCatchup(detail, catchupBaselineRef.current);
      setLastSources(response.sourceBundle);
      setCatchupWindow(response.window);
      setCatchupText(response.text);
    } catch (error) {
      console.error("Failed to refresh workspace catchup:", error);
    } finally {
      setLoadingCatchup(false);
    }
  };

  return (
    <section className="workspace-dashboard-stack">
      <div className="workspace-metric-grid">
        {topMetrics.map((metric) => (
          <article key={metric.label} className={`workspace-metric-card is-${metric.accent}`}>
            <div className="workspace-metric-value">{metric.value}</div>
            <div className="workspace-metric-label">{metric.label}</div>
            <div
              className={`workspace-metric-note ${
                metric.noteTone === "danger" ? "!text-rose-300" : ""
              }`}
            >
              {metric.note}
            </div>
          </article>
        ))}
      </div>

      <div className="workspace-dashboard-grid">
        <section className="workspace-card">
          <div className="workspace-card-header">
            <div>
              <div className="workspace-card-kicker">
                <span className="workspace-live-dot" aria-hidden="true" />
                Team pulse
              </div>
            </div>
            <span className="workspace-card-link">{onlineCount > 0 ? "Live" : "Quiet"}</span>
          </div>

          <div className="workspace-pulse-list">
            {pulseEntries.length ? (
              pulseEntries.map((entry) => (
                <article key={entry.uid} className="workspace-pulse-item">
                  <div className="workspace-pulse-copy">
                    <div className="workspace-pulse-title-row">
                      <UserAvatar
                        name={entry.label}
                        photoURL={entry.photoURL}
                        className="workspace-pulse-avatar"
                        size="fill"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              entry.onlineRank === 0
                                ? "bg-emerald-400"
                                : entry.onlineRank === 1
                                ? "bg-amber-300"
                                : "bg-slate-500"
                            }`}
                            aria-hidden="true"
                          />
                          <div className="workspace-pulse-name">{entry.label}</div>
                        </div>
                        <div className="workspace-pulse-activity">{entry.activity}</div>
                      </div>
                    </div>
                    <div className="workspace-pulse-detail">{entry.detail}</div>
                  </div>
                  <span className={`workspace-state-pill is-${entry.tone.tone}`}>
                    {entry.tone.label}
                  </span>
                </article>
              ))
            ) : (
              <div className="workspace-empty">No member activity to show yet.</div>
            )}
          </div>
        </section>

        <section className="workspace-card">
          <div className="workspace-card-header">
            <div>
              <div className="workspace-card-kicker">Recent decisions</div>
            </div>
            <button type="button" onClick={onOpenDecisionMemory} className="workspace-card-link">
              View all
            </button>
          </div>

          <div className="workspace-decision-list">
            {recentDecisions.length ? (
              recentDecisions.map((decision) => (
                <article key={decision.id} className="workspace-decision-item">
                  <div className="workspace-decision-title">
                    {decision.title || "Decision Record"}
                  </div>
                  <div className="workspace-decision-summary">
                    {truncateText(decision.summary || decision.decision || "No summary available.", 140)}
                  </div>
                  <div className="workspace-decision-meta">
                    <span className="workspace-tag-pill">
                      {(Array.isArray(decision.tags) && decision.tags[0]) || decision.status || "Decision"}
                    </span>
                    <span>
                      {formatRelativeTime(decision.updatedAt || decision.createdAt || decision.closedAt)}
                    </span>
                    <span>
                      {decision.ownerDisplayName || decision.createdByDisplayName || "Team"}
                    </span>
                    <span>
                      {roomNameById[String(decision.source?.honeycombID || decision.honeycombID || "")] ||
                        decision.source?.honeycombID ||
                        decision.honeycombID ||
                        "Unknown room"}
                    </span>
                  </div>
                  {decision.parentMessageID || decision.source?.parentMessageID ? (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenThread?.(
                          decision.source?.honeycombID || decision.honeycombID,
                          decision.source?.parentMessageID || decision.parentMessageID
                        )
                      }
                      className="workspace-inline-link"
                    >
                      Open discussion
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="workspace-empty">No decision records yet.</div>
            )}
          </div>
        </section>
      </div>

      <section className="workspace-catchup-card">
        <div className="workspace-catchup-main">
          <div className="workspace-card-header">
            <div>
              <div className="workspace-card-kicker is-accent">AI Catchup</div>
              <h2 className="workspace-catchup-title">While you were away</h2>
              <div className="workspace-metric-note mt-2">{catchupWindow}</div>
            </div>
          </div>

          <p className="workspace-catchup-body">
            {loadingCatchup ? "Building the latest catch-up from recent messages and decisions..." : catchupText}
          </p>
        </div>

        <div className="workspace-catchup-actions">
          <button
            type="button"
            onClick={() => refreshCatchup("full")}
            disabled={loadingCatchup}
            className="workspace-action-button is-primary"
          >
            {loadingCatchup ? "Thinking..." : "Full briefing"}
          </button>
          <button
            type="button"
            onClick={() => promptInputRef.current?.focus()}
            className="workspace-action-button"
          >
            Ask AI
          </button>
          <button
            type="button"
            onClick={onOpenDecisionMemory}
            className="workspace-action-button"
          >
            View decisions
          </button>
        </div>
      </section>

      <section className="workspace-copilot-card">
        <form className="workspace-copilot-row" onSubmit={askCopilot}>
          <div className="workspace-copilot-badge" aria-hidden="true">
            AI
          </div>
          <input
            ref={promptInputRef}
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What should we work on next? What's blocked?"
            className="workspace-copilot-input"
          />
          <button type="submit" disabled={loadingCopilot} className="workspace-ask-button">
            {loadingCopilot ? "Thinking..." : "Ask Copilot"}
          </button>
        </form>

        {copilotAnswer ? (
          <div className="workspace-copilot-response">
            <div className="workspace-copilot-response-copy">
              <div className="workspace-card-kicker is-muted">Copilot answer</div>
              <p>{copilotAnswer}</p>
            </div>

            <div className="workspace-source-strip">
              {lastSources.messages.slice(0, 2).map((message) => (
                <span key={`message-${message.id}`} className="workspace-source-pill">
                  {message.honeycombName}
                </span>
              ))}
              {lastSources.decisions.slice(0, 2).map((decision) => (
                <span key={`decision-${decision.id}`} className="workspace-source-pill">
                  {decision.title}
                </span>
              ))}
              {lastSources.tasks.slice(0, 2).map((task) => (
                <span key={`task-${task.id}`} className="workspace-source-pill">
                  {task.title}
                </span>
              ))}
              <button type="button" onClick={onOpenTaskBoard} className="workspace-inline-link">
                Open work view
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}
