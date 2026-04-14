"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteDecisionRecord } from "@/lib/data/decisionRepository";

const TIME_OPTIONS = [
  { id: "all", label: "All time" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
];

function formatDate(value) {
  if (!value) return "No date";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString();
}

function toMillis(value) {
  if (!value) return 0;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function matchesQuery(record, query) {
  if (!query) return true;

  const haystack = [
    record.title,
    record.summary,
    record.decision,
    record.rationale,
    record.ownerDisplayName,
    record.createdByDisplayName,
    record.honeycombID,
    record.supersedesDecisionId,
    record.supersededByDecisionId,
    ...(Array.isArray(record.tags) ? record.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function getDecisionAuthor(record) {
  return record.ownerDisplayName || record.createdByDisplayName || "Unknown author";
}

function getDecisionRoom(record, roomNameById = {}) {
  const roomId = String(record.honeycombID || record.source?.honeycombID || "");
  return roomNameById[roomId] || roomId || "Unknown room";
}

function getDecisionLinkState(record) {
  const honeycombID = record.source?.honeycombID || record.honeycombID;
  const parentMessageID = record.source?.parentMessageID || record.parentMessageID;

  return {
    honeycombID,
    parentMessageID,
    available: Boolean(honeycombID && parentMessageID),
  };
}

export default function DecisionMemoryPanel({
  hiveID,
  decisions = [],
  onOpenThread,
  onOpenTasksTab,
  highlightDecisionId = "",
  roomNameById = {},
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [localHighlightId, setLocalHighlightId] = useState("");
  const [removingDecisionId, setRemovingDecisionId] = useState("");
  const decisionTitleMap = useMemo(
    () => new Map(decisions.map((record) => [String(record.id), record.title || "Decision Record"])),
    [decisions]
  );
  const roomOptions = useMemo(() => {
    const seen = new Set();
    return decisions
      .map((record) => ({
        id: String(record.honeycombID || record.source?.honeycombID || ""),
        label: getDecisionRoom(record, roomNameById),
      }))
      .filter((room) => {
        if (!room.id || seen.has(room.id)) return false;
        seen.add(room.id);
        return true;
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [decisions, roomNameById]);
  const activeHighlightId = localHighlightId || highlightDecisionId;

  const filteredDecisions = useMemo(
    () => {
      const cutoff =
        timeFilter === "week"
          ? Date.now() - 1000 * 60 * 60 * 24 * 7
          : timeFilter === "month"
          ? Date.now() - 1000 * 60 * 60 * 24 * 30
          : 0;

      return decisions.filter((record) => {
        const roomId = String(record.honeycombID || record.source?.honeycombID || "");
        const roomMatches = roomFilter === "all" ? true : roomId === roomFilter;
        const timeMatches = cutoff
          ? toMillis(record.updatedAt || record.createdAt || record.closedAt) >= cutoff
          : true;

        return roomMatches && timeMatches && matchesQuery(record, searchQuery);
      });
    },
    [decisions, roomFilter, searchQuery, timeFilter]
  );

  useEffect(() => {
    if (!highlightDecisionId) return;
    setLocalHighlightId("");
    setExpandedId(highlightDecisionId);

    const frame = window.requestAnimationFrame(() => {
      const el = document.getElementById(`decision-record-${highlightDecisionId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [highlightDecisionId]);

  const focusDecision = (decisionId) => {
    if (!decisionId) return;
    setSearchQuery("");
    setRoomFilter("all");
    setTimeFilter("all");
    setExpandedId(decisionId);
    setLocalHighlightId(decisionId);

    window.requestAnimationFrame(() => {
      const el = document.getElementById(`decision-record-${decisionId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const removeDecision = async (record) => {
    if (!record?.id || !hiveID) return;

    const confirmed = window.confirm(
      `Remove "${record.title || "this decision"}" from the decision log?`
    );
    if (!confirmed) return;

    try {
      setRemovingDecisionId(record.id);
      await deleteDecisionRecord({
        hiveID,
        decisionID: record.id,
      });
      setExpandedId((current) => (current === record.id ? null : current));
      setLocalHighlightId((current) => (String(current) === String(record.id) ? "" : current));
    } catch (error) {
      console.error("Failed to remove decision record:", error);
      alert("Could not remove the decision right now.");
    } finally {
      setRemovingDecisionId("");
    }
  };

  return (
    <section className="glass-panel">
      <div className="chat-header gap-4">
        <div>
          <p className="text-kicker">Decision log</p>
          <h2 className="panel-title text-2xl">Recorded team decisions</h2>
          <p className="panel-subtitle">
            Live records from closed threads and Hive memory extraction, each linked back to the source chat.
          </p>
        </div>
        <span className="status-pill">
          {filteredDecisions.length === 1 ? "1 decision" : `${filteredDecisions.length} decisions`}
        </span>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr),220px,220px]">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search decisions, rationale, rooms..."
          className="input-shell"
        />
        <select
          value={roomFilter}
          onChange={(event) => setRoomFilter(event.target.value)}
          className="input-shell"
        >
          <option value="all">All rooms</option>
          {roomOptions.map((room) => (
            <option key={room.id} value={room.id}>
              {room.label}
            </option>
          ))}
        </select>
        <select
          value={timeFilter}
          onChange={(event) => setTimeFilter(event.target.value)}
          className="input-shell"
        >
          {TIME_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {filteredDecisions.length === 0 ? (
        <div className="empty-state mt-6">
          No decision records match this filter yet. Close a thread or log a decision from chat to populate this view.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {filteredDecisions.map((record) => {
            const linkState = getDecisionLinkState(record);
            const isExpanded = expandedId === record.id;

            return (
              <article
                id={`decision-record-${record.id}`}
                key={record.id}
                className={`surface-card ${
                  String(activeHighlightId || "") === String(record.id)
                    ? "ring-2 ring-cyan-300/35"
                    : ""
                }`}
              >
                <div className="surface-card-inner space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="panel-title">{record.title || "Decision Record"}</h3>
                        <span className="status-pill capitalize">
                          {record.status || "draft"}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-7 text-slate-100">
                        {record.decision || record.summary || "No decision text is stored yet."}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="button-ghost text-sm"
                      onClick={() =>
                        setExpandedId((current) => (current === record.id ? null : record.id))
                      }
                    >
                      {isExpanded ? "Hide detail" : "View detail"}
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="metric-card">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                        Author
                      </div>
                      <div className="mt-3 text-sm text-white">{getDecisionAuthor(record)}</div>
                    </div>
                    <div className="metric-card">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                        Room
                      </div>
                      <div className="mt-3 text-sm text-white">
                        {getDecisionRoom(record, roomNameById)}
                      </div>
                    </div>
                    <div className="metric-card">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                        Updated
                      </div>
                      <div className="mt-3 text-sm text-white">
                        {formatDate(record.updatedAt || record.createdAt || record.closedAt)}
                      </div>
                    </div>
                    <div className="metric-card">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
                        Linked tasks
                      </div>
                      <div className="mt-3 text-sm text-white">
                        {Array.isArray(record.linkedTaskIds) ? record.linkedTaskIds.length : 0}
                      </div>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="hud-panel border border-cyan-300/16">
                      <div className="text-xs uppercase tracking-[0.18em] text-cyan-100/75">
                        Rationale
                      </div>
                      <p className="mt-3 text-sm leading-7 text-white">
                        {record.rationale || "No rationale was captured for this record yet."}
                      </p>

                      {Array.isArray(record.tags) && record.tags.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {record.tags.map((tag) => (
                            <span key={`${record.id}-${tag}`} className="status-pill">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {record.supersedesDecisionId ? (
                        <div className="mt-4 text-xs uppercase tracking-[0.18em] text-slate-300/70">
                          Replaces decision:{" "}
                          <button
                            type="button"
                            className="workspace-inline-link"
                            onClick={() => focusDecision(record.supersedesDecisionId)}
                          >
                            {decisionTitleMap.get(String(record.supersedesDecisionId)) ||
                              record.supersedesDecisionId}
                          </button>
                        </div>
                      ) : null}

                      {record.supersededByDecisionId ? (
                        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-300/70">
                          Replaced by:{" "}
                          <button
                            type="button"
                            className="workspace-inline-link"
                            onClick={() => focusDecision(record.supersededByDecisionId)}
                          >
                            {decisionTitleMap.get(String(record.supersededByDecisionId)) ||
                              record.supersededByDecisionId}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="action-row">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenThread?.(linkState.honeycombID, linkState.parentMessageID)
                      }
                      className="button-primary"
                      disabled={!linkState.available}
                    >
                      View chat
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenTasksTab?.(record.id)}
                      className="button-secondary"
                    >
                      Related tasks
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDecision(record)}
                      disabled={removingDecisionId === record.id}
                      className="button-ghost"
                    >
                      {removingDecisionId === record.id ? "Removing..." : "Remove decision"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
