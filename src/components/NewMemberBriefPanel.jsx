"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  callGeminiAPI,
  getAIResponseIssue,
} from "@/lib/data/aiRepository";
import { normalizeBriefingPayload } from "@/lib/ai/structuredOutput";

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

function truncateText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function areRecentMessageListsEqual(currentMessages = [], nextMessages = []) {
  if (currentMessages === nextMessages) return true;
  if (currentMessages.length !== nextMessages.length) return false;

  return currentMessages.every((message, index) => {
    const nextMessage = nextMessages[index];
    return (
      String(message?.id || "") === String(nextMessage?.id || "") &&
      String(message?.honeycombID || "") === String(nextMessage?.honeycombID || "") &&
      String(message?.text || "") === String(nextMessage?.text || "") &&
      toMillis(message?.timestamp) === toMillis(nextMessage?.timestamp)
    );
  });
}

async function loadRecentHiveMessages(hiveID, honeycombs, maxPerRoom = 5, maxMessages = 18) {
  if (!hiveID || !Array.isArray(honeycombs) || honeycombs.length === 0) {
    return [];
  }

  const roomMessages = await Promise.all(
    honeycombs.map(async (honeycomb) => {
      try {
        const messagesQuery = query(
          collection(db, "Hive", String(hiveID), "Honeycomb", String(honeycomb.id), "messages"),
          orderBy("timestamp", "desc"),
          limit(maxPerRoom)
        );
        const snapshot = await getDocs(messagesQuery);

        return snapshot.docs.map((messageDoc) => ({
          id: messageDoc.id,
          honeycombID: honeycomb.id,
          honeycombName: honeycomb.displayName || honeycomb.name || honeycomb.id,
          ...messageDoc.data(),
        }));
      } catch (error) {
        console.error(`Failed to load messages for ${honeycomb.id}:`, error);
        return [];
      }
    })
  );

  return roomMessages
    .flat()
    .filter((message) => String(message.text || "").trim())
    .sort((left, right) => toMillis(right.timestamp) - toMillis(left.timestamp))
    .slice(0, maxMessages);
}

function scoreTask(task) {
  const status = String(task.status || "todo").toLowerCase();
  const priority = String(task.priority || "medium").toLowerCase();

  let score = 0;
  if (status === "blocked") score += 100;
  else if (status === "doing") score += 70;
  else if (status === "todo") score += 40;
  else if (status === "done") score += 5;

  if (priority === "high") score += 18;
  else if (priority === "medium") score += 10;
  else score += 4;

  if (Array.isArray(task.assignees) && task.assignees.length > 0) score += 6;
  if (task.linkedDecisionId) score += 12;

  const updatedAt = toMillis(task.updatedAt || task.createdAt);
  if (updatedAt) {
    const ageHours = Math.max(1, (Date.now() - updatedAt) / (1000 * 60 * 60));
    score += Math.max(0, 24 - ageHours) / 4;
  }

  return score;
}

function scoreDecision(decision, tasks, recentMessages) {
  const status = String(decision.status || "active").toLowerCase();
  const title = String(decision.title || "").toLowerCase();
  const tags = Array.isArray(decision.tags) ? decision.tags.join(" ").toLowerCase() : "";

  let score = 0;
  if (status === "active") score += 30;
  if (status === "draft") score += 12;
  if (status === "superseded") score -= 10;
  if (status === "archived") score -= 14;

  const linkedTasks = tasks.filter((task) => String(task.linkedDecisionId || "") === String(decision.id));
  score += linkedTasks.length * 8;
  score += linkedTasks.filter((task) => String(task.status || "").toLowerCase() === "blocked").length * 16;
  score += linkedTasks.filter((task) => String(task.status || "").toLowerCase() === "doing").length * 10;

  if (/auth|architecture|security|database|incident|api|mobile|infra|billing/.test(`${title} ${tags}`)) {
    score += 12;
  }

  const roomId = String(decision.honeycombID || decision.source?.honeycombID || "");
  if (
    roomId &&
    recentMessages.some((message) => String(message.honeycombID || "") === roomId)
  ) {
    score += 8;
  }

  const updatedAt = toMillis(decision.updatedAt || decision.createdAt || decision.closedAt);
  if (updatedAt) {
    const ageHours = Math.max(1, (Date.now() - updatedAt) / (1000 * 60 * 60));
    score += Math.max(0, 72 - ageHours) / 6;
  }

  return score;
}

