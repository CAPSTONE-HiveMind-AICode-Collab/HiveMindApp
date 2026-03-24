"use client";

import { useEffect, useMemo, useState } from "react";

const STATUSES = ["todo", "doing", "blocked", "done"];
const PRIORITIES = ["low", "medium", "high"];

function guessTitle(text) {
  const value = String(text || "").trim();
  if (!value) return "New task";
  const firstLine = value.split(/\r?\n/).find(Boolean) || value;
  return firstLine.slice(0, 80);
}

function parseChecklist(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^(\-|\*|\d+\.)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({ text: match[2].trim(), done: false }))
    .slice(0, 12);
}

export default function CreateTaskModal({
  open,
  onClose,
  onSave,
  messageText = "",
  attachmentText = "",
  members = [],
  decisionOptions = [],
  initialDecisionId = "",
  initialAssignees = [],
  titleOverride = "Create task",
  subtitleOverride = "Turn the chat context into something the team can track, assign, and ship.",
  submitLabel = "Save task",
}) {
  const initial = useMemo(() => {
    const combined = [messageText, attachmentText].filter(Boolean).join("\n\n");
    return {
      title: guessTitle(messageText) || "New Task",
      description: combined,
      checklist: parseChecklist(combined),
      status: "todo",
      priority: "medium",
      blockReason: "",
      dueDate: "",
      assignees: Array.isArray(initialAssignees) ? initialAssignees : [],
      linkedDecisionId: String(initialDecisionId || ""),
    };
  }, [attachmentText, initialAssignees, initialDecisionId, messageText]);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState(initial.status);
  const [priority, setPriority] = useState(initial.priority);
  const [blockReason, setBlockReason] = useState(initial.blockReason);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [checklist, setChecklist] = useState(initial.checklist);
  const [assignees, setAssignees] = useState(initial.assignees);
  const [linkedDecisionId, setLinkedDecisionId] = useState(initial.linkedDecisionId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initial.title);
    setDescription(initial.description);
    setStatus(initial.status);
    setPriority(initial.priority);
    setBlockReason(initial.blockReason);
    setDueDate(initial.dueDate);
    setChecklist(initial.checklist);
    setAssignees(initial.assignees);
    setLinkedDecisionId(initial.linkedDecisionId);
    setSaving(false);
  }, [initial, open]);

  if (!open) return null;

  const addChecklistItem = () => {
    setChecklist((current) => [...current, { text: "", done: false }]);
  };

  const toggleAssignee = (uid) => {
    setAssignees((current) =>
      current.includes(uid) ? current.filter((entry) => entry !== uid) : [...current, uid]
    );
  };

  const submit = async () => {
    try {
      setSaving(true);
      if (status === "blocked" && !String(blockReason || "").trim()) {
        alert("Add a blocker reason so the team knows what is holding this task up.");
        return;
      }
      const dueAt = dueDate ? new Date(`${dueDate}T23:59:59`) : null;

      await onSave({
        title: title.trim() || "New Task",
        description,
        checklist: checklist.filter((item) => String(item.text || "").trim()),
        status,
        priority,
        blockReason,
        dueAt,
        assignees,
        linkedDecisionId,
      });

      onClose?.();
    } catch (error) {
      console.error("Failed to save task:", error);
      alert("Could not save the task right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-3xl border border-cyan-300/18"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-5">
          <div className="chat-header">
            <div>
              <span className="hero-chip">Task extraction</span>
              <h2 className="panel-title mt-4 text-2xl">{titleOverride}</h2>
              <p className="panel-subtitle mt-3">
                {subtitleOverride}
              </p>
            </div>

            <button type="button" onClick={onClose} className="button-ghost">
              Close
            </button>
          </div>

          <label className="block">
            <span className="label-text">Title</span>
            <input className="input-shell" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="label-text">Status</span>
              <select className="input-shell" value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label-text">Priority</span>
              <select className="input-shell" value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map((item) => (
                  <option key={item} value={item}>
                    {item.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label-text">Due date</span>
              <input type="date" className="input-shell" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          {status === "blocked" ? (
            <label className="block">
              <span className="label-text">Why is this blocked?</span>
              <textarea
                className="textarea-shell min-h-[100px]"
                value={blockReason}
                onChange={(event) => setBlockReason(event.target.value)}
                placeholder="Waiting on another team, missing access, dependency not ready..."
              />
            </label>
          ) : null}

          {decisionOptions.length ? (
            <label className="block">
              <span className="label-text">Linked decision</span>
              <select
                className="input-shell"
                value={linkedDecisionId}
                onChange={(event) => setLinkedDecisionId(event.target.value)}
              >
                <option value="">No linked decision</option>
                {decisionOptions.map((decision) => (
                  <option key={decision.id} value={decision.id}>
                    {decision.title || "Decision Record"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {members.length ? (
            <div className="hud-panel border border-white/10">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">
                Assign to teammates
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {members.map((member) => {
                  const uid = String(member.uid || "");
                  const selected = assignees.includes(uid);
                  const label =
                    member.displayName || member.email || uid || "Team member";

                  return (
                    <button
                      key={uid}
                      type="button"
                      className={`rounded-full border px-3 py-2 text-sm transition ${
                        selected
                          ? "border-cyan-200/45 bg-cyan-300/18 text-white"
                          : "border-white/12 bg-slate-950/35 text-slate-200 hover:border-white/20"
                      }`}
                      onClick={() => toggleAssignee(uid)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="block">
            <span className="label-text">Description</span>
            <textarea
              className="textarea-shell min-h-[160px]"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <div className="hud-panel border border-white/10">
            <div className="chat-header">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">Checklist</div>
              <button type="button" onClick={addChecklistItem} className="button-ghost text-sm">
                Add item
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {checklist.length ? (
                checklist.map((item, index) => (
                  <div key={`${index}-${item.text}`} className="flex gap-2">
                    <input
                      className="input-shell"
                      value={item.text}
                      onChange={(event) =>
                        setChecklist((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, text: event.target.value } : entry
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      className="button-ghost"
                      onClick={() =>
                        setChecklist((current) => current.filter((_, entryIndex) => entryIndex !== index))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-300/70">No checklist items extracted yet.</div>
              )}
            </div>
          </div>

          <div className="action-row justify-end">
            <button type="button" onClick={onClose} className="button-ghost" disabled={saving}>
              Cancel
            </button>
            <button type="button" onClick={submit} className="button-primary" disabled={saving}>
              {saving ? "Saving..." : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
