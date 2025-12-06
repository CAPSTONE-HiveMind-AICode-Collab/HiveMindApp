"use client";

import { useEffect, useMemo, useState } from "react";

const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["low", "medium", "high"];

function guessTitle(text) {
  const t = String(text || "").trim();
  if (!t) return "Task from message";
  const firstLine = t.split(/\r?\n/).find(Boolean) || t;
  return firstLine.slice(0, 80);
}

function parseChecklist(text) {
  const lines = String(text || "").split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    const m = line.match(/^(\-|\*|\d+\.)\s+(.*)$/);
    if (m && m[2]?.trim()) items.push({ text: m[2].trim(), done: false });
  }
  return items.slice(0, 15);
}

export default function CreateTaskModal({
  open,
  onClose,
  onSave,
  messageText = "",
  attachmentText = "",
}) {
  const initial = useMemo(() => {
    const combined = [messageText, attachmentText].filter(Boolean).join("\n\n");
    return {
      title: guessTitle(messageText),
      description: combined,
      checklist: parseChecklist(combined),
      status: "todo",
      priority: "medium",
      dueDate: "",
    };
  }, [messageText, attachmentText]);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState(initial.status);
  const [priority, setPriority] = useState(initial.priority);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [checklist, setChecklist] = useState(initial.checklist);
  const [saving, setSaving] = useState(false);

  // reset state every time the modal opens / message changes
  useEffect(() => {
    if (!open) return;
    setTitle(initial.title);
    setDescription(initial.description);
    setStatus(initial.status);
    setPriority(initial.priority);
    setDueDate(initial.dueDate);
    setChecklist(initial.checklist);
    setSaving(false);
  }, [open, initial]);

  if (!open) return null;

  const addChecklistItem = () =>
    setChecklist((prev) => [...prev, { text: "", done: false }]);

  const removeChecklistItem = (idx) =>
    setChecklist((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    try {
      setSaving(true);

      // date-only -> end of day local time
      const dueAt = dueDate ? new Date(`${dueDate}T23:59:59`) : null;

      await onSave({
        title: title.trim() || "New Task",
        description: description || "",
        checklist: checklist.filter((c) => String(c.text || "").trim()),
        status,
        priority,
        dueAt,
      });

      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-gray-200">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">Create Task from Message</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <div className="text-sm font-semibold mb-1">Title</div>
            <input
              className="w-full border border-gray-300 rounded p-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm font-semibold mb-1">Status</div>
              <select
                className="w-full border border-gray-300 rounded p-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="text-sm font-semibold mb-1">Priority</div>
              <select
                className="w-full border border-gray-300 rounded p-2"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <div className="text-sm font-semibold mb-1">Due date (optional)</div>
            <input
              type="date"
              className="border border-gray-300 rounded p-2"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="text-sm font-semibold mb-1">Description</div>
            <textarea
              className="w-full border border-gray-300 rounded p-2 min-h-[120px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="border border-gray-200 rounded p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Checklist</div>
              <button
                type="button"
                onClick={addChecklistItem}
                className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
              >
                + Add
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {checklist.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    className="flex-1 border border-gray-300 rounded p-2 text-sm"
                    value={item.text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setChecklist((prev) =>
                        prev.map((c, i) => (i === idx ? { ...c, text: val } : c))
                      );
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(idx)}
                    className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                  >
                    🗑️
                  </button>
                </div>
              ))}
              {checklist.length === 0 && (
                <div className="text-xs text-gray-500">No checklist items yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-4 py-2 rounded bg-yellow-500 text-white font-semibold hover:bg-yellow-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