function buildDecisionCatalog(decisions, tasks, recentMessages) {
  const ranked = [...decisions].sort(
    (left, right) => scoreDecision(right, tasks, recentMessages) - scoreDecision(left, tasks, recentMessages)
  );

  const limitCount = ranked.length <= 20 ? ranked.length : 20;
  return ranked.slice(0, limitCount);
}

function buildTaskCatalog(tasks) {
  const ranked = [...tasks].sort((left, right) => scoreTask(right) - scoreTask(left));
  const limitCount = ranked.length <= 20 ? ranked.length : 20;
  return ranked.slice(0, limitCount);
}

function buildRoomCatalog(honeycombs, decisions, recentMessages) {
  const seen = new Set();
  const rooms = [];

  for (const honeycomb of honeycombs || []) {
    const id = String(honeycomb.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rooms.push({
      id,
      name: honeycomb.displayName || honeycomb.name || id,
    });
  }

  for (const decision of decisions || []) {
    const id = String(decision.honeycombID || decision.source?.honeycombID || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rooms.push({ id, name: id });
  }

  for (const message of recentMessages || []) {
    const id = String(message.honeycombID || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rooms.push({ id, name: message.honeycombName || id });
  }

  return rooms;
}

function buildFallbackBrief({
  hiveName,
  currentUser,
  rankedDecisions,
  rankedTasks,
  roomCatalog,
}) {
  const blockers = rankedTasks.filter((task) => task.status === "blocked").slice(0, 2);
  const nextTasks = rankedTasks
    .filter((task) => task.status === "doing" || task.status === "todo")
    .slice(0, 2);
  const topDecisions = rankedDecisions.slice(0, 3);

  return {
    welcomeTitle: `Welcome to the ${hiveName} hive, ${
      currentUser?.displayName || currentUser?.email?.split("@")[0] || "teammate"
    }`,
    welcomeBody:
      "Here is the fastest way to get oriented: anchor on the key decisions, check what is blocked, then plug into the next active workstream.",
    decisionIds: topDecisions.map((decision) => decision.id),
    blockerTaskIds: blockers.map((task) => task.id),
    nextTaskIds: nextTasks.map((task) => task.id),
    roomIdsToWatch: roomCatalog.slice(0, 2).map((room) => room.id),
    suggestedQuestions: [
      "Why did we choose this architecture?",
      "What is blocked right now?",
      "What should I read first?",
      "What is shipping next?",
    ],
  };
}

function normalizeBriefing(raw, fallback, decisionCatalog, taskCatalog, roomCatalog) {
  const validDecisionIds = new Set(decisionCatalog.map((decision) => String(decision.id)));
  const validTaskIds = new Set(taskCatalog.map((task) => String(task.id)));
  const validRoomIds = new Set(roomCatalog.map((room) => String(room.id)));

  return {
    welcomeTitle: String(raw?.welcomeTitle || fallback.welcomeTitle || "").trim(),
    welcomeBody: String(raw?.welcomeBody || fallback.welcomeBody || "").trim(),
    decisionIds: Array.isArray(raw?.decisionIds)
      ? raw.decisionIds.map(String).filter((id) => validDecisionIds.has(id)).slice(0, 3)
      : fallback.decisionIds,
    blockerTaskIds: Array.isArray(raw?.blockerTaskIds)
      ? raw.blockerTaskIds.map(String).filter((id) => validTaskIds.has(id)).slice(0, 2)
      : fallback.blockerTaskIds,
    nextTaskIds: Array.isArray(raw?.nextTaskIds)
      ? raw.nextTaskIds.map(String).filter((id) => validTaskIds.has(id)).slice(0, 2)
      : fallback.nextTaskIds,
    roomIdsToWatch: Array.isArray(raw?.roomIdsToWatch)
      ? raw.roomIdsToWatch.map(String).filter((id) => validRoomIds.has(id)).slice(0, 3)
      : fallback.roomIdsToWatch,
    suggestedQuestions: Array.isArray(raw?.suggestedQuestions)
      ? raw.suggestedQuestions.map((question) => String(question || "").trim()).filter(Boolean).slice(0, 5)
      : fallback.suggestedQuestions,
  };
}

function mapIdsToRecords(ids, collectionItems) {
  const lookup = new Map(collectionItems.map((item) => [String(item.id), item]));
  return (ids || []).map((id) => lookup.get(String(id))).filter(Boolean);
}

export default function NewMemberBriefPanel({
  hiveID,
  hiveName,
  currentUser,
  decisions = [],
  tasks = [],
  honeycombs = [],
  onOpenThread,
  entryMode = false,
  onEnterHive = null,
}) {
  const autoBriefingTriggeredRef = useRef(false);
  const [briefing, setBriefing] = useState(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [recentMessages, setRecentMessages] = useState([]);

  const rankedTasks = useMemo(() => buildTaskCatalog(tasks), [tasks]);
  const rankedDecisions = useMemo(
    () => buildDecisionCatalog(decisions, tasks, recentMessages),
    [decisions, recentMessages, tasks]
  );
  const roomCatalog = useMemo(
    () => buildRoomCatalog(honeycombs, rankedDecisions, recentMessages),
    [honeycombs, rankedDecisions, recentMessages]
  );
  const roomNameLookup = useMemo(
    () => Object.fromEntries(roomCatalog.map((room) => [String(room.id), room.name || room.id])),
    [roomCatalog]
  );

  useEffect(() => {
    const fallback = buildFallbackBrief({
      hiveName,
      currentUser,
      rankedDecisions,
      rankedTasks,
      roomCatalog,
    });

    setBriefing((current) => current || fallback);
  }, [currentUser, hiveName, rankedDecisions, rankedTasks, roomCatalog]);

  const selectedDecisions = useMemo(() => {
    if (!briefing?.decisionIds?.length) {
      return rankedDecisions.slice(0, 3);
    }
    const mapped = mapIdsToRecords(briefing.decisionIds, decisions);
    return mapped.length ? mapped : rankedDecisions.slice(0, 3);
  }, [briefing?.decisionIds, decisions, rankedDecisions]);

  const blockerTasks = useMemo(() => {
    if (!briefing?.blockerTaskIds?.length) {
      return rankedTasks.filter((task) => task.status === "blocked").slice(0, 2);
    }
    const mapped = mapIdsToRecords(briefing.blockerTaskIds, tasks);
    return mapped.length ? mapped : rankedTasks.filter((task) => task.status === "blocked").slice(0, 2);
  }, [briefing?.blockerTaskIds, rankedTasks, tasks]);

  const nextTasks = useMemo(() => {
    if (!briefing?.nextTaskIds?.length) {
      return rankedTasks
        .filter((task) => task.status === "doing" || task.status === "todo")
        .slice(0, 2);
    }
    const mapped = mapIdsToRecords(briefing.nextTaskIds, tasks);
    return mapped.length
      ? mapped
      : rankedTasks.filter((task) => task.status === "doing" || task.status === "todo").slice(0, 2);
  }, [briefing?.nextTaskIds, rankedTasks, tasks]);

  const roomsToWatch = useMemo(() => {
    if (!briefing?.roomIdsToWatch?.length) {
      return roomCatalog.slice(0, 2);
    }
    return mapIdsToRecords(briefing.roomIdsToWatch, roomCatalog);
  }, [briefing?.roomIdsToWatch, roomCatalog]);

  const generateBriefing = useCallback(async () => {
    try {
      setLoadingBriefing(true);
      setQuestionAnswer("");
      setActiveQuestion("");

      const nextMessages = await loadRecentHiveMessages(hiveID, honeycombs);
      setRecentMessages((currentMessages) =>
        areRecentMessageListsEqual(currentMessages, nextMessages) ? currentMessages : nextMessages
      );

      const nextRankedTasks = buildTaskCatalog(tasks);
      const nextRankedDecisions = buildDecisionCatalog(decisions, tasks, nextMessages);
      const nextRoomCatalog = buildRoomCatalog(honeycombs, nextRankedDecisions, nextMessages);
      const fallback = buildFallbackBrief({
        hiveName,
        currentUser,
        rankedDecisions: nextRankedDecisions,
        rankedTasks: nextRankedTasks,
        roomCatalog: nextRoomCatalog,
      });

      if (!nextRankedDecisions.length && !nextMessages.length && !nextRankedTasks.length) {
        setBriefing(fallback);
        return;
      }

      const decisionCatalog = nextRankedDecisions.map((decision) => ({
        id: decision.id,
        title: decision.title || "Decision Record",
        summary: truncateText(decision.summary || decision.decision || "No summary yet."),
        rationale: truncateText(decision.rationale || "", 140),
        owner: decision.ownerDisplayName || decision.createdByDisplayName || "Team",
        room: decision.honeycombID || decision.source?.honeycombID || "Unknown room",
        linkedTasks: Array.isArray(decision.linkedTaskIds) ? decision.linkedTaskIds.length : 0,
        updatedAt: formatRelativeTime(
          decision.updatedAt || decision.createdAt || decision.closedAt
        ),
      }));

      const taskCatalog = nextRankedTasks.map((task) => ({
        id: task.id,
        title: task.title || "Untitled task",
        status: task.status || "todo",
        priority: task.priority || "medium",
        description: truncateText(
          [
            task.description || "No details yet.",
            task.blockReason ? `Blocked because: ${task.blockReason}` : "",
          ]
            .filter(Boolean)
            .join(" ")
        ),
        linkedDecisionTitle: task.linkedDecisionTitle || "",
      }));

      const prompt = `
You are preparing a structured new-member briefing for the HiveMind workspace "${hiveName || hiveID}".
Return ONLY raw JSON with this exact shape:
{
  "welcomeTitle": "string",
  "welcomeBody": "string",
  "decisionIds": ["decision-id"],
  "blockerTaskIds": ["task-id"],
  "nextTaskIds": ["task-id"],
  "roomIdsToWatch": ["room-id"],
  "suggestedQuestions": ["string"]
}

Rules:
- Use only the data below.
- "decisionIds" must only contain IDs from the decision catalog.
- "blockerTaskIds" and "nextTaskIds" must only contain IDs from the task catalog.
- "roomIdsToWatch" must only contain IDs from the room catalog.
- Pick up to 3 decisions.
- Pick up to 2 blockers.
- Pick up to 2 next steps.
- Pick up to 3 rooms to watch.
- Keep welcomeBody to 2 sentences.
- suggestedQuestions should be short and useful for a new teammate.

Decision catalog:
${decisionCatalog.map((decision) => `- ${decision.id} | ${decision.title} | ${decision.summary} | rationale ${decision.rationale || "n/a"} | owner ${decision.owner} | room ${decision.room} | linked tasks ${decision.linkedTasks}`).join("\n") || "- none"}

Task catalog:
${taskCatalog.map((task) => `- ${task.id} | ${task.title} | status ${task.status} | priority ${task.priority} | decision ${task.linkedDecisionTitle || "none"} | ${task.description}`).join("\n") || "- none"}

Room catalog:
${nextRoomCatalog.map((room) => `- ${room.id} | ${room.name}`).join("\n") || "- none"}

Recent messages:
${nextMessages.map((message) => `- [${message.honeycombName}] ${message.sender || "User"} (${formatRelativeTime(message.timestamp)}): ${truncateText(message.text, 180)}`).join("\n") || "- none"}
      `.trim();

      const reply = await callGeminiAPI(prompt, "gemini-2.5-flash", [], {
        hiveID,
        feature: "new_member_brief",
        scope: "hive",
      });

      const structured = normalizeBriefingPayload(reply, {
        fallback,
        allowedDecisionIds: decisionCatalog.map((decision) => decision.id),
        allowedTaskIds: taskCatalog.map((task) => task.id),
        allowedRoomIds: nextRoomCatalog.map((room) => room.id),
      });
      setBriefing(
        normalizeBriefing(
          structured,
          fallback,
          decisionCatalog,
          taskCatalog,
          nextRoomCatalog
        )
      );
    } catch (error) {
      console.error("Failed to build new member briefing:", error);
      const fallbackRankedTasks = buildTaskCatalog(tasks);
      const fallbackRankedDecisions = buildDecisionCatalog(decisions, tasks, []);
      const fallbackRoomCatalog = buildRoomCatalog(honeycombs, fallbackRankedDecisions, []);
      setBriefing(
        buildFallbackBrief({
          hiveName,
          currentUser,
          rankedDecisions: fallbackRankedDecisions,
          rankedTasks: fallbackRankedTasks,
          roomCatalog: fallbackRoomCatalog,
        })
      );
    } finally {
      setLoadingBriefing(false);
    }
  }, [currentUser, decisions, hiveID, hiveName, honeycombs, tasks]);

  useEffect(() => {
    if (!entryMode || autoBriefingTriggeredRef.current) return;
    autoBriefingTriggeredRef.current = true;
    generateBriefing();
  }, [entryMode, generateBriefing]);

  const askQuestion = async (question) => {
    if (!question) return;

    try {
      setAsking(true);
      setActiveQuestion(question);

      const prompt = `
You are answering a follow-up question for a new teammate inside HiveMind.
Use only the workspace context below.
Respond in 2 or 3 concise sentences.
If you reference a decision, cite its title in parentheses.

Question: ${question}

Selected decisions:
${selectedDecisions.map((decision) => `- ${decision.title || "Decision"}: ${decision.summary || decision.decision || "No summary"} | rationale: ${decision.rationale || "n/a"}`).join("\n") || "- none"}

Current blockers:
${blockerTasks.map((task) => `- ${task.title || "Blocked task"} | ${task.description || "No details yet."}`).join("\n") || "- none"}

Next work:
${nextTasks.map((task) => `- ${task.title || "Task"} | ${task.description || "No details yet."}`).join("\n") || "- none"}

Recent messages:
${recentMessages.map((message) => `- [${message.honeycombName}] ${message.sender || "User"}: ${truncateText(message.text, 180)}`).join("\n") || "- none"}
      `.trim();

      const reply = await callGeminiAPI(prompt, "gemini-2.5-flash", [], {
        hiveID,
        feature: "briefing_follow_up",
        scope: "hive",
      });

      const issue = getAIResponseIssue(reply);
      setQuestionAnswer(
        issue
          ? issue.kind === "quota"
            ? "The briefing assistant is temporarily busy because the AI provider hit its rate limit. Try again in a minute."
            : "I could not answer that from the current hive context."
          : String(reply || "").trim() || "I could not answer that from the current hive context."
      );
    } catch (error) {
      console.error("Failed to answer briefing follow-up:", error);
      setQuestionAnswer("I could not answer that from the current hive context.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <section className="glass-panel">
      <div className="chat-header gap-4">
        <div>
          <p className="text-kicker">Onboarding Brief</p>
          <h2 className="panel-title text-2xl">New Member Brief</h2>
          <p className="panel-subtitle">
            A structured handoff generated from stored decisions and recent hive activity.
          </p>
        </div>

        {entryMode ? null : (
          <button
            type="button"
            className="button-secondary"
            onClick={generateBriefing}
            disabled={loadingBriefing}
          >
            {loadingBriefing ? "Refreshing..." : "Refresh brief"}
          </button>
        )}
      </div>

      <div className="mt-6 rounded-[1.5rem] border border-cyan-300/20 bg-cyan-300/10 p-5">
        <div className="text-xs uppercase tracking-[0.18em] text-cyan-100/80">
          Generated from Hive memory
        </div>
        <h3 className="mt-3 text-2xl font-semibold text-white">
          {briefing?.welcomeTitle || `Welcome to ${hiveName}`}
        </h3>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-cyan-50/90">
          {loadingBriefing
            ? "Synthesizing the fastest path into this hive..."
            : briefing?.welcomeBody ||
              "Review the key decisions, current blockers, and what ships next before you jump into live discussion."}
        </p>

        {roomsToWatch.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {roomsToWatch.map((room) => (
              <span key={room.id} className="status-pill">
                Watch: {room.name || room.id}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6 space-y-6">
        <section>
          <div className="mb-3 text-xs uppercase tracking-[0.22em] text-slate-300/55">
            Key decisions already made
          </div>
          <div className="space-y-3">
            {selectedDecisions.length ? (
              selectedDecisions.map((decision) => (
                <article key={decision.id} className="surface-card">
                  <div className="surface-card-inner space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="panel-title">{decision.title || "Decision Record"}</div>
                        <div className="panel-subtitle">
                          Decided by {decision.ownerDisplayName || decision.createdByDisplayName || "Team"} |{" "}
                          {formatRelativeTime(
                            decision.updatedAt || decision.createdAt || decision.closedAt
                          )}{" "}
                          |{" "}
                          {roomNameLookup[
                            String(decision.honeycombID || decision.source?.honeycombID || "")
                          ] ||
                            decision.honeycombID ||
                            decision.source?.honeycombID ||
                            "Unknown room"}
                        </div>
                      </div>
                      <span className="status-pill">{decision.status || "active"}</span>
                    </div>

                    <p className="text-sm leading-7 text-slate-100">
                      {decision.summary || decision.decision || "No summary available yet."}
                    </p>

                    {decision.rationale ? (
                      <div className="hud-panel">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                          Why
                        </div>
                        <p className="mt-2 text-sm leading-7 text-white">{decision.rationale}</p>
                      </div>
                    ) : null}

                    {decision.parentMessageID || decision.source?.parentMessageID ? (
                      <button
                        type="button"
                        className="workspace-inline-link"
                        onClick={() =>
                          onOpenThread?.(
                            decision.source?.honeycombID || decision.honeycombID,
                            decision.source?.parentMessageID || decision.parentMessageID
                          )
                        }
                      >
                        Open source chat
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No decision records are stored yet.</div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 text-xs uppercase tracking-[0.22em] text-slate-300/55">
            Current issues and blockers
          </div>
          <div className="space-y-3">
            {blockerTasks.length ? (
              blockerTasks.map((task) => (
                <article key={task.id} className="surface-card">
                  <div className="surface-card-inner">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="panel-title">{task.title || "Blocked task"}</div>
                      <span className="status-pill">{task.priority || task.status || "blocked"}</span>
                    </div>
                    <p className="mt-2 text-sm leading-7 text-slate-200/85">
                      {task.description || "This workstream is currently blocked."}
                    </p>
                    {task.blockReason ? (
                      <div className="mt-3 text-sm text-rose-100/90">
                        Blocked because: {task.blockReason}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No active blockers were surfaced in the current brief.</div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 text-xs uppercase tracking-[0.22em] text-slate-300/55">
            What the team ships next
          </div>
          <div className="space-y-3">
            {nextTasks.length ? (
              nextTasks.map((task) => (
                <article key={task.id} className="surface-card">
                  <div className="surface-card-inner">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="panel-title">{task.title || "Task"}</div>
                      <span className="status-pill">{task.status || "todo"}</span>
                    </div>
                    <p className="mt-2 text-sm leading-7 text-slate-200/85">
                      {task.description || "This is part of the current execution flow."}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">The brief did not find a clear next step yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-[1.4rem] border border-cyan-300/20 bg-slate-950/35 p-4">
          <div className="text-xs uppercase tracking-[0.22em] text-cyan-100/70">
            Ask anything about this hive
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(briefing?.suggestedQuestions || []).map((question) => (
              <button
                key={question}
                type="button"
                className={`button-secondary text-sm ${
                  activeQuestion === question ? "border-cyan-200/50" : ""
                }`}
                onClick={() => askQuestion(question)}
                disabled={asking}
              >
                {question}
              </button>
            ))}
          </div>

          {activeQuestion ? (
            <div className="mt-4 hud-panel border border-cyan-300/18">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">
                {asking ? "Thinking..." : activeQuestion}
              </div>
              <p className="mt-3 text-sm leading-7 text-white">
                {asking ? "Pulling the answer from this hive's stored context..." : questionAnswer}
              </p>
            </div>
          ) : null}
        </section>

        {onEnterHive ? (
          <div className="flex justify-end">
            <button
              type="button"
              className="button-primary"
              onClick={onEnterHive}
              disabled={loadingBriefing}
            >
              Enter hive
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
