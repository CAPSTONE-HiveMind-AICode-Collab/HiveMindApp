"use client";

import { useEffect, useMemo, useState } from "react";

const STATUS_OPTIONS = ["draft", "active", "superseded", "archived"];

function firstLine(value, fallback = "Decision Record") {
  return (
    String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || fallback
  );
}

function summarize(value, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

export default function LogDecisionModal({
  open,
  onClose,
  onSave,
  messageText = "",
  decisionOptions = [],
  submitLabel = "Log decision",
}) {
  const initial = useMemo(
    () => ({
      title: firstLine(messageText, "Logged decision"),
      summary: summarize(messageText, 220),
      rationale: "Confirmed from chat and promoted into the hive's decision memory.",
      decision: String(messageText || "").trim(),
      status: "active",
      supersedesDecisionId: "",
    }),
    [messageText]
  );

  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [rationale, setRationale] = useState(initial.rationale);
  const [decision, setDecision] = useState(initial.decision);
  const [status, setStatus] = useState(initial.status);
  const [supersedesDecisionId, setSupersedesDecisionId] = useState(initial.supersedesDecisionId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initial.title);
    setSummary(initial.summary);
    setRationale(initial.rationale);
    setDecision(initial.decision);
    setStatus(initial.status);
    setSupersedesDecisionId(initial.supersedesDecisionId);
    setSaving(false);
  }, [initial, open]);

  if (!open) return null;

  const submit = async () => {
    try {
      setSaving(true);
      await onSave({
        title: title.trim() || "Decision Record",
        summary: summary.trim(),
        rationale: rationale.trim(),
        decision: decision.trim(),
        status,
        supersedesDecisionId,
      });
      onClose?.();
    } catch (error) {
      console.error("Failed to save decision:", error);
      alert("Could not log the decision right now.");
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
        className="glass-panel w-full max-w-3xl border border-amber-300/18"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-5">
          <div className="chat-header">
            <div>
              <span className="hero-chip">Decision review</span>
              <h2 className="panel-title mt-4 text-2xl">Log decision from message</h2>
              <p className="panel-subtitle mt-3">
                Confirm the final call before it becomes part of the hive's long-term memory.
              </p>
            </div>

            <button type="button" onClick={onClose} className="button-ghost">
              Close
            </button>
          </div>

          <label className="block">
            <span className="label-text">Title</span>
            <input
              className="input-shell"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),220px]">
            <label className="block">
              <span className="label-text">Summary</span>
              <textarea
                className="textarea-shell min-h-[120px]"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="label-text">Status</span>
              <select
                className="input-shell"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {decisionOptions.length ? (
            <label className="block">
              <span className="label-text">Supersedes decision</span>
              <select
                className="input-shell"
                value={supersedesDecisionId}
                onChange={(event) => setSupersedesDecisionId(event.target.value)}
              >
                <option value="">Does not replace an earlier decision</option>
                {decisionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title || "Decision Record"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="label-text">Why this was chosen</span>
            <textarea
              className="textarea-shell min-h-[120px]"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="label-text">Final decision</span>
            <textarea
              className="textarea-shell min-h-[160px]"
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
            />
          </label>

          <div className="hud-panel border border-white/10">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">
              Source message
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-100">
              {messageText || "No source message was provided."}
            </p>
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
