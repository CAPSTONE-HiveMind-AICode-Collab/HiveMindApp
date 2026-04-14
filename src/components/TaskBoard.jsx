"use client";

import { useMemo, useState } from "react";
import CreateTaskModal from "@/components/CreateTaskModal";
import TaskStatusModal from "@/components/TaskStatusModal";
import { createTaskRecord, deleteTaskRecord, updateTaskRecord } from "@/lib/data/taskRepository";

const BOARD_COLUMNS = [
  { id: "todo", label: "To Do" },
  { id: "doing", label: "Doing" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

function formatDate(value) {
  if (!value) return "No due date";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString();
}

function buildMemberMap(members) {
  return Object.fromEntries(
    (members || []).map((member) => [
      member.uid,
      member.displayName || member.email || member.uid,
    ])
  );
}

export default function TaskBoard({
  hiveID,
  tasks = [],
  members = [],
  decisions = [],
  currentUser = null,
  filterDecisionId = "",
  onClearDecisionFilter,
  onOpenSource,
  onOpenDecision,
}) {
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [updatingTaskId, setUpdatingTaskId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [statusModalTask, setStatusModalTask] = useState(null);
  const [statusModalTarget, setStatusModalTarget] = useState("");
  const memberMap = useMemo(() => buildMemberMap(members), [members]);
  const decisionLookup = useMemo(
    () => new Map(decisions.map((decision) => [String(decision.id), decision])),
    [decisions]
  );
  const decisionOptions = useMemo(
    () =>
      decisions.map((decision) => ({
        id: decision.id,
        title: decision.title || "Decision Record",
        summary: decision.summary || decision.decision || "",
      })),
    [decisions]
  );

  const groupedTasks = useMemo(() => {
    const groups = Object.fromEntries(BOARD_COLUMNS.map((column) => [column.id, []]));
    const visibleTasks = filterDecisionId
      ? tasks.filter((task) => String(task.linkedDecisionId || "") === String(filterDecisionId))
      : tasks;

    for (const task of visibleTasks) {
      const status = BOARD_COLUMNS.some((column) => column.id === task.status)
        ? task.status
        : "todo";
      groups[status].push(task);
    }

    return groups;
  }, [filterDecisionId, tasks]);

  const moveTask = async (taskID, nextStatus) => {
    try {
      const task = tasks.find((entry) => String(entry.id) === String(taskID)) || null;
      if (nextStatus === "blocked") {
        setStatusModalTask(task);
        setStatusModalTarget(nextStatus);
        return;
      }

      setUpdatingTaskId(taskID);
      await updateTaskRecord({
        hiveID,
        taskID,
        patch: {
          status: nextStatus,
          blockReason: "",
        },
      });
    } catch (error) {
      console.error("Failed to update task status:", error);
      alert("Could not move the task right now.");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const saveTaskStatus = async ({ nextStatus, blockReason }) => {
    if (!statusModalTask?.id || !nextStatus) return;

    try {
      setUpdatingTaskId(statusModalTask.id);
      await updateTaskRecord({
        hiveID,
        taskID: statusModalTask.id,
        patch: {
          status: nextStatus,
          blockReason: nextStatus === "blocked" ? blockReason : "",
        },
      });
      setStatusModalTask(null);
      setStatusModalTarget("");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const createTask = async ({
    title,
    description,
    checklist,
    status,
    priority,
    blockReason,
    dueAt,
    assignees,
    linkedDecisionId,
  }) => {
    const linkedDecision =
      decisions.find((decision) => String(decision.id) === String(linkedDecisionId || "")) || null;

    await createTaskRecord({
      hiveID,
      title,
      description,
      checklist,
      status,
      priority,
      blockReason,
      dueAt,
      assignees,
      createdBy: currentUser?.uid,
      linkedDecisionId: linkedDecision?.id || "",
      linkedDecisionTitle: linkedDecision?.title || "",
      sourcePreview: linkedDecision
        ? {
            decisionTitle: linkedDecision.title || "",
            decisionSummary: linkedDecision.summary || linkedDecision.decision || "",
          }
        : null,
    });
  };

  const editTask = async ({
    title,
    description,
    checklist,
    status,
    priority,
    blockReason,
    dueAt,
    assignees,
    linkedDecisionId,
  }) => {
    if (!editingTask?.id) return;

    const linkedDecision =
      decisions.find((decision) => String(decision.id) === String(linkedDecisionId || "")) || null;

    await updateTaskRecord({
      hiveID,
      taskID: editingTask.id,
      patch: {
        title: String(title || "").trim() || "New Task",
        description: String(description || ""),
        checklist: Array.isArray(checklist) ? checklist : [],
        status,
        priority,
        blockReason,
        dueAt,
        assignees,
        linkedDecisionId: linkedDecision?.id || "",
        linkedDecisionTitle: linkedDecision?.title || "",
        sourcePreview: linkedDecision
          ? {
              ...(editingTask.sourcePreview || {}),
              decisionTitle: linkedDecision.title || "",
              decisionSummary: linkedDecision.summary || linkedDecision.decision || "",
            }
          : {
              ...(editingTask.sourcePreview || {}),
              decisionTitle: "",
              decisionSummary: "",
            },
      },
    });
  };

  const removeDoneTask = async (task) => {
    if (!task?.id) return;
    const confirmed = window.confirm(
      `Remove "${task.title || "this task"}" from Done? This deletes the task record.`
    );
    if (!confirmed) return;

    try {
      setUpdatingTaskId(task.id);
      await deleteTaskRecord({ hiveID, taskID: task.id });
    } catch (error) {
      console.error("Failed to remove done task:", error);
      alert("Could not remove the task right now.");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  return (
    <section className="glass-panel">
      <div className="chat-header gap-4">
        <div>
          <p className="text-kicker">Execution</p>
          <h2 className="panel-title text-2xl">Task Board</h2>
          <p className="panel-subtitle">
            Track what the team decided to do, what is blocked, and why each task exists.
          </p>
        </div>
        <div className="action-row">
          <span className="status-pill">
            {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}
          </span>
          <button
            type="button"
            className="button-primary"
            onClick={() => setCreateModalOpen(true)}
            disabled={!currentUser?.uid}
          >
            New task
          </button>
        </div>
      </div>

      {filterDecisionId ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-cyan-300/18 bg-cyan-300/10 p-4">
          <div className="text-sm text-cyan-50">
            Showing tasks linked to{" "}
            <strong>{decisionLookup.get(String(filterDecisionId))?.title || "selected decision"}</strong>
          </div>
          <button type="button" className="button-ghost" onClick={onClearDecisionFilter}>
            Clear filter
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-4">
        {BOARD_COLUMNS.map((column) => (
          <section key={column.id} className="rounded-[1.75rem] border border-white/10 bg-slate-950/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-200">
                {column.label}
              </h3>
              <span className="status-pill">
                {groupedTasks[column.id]?.length || 0}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {groupedTasks[column.id]?.length ? (
                groupedTasks[column.id].map((task) => {
                  const isExpanded = expandedTaskId === task.id;
                  const assigneeNames = (task.assignees || [])
                    .map((uid) => memberMap[uid] || uid)
                    .filter(Boolean);

                  return (
                    <article key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white">{task.title || "Untitled task"}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            {task.description || "No description provided."}
                          </p>
                        </div>
                        <span className="status-pill uppercase">{task.priority || "medium"}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                        <span className="status-pill">Due: {formatDate(task.dueAt)}</span>
                        <span className="status-pill">
                          {assigneeNames.length ? assigneeNames.join(", ") : "Unassigned"}
                        </span>
                        {task.linkedDecisionTitle ? (
                          <span className="status-pill">Decision: {task.linkedDecisionTitle}</span>
                        ) : null}
                      </div>

                      {task.blockReason ? (
                        <div className="mt-3 rounded-2xl border border-rose-300/18 bg-rose-300/10 p-3 text-sm text-rose-50">
                          Blocked because: {task.blockReason}
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        {BOARD_COLUMNS.filter((option) => option.id !== column.id).map((option) => (
                          <button
                            key={`${task.id}-${option.id}`}
                            type="button"
                            onClick={() => moveTask(task.id, option.id)}
                            disabled={updatingTaskId === task.id}
                            className="button-ghost text-xs"
                          >
                            Move to {option.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTaskId((current) => (current === task.id ? null : task.id))
                          }
                          className="button-secondary text-sm"
                        >
                          {isExpanded ? "Hide Why" : "Why are we doing this?"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSource?.(task.source?.honeycombID, task.source?.messageID)
                          }
                          disabled={!task.source?.honeycombID || !task.source?.messageID}
                          className="button-primary text-sm"
                        >
                          Open source thread
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenDecision?.(task.linkedDecisionId)}
                          disabled={!task.linkedDecisionId}
                          className="button-secondary text-sm"
                        >
                          View decision
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTask(task)}
                          className="button-secondary text-sm"
                        >
                          Edit task
                        </button>
                        {String(task.status || "").toLowerCase() === "done" ? (
                          <button
                            type="button"
                            onClick={() => removeDoneTask(task)}
                            disabled={updatingTaskId === task.id}
                            className="button-ghost text-sm"
                          >
                            {updatingTaskId === task.id ? "Removing..." : "Remove task"}
                          </button>
                        ) : null}
                        {String(task.status || "").toLowerCase() === "blocked" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setStatusModalTask(task);
                              setStatusModalTarget("blocked");
                            }}
                            className="button-ghost text-sm"
                          >
                            Edit blocker
                          </button>
                        ) : null}
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">
                            Traceability
                          </div>
                          <p className="mt-2 text-sm leading-7 text-white">
                            {task.sourcePreview?.decisionSummary ||
                              task.sourcePreview?.parentMessageText ||
                              "This task was created from a workspace discussion."}
                          </p>

                          <div className="mt-3 space-y-1 text-xs text-cyan-50/85">
                            <div>
                              Source message:{" "}
                              {task.source?.messageID ? String(task.source.messageID).slice(0, 10) : "n/a"}
                            </div>
                            <div>
                              Thread: {task.source?.threadID ? String(task.source.threadID).slice(0, 10) : "n/a"}
                            </div>
                            <div>
                              Decision: {task.linkedDecisionTitle || task.sourcePreview?.decisionTitle || "n/a"}
                            </div>
                            <div>Blocked reason: {task.blockReason || "n/a"}</div>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className="empty-state">No tasks in {column.label.toLowerCase()}.</div>
              )}
            </div>
          </section>
        ))}
      </div>

      <CreateTaskModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSave={createTask}
        members={members}
        decisionOptions={decisionOptions}
        titleOverride="Create workspace task"
        subtitleOverride="Plan work directly from the board, assign owners, and optionally connect it to a stored decision."
        submitLabel="Create task"
      />

      <CreateTaskModal
        open={Boolean(editingTask)}
        onClose={() => setEditingTask(null)}
        onSave={editTask}
        members={members}
        decisionOptions={decisionOptions}
        initialTask={editingTask}
        titleOverride="Edit task"
        subtitleOverride="Update task details, owners, status, and linked decision."
        submitLabel="Save changes"
      />

      <TaskStatusModal
        open={Boolean(statusModalTask)}
        taskTitle={statusModalTask?.title || ""}
        nextStatus={statusModalTarget}
        initialBlockReason={statusModalTask?.blockReason || ""}
        onClose={() => {
          setStatusModalTask(null);
          setStatusModalTarget("");
        }}
        onSave={saveTaskStatus}
      />
    </section>
  );
}
