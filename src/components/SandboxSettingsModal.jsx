"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SANDBOX_CONFIG,
  normalizePathList,
  normalizeSandboxConfig,
} from "@/lib/sandbox/config";

export default function SandboxSettingsModal({
  open,
  onClose,
  onSave,
  config = DEFAULT_SANDBOX_CONFIG,
  saving = false,
}) {
  const [form, setForm] = useState(normalizeSandboxConfig(config));

  useEffect(() => {
    if (!open) return;
    setForm(normalizeSandboxConfig(config));
  }, [config, open]);

  if (!open) return null;

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async () => {
    await onSave?.({
      ...form,
      allowedPaths: normalizePathList(form.allowedPaths),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="glass-panel flex max-h-[min(92vh,70rem)] w-full max-w-4xl flex-col overflow-hidden border border-cyan-300/18"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-header flex-shrink-0 border-b border-white/10 pb-4">
            <div>
              <span className="hero-chip">Sandbox setup</span>
              <h2 className="panel-title mt-4 text-2xl">Developer sandbox settings</h2>
              <p className="panel-subtitle mt-3">
                Link this room to a local project, choose the target file, and define the safe
                commands the team can run.
              </p>
            </div>

            <button type="button" onClick={onClose} className="button-ghost">
              Close
            </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
            <label className="hud-panel border border-white/10">
              <span className="label-text">Sandbox status</span>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">
                    {form.enabled ? "Enabled for this room" : "Disabled for this room"}
                  </div>
                  <div className="mt-1 text-sm text-slate-300/75">
                    Turn this on once the linked project path and commands are ready.
                  </div>
                </div>

                <button
                  type="button"
                  className={form.enabled ? "button-primary" : "button-secondary"}
                  onClick={() => updateField("enabled", !form.enabled)}
                >
                  {form.enabled ? "On" : "Off"}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="label-text">Primary runtime</span>
              <select
                className="input-shell"
                value={form.runtime}
                onChange={(event) => updateField("runtime", event.target.value)}
              >
                <option value="react">Web / Node</option>
                <option value="python">Python</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="label-text">Linked project path</span>
              <input
                className="input-shell font-mono text-sm"
                value={form.linkedProjectPath}
                onChange={(event) => updateField("linkedProjectPath", event.target.value)}
                placeholder="C:\\projects\\my-app"
              />
            </label>

            <label className="block">
              <span className="label-text">Repo label</span>
              <input
                className="input-shell"
                value={form.repoLabel}
                onChange={(event) => updateField("repoLabel", event.target.value)}
                placeholder="my-app"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="label-text">Default branch</span>
              <input
                className="input-shell"
                value={form.defaultBranch}
                onChange={(event) => updateField("defaultBranch", event.target.value)}
                placeholder="main"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="label-text">Target file path</span>
              <input
                className="input-shell font-mono text-sm"
                value={form.targetFilePath}
                onChange={(event) => updateField("targetFilePath", event.target.value)}
                placeholder="src/auth/Login.jsx"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="label-text">Execution mode</span>
              <select
                className="input-shell"
                value={form.executionMode}
                onChange={(event) => updateField("executionMode", event.target.value)}
              >
                <option value="docker">Docker</option>
                <option value="host">Host process</option>
              </select>
            </label>

            <label className="block">
              <span className="label-text">Docker image override</span>
              <input
                className="input-shell font-mono text-sm"
                value={form.dockerImage}
                onChange={(event) => updateField("dockerImage", event.target.value)}
                placeholder="node:20-bullseye or python:3.12-slim"
              />
            </label>
          </div>

          <label className="block">
            <span className="label-text">Allowed project paths</span>
            <textarea
              className="textarea-shell min-h-[96px] font-mono text-sm"
              value={Array.isArray(form.allowedPaths) ? form.allowedPaths.join("\n") : form.allowedPaths}
              onChange={(event) => updateField("allowedPaths", event.target.value)}
              placeholder={".\n# or narrow it later with src\ntests"}
            />
            <p className="mt-2 text-xs text-slate-300/70">
              Use <span className="font-mono text-slate-100">.</span> to expose the whole repo to
              mentions, file browsing, and sandbox opens. Narrow this list only if you want to
              limit the room to specific folders.
            </p>
          </label>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="hud-panel border border-white/10">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">
                Python commands
              </div>

              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="label-text">Run command</span>
                  <input
                    className="input-shell font-mono text-sm"
                    value={form.pythonRunCommand}
                    onChange={(event) => updateField("pythonRunCommand", event.target.value)}
                    placeholder="python main.py"
                  />
                </label>

                <label className="block">
                  <span className="label-text">Test command</span>
                  <input
                    className="input-shell font-mono text-sm"
                    value={form.pythonTestCommand}
                    onChange={(event) => updateField("pythonTestCommand", event.target.value)}
                    placeholder="python -m pytest tests/test_auth.py"
                  />
                </label>

                <label className="block">
                  <span className="label-text">Preview command</span>
                  <input
                    className="input-shell font-mono text-sm"
                    value={form.pythonPreviewCommand}
                    onChange={(event) => updateField("pythonPreviewCommand", event.target.value)}
                    placeholder="streamlit run {file} --server.port {port} --server.address 127.0.0.1 --server.headless true"
                  />
                  <p className="mt-2 text-xs text-slate-300/70">
                    Optional. Use this for visual Python apps like Streamlit, Gradio, Flask, or
                    Dash. Leave it blank to fall back to the Python run command when the file looks
                    previewable.
                  </p>
                </label>
              </div>
            </div>

            <div className="hud-panel border border-white/10">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">
                Web / Node commands
              </div>

              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="label-text">Build command</span>
                  <input
                    className="input-shell font-mono text-sm"
                    value={form.reactBuildCommand}
                    onChange={(event) => updateField("reactBuildCommand", event.target.value)}
                    placeholder="npm run build"
                  />
                </label>

                <label className="block">
                  <span className="label-text">Test command</span>
                  <input
                    className="input-shell font-mono text-sm"
                    value={form.reactTestCommand}
                    onChange={(event) => updateField("reactTestCommand", event.target.value)}
                    placeholder="npm test -- Login"
                  />
                </label>

                <label className="block">
                  <span className="label-text">Preview command</span>
                  <input
                    className="input-shell font-mono text-sm"
                    value={form.reactPreviewCommand}
                    onChange={(event) => updateField("reactPreviewCommand", event.target.value)}
                    placeholder="npm run dev -- --host 127.0.0.1 --port {port}"
                  />
                  <p className="mt-2 text-xs text-slate-300/70">
                    Optional. Leave this blank to use the built-in static preview for direct web and
                    document files like HTML, SVG, Markdown, JSON, YAML, and CSS-like files.
                  </p>
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="label-text">Preview port</span>
                    <input
                      className="input-shell font-mono text-sm"
                      value={form.previewPort}
                      onChange={(event) => updateField("previewPort", event.target.value)}
                      placeholder="4173"
                    />
                  </label>

                  <label className="block">
                    <span className="label-text">Preview route</span>
                    <input
                      className="input-shell font-mono text-sm"
                      value={form.previewRoute}
                      onChange={(event) => updateField("previewRoute", event.target.value)}
                      placeholder="/"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          </div>
        </div>

        <div className="mt-5 flex flex-shrink-0 flex-wrap justify-end gap-3 border-t border-white/10 pt-4">
          <button type="button" className="button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} className="button-primary" disabled={saving}>
            {saving ? "Saving..." : "Save sandbox settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
