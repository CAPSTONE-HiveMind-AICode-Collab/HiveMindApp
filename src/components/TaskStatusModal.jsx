"use client";

import { useEffect, useState } from "react";

export default function TaskStatusModal({
  open,
  taskTitle = "",
  nextStatus = "",
  initialBlockReason = "",
  onClose,
  onSave,
}) {
  const [blockReason, setBlockReason] = useState(initialBlockReason);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBlockReason(initialBlockReason || "");
    setSaving(false);
  }, [initialBlockReason, open]);

  if (!open) return null;

  const submit = async () => {
    try {
      setSaving(true);
      if (nextStatus === "blocked" && !String(blockReason || "").trim()) {
        alert("Add a blocker reason so the team knows what is holding this task up.");
        return;
      }

      await onSave?.({
        nextStatus,
        blockReason: String(blockReason || "").trim(),
      });
      onClose?.();
    } catch (error) {
      console.error("Failed to update task status:", error);
      alert("Could not update the task right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-2xl border border-cyan-300/18"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-5">
          <div className="chat-header">
            <div>
              <span className="hero-chip">Task update</span>
              <h2 className="panel-title mt-4 text-2xl">Move task to {nextStatus}</h2>
              <p className="panel-subtitle mt-3">
                {taskTitle || "This task"} is being updated. Capture the blocker clearly before the team loses context.
              </p>
            </div>

            <button type="button" onClick={onClose} className="button-ghost">
              Close
            </button>
          </div>

          <label className="block">
            <span className="label-text">Blocker reason</span>
            <textarea
              className="textarea-shell min-h-[140px]"
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              placeholder="Waiting on dependency, access request, review, upstream fix..."
            />
          </label>

          <div className="action-row justify-end">
            <button type="button" onClick={onClose} className="button-ghost" disabled={saving}>
              Cancel
            </button>
            <button type="button" onClick={submit} className="button-primary" disabled={saving}>
              {saving ? "Saving..." : "Update status"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
