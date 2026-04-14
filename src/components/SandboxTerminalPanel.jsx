"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  buildSandboxStreamUrl,
  resizeSandboxTerminal,
  sendSandboxTerminalInput,
  startSandboxTerminal,
  stopSandboxTerminal,
} from "@/lib/data/sandboxRepository";

function makeTerminalBadge(status) {
  if (status === "starting") {
    return "Starting";
  }

  if (status === "running") {
    return "Running";
  }

  if (status === "stopping") {
    return "Stopping";
  }

  if (status === "stopped") {
    return "Stopped";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Idle";
}

function makeTerminalTone(status) {
  if (status === "starting") {
    return "bg-cyan-300/12 text-cyan-100";
  }

  if (status === "running") {
    return "bg-emerald-300/12 text-emerald-100";
  }

  if (status === "stopping" || status === "stopped") {
    return "bg-slate-300/12 text-slate-100";
  }

  if (status === "failed") {
    return "bg-rose-300/12 text-rose-100";
  }

  return "";
}

function makeShellModeLabel(config) {
  return config?.executionMode === "docker" ? "Docker-backed" : "Host shell";
}

function getBlockedReason(config, canControlSharedSession) {
  if (!config?.enabled) {
    return "Enable the sandbox in room settings before opening a terminal.";
  }

  if (!config?.linkedProjectPath) {
    return "Link a local project path in sandbox settings before opening a terminal.";
  }

  if (!canControlSharedSession) {
    return "The current sandbox session is owned by another teammate who is still active in this file.";
  }

  return "";
}

export default function SandboxTerminalPanel({
  hiveID,
  honeycombID,
  config,
  draftCode = "",
  applyDraft = false,
  sourceMessageID = "",
  canControlSharedSession = true,
  embedded = false,
  panelHeight = "20rem",
}) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const eventSourceRef = useRef(null);
  const resizeTimerRef = useRef(null);
  const inputQueueRef = useRef("");
  const inputFlushTimerRef = useRef(null);
  const sessionIdRef = useRef("");
  const stopInCleanupRef = useRef(false);
  const terminalStatusRef = useRef("idle");
  const [terminalState, setTerminalState] = useState({
    status: "idle",
    sessionId: "",
    shellLabel: "",
    summary: "",
    workingDirectory: "",
  });

  const terminalReady = Boolean(hiveID && honeycombID);
  const blockedReason = useMemo(
    () => getBlockedReason(config, canControlSharedSession),
    [canControlSharedSession, config]
  );
  const canStartTerminal = terminalReady && !blockedReason;

  useEffect(() => {
    terminalStatusRef.current = terminalState.status;
  }, [terminalState.status]);

  const writeLocalMessage = (message, colorCode = "90") => {
    const term = terminalRef.current;
    if (!term || !message) {
      return;
    }

    const text = String(message).replace(/\r?\n/g, "\r\n");
    term.write(`\r\n\x1b[${colorCode}m${text}\x1b[0m\r\n`);
  };

  const closeTerminalStream = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

  const clearQueuedInput = () => {
    inputQueueRef.current = "";
    if (inputFlushTimerRef.current) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
  };

  const flushQueuedInput = async () => {
    inputFlushTimerRef.current = null;

    const sessionId = String(sessionIdRef.current || "").trim();
    const nextInput = inputQueueRef.current;
    inputQueueRef.current = "";

    if (!sessionId || !nextInput) {
      return;
    }

    try {
      await sendSandboxTerminalInput({
        hiveID,
        sessionId,
        input: nextInput,
      });
    } catch (error) {
      writeLocalMessage(
        String(error?.message || "Could not send input to the sandbox terminal."),
        "91"
      );
      setTerminalState((current) => ({
        ...current,
        status: "failed",
        summary: String(error?.message || "Terminal input failed."),
      }));
    }
  };

  const scheduleInputFlush = () => {
    if (inputFlushTimerRef.current) {
      return;
    }

    inputFlushTimerRef.current = window.setTimeout(() => {
      void flushQueuedInput();
    }, 24);
  };

  const sendResize = async () => {
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const sessionId = String(sessionIdRef.current || "").trim();

    if (!term || !fitAddon) {
      return;
    }

    fitAddon.fit();

    if (!sessionId) {
      return;
    }

    try {
      await resizeSandboxTerminal({
        hiveID,
        sessionId,
        cols: term.cols,
        rows: term.rows,
      });
    } catch {
      // Ignore resize drift while the terminal is shutting down.
    }
  };

  const scheduleResize = () => {
    if (resizeTimerRef.current) {
      window.clearTimeout(resizeTimerRef.current);
    }

    resizeTimerRef.current = window.setTimeout(() => {
      void sendResize();
    }, 120);
  };

  const focusTerminal = () => {
    terminalRef.current?.focus();
  };

  const openTerminalStream = async (sessionId) => {
    closeTerminalStream();

    const streamUrl = await buildSandboxStreamUrl(sessionId, "terminal");
    const source = new EventSource(streamUrl);
    eventSourceRef.current = source;

    source.addEventListener("output", (event) => {
      const payload = JSON.parse(event.data);
      if (payload?.text) {
        terminalRef.current?.write(String(payload.text));
      }
    });

    source.addEventListener("meta", (event) => {
      const payload = JSON.parse(event.data);
      setTerminalState((current) => ({
        ...current,
        shellLabel: payload.shellLabel || current.shellLabel,
        workingDirectory: payload.cwd || current.workingDirectory,
      }));
    });

    source.addEventListener("status", (event) => {
      const payload = JSON.parse(event.data);
      setTerminalState((current) => ({
        ...current,
        status: payload.status || current.status,
        summary: payload.summary || current.summary,
      }));
    });

    source.addEventListener("done", (event) => {
      const payload = JSON.parse(event.data);
      setTerminalState((current) => ({
        ...current,
        status: payload.status || (payload.success ? "stopped" : "failed"),
        summary: payload.summary || current.summary,
      }));
      sessionIdRef.current = "";
      source.close();
    });

    source.addEventListener("error", () => {
      setTerminalState((current) => {
        if (!["starting", "running", "stopping"].includes(current.status)) {
          return current;
        }

        writeLocalMessage(
          "The terminal stream disconnected before the sandbox session finished.",
          "91"
        );

        return {
          ...current,
          status: "failed",
          summary:
            current.summary ||
            "The terminal stream disconnected before the sandbox session finished.",
        };
      });

      sessionIdRef.current = "";
      source.close();
    });
  };

  const handleStart = async () => {
    if (!canStartTerminal) {
      return;
    }

    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) {
      return;
    }

    if (terminalState.status === "running" && sessionIdRef.current) {
      focusTerminal();
      return;
    }

    try {
      closeTerminalStream();
      clearQueuedInput();
      term.clear();
      fitAddon.fit();

      setTerminalState({
        status: "starting",
        sessionId: "",
        shellLabel: "",
        summary: "",
        workingDirectory: "",
      });

      const payload = await startSandboxTerminal({
        hiveID,
        honeycombID,
        config,
        draftCode,
        applyDraft,
        sourceMessageID,
        cols: term.cols,
        rows: term.rows,
      });

      sessionIdRef.current = String(payload?.sessionId || "").trim();
      stopInCleanupRef.current = Boolean(sessionIdRef.current);
      setTerminalState({
        status: "running",
        sessionId: sessionIdRef.current,
        shellLabel: String(payload?.shellLabel || ""),
        summary: `Attached to ${payload?.shellLabel || makeShellModeLabel(config)}.`,
        workingDirectory: String(payload?.workingDirectory || ""),
      });

      await openTerminalStream(sessionIdRef.current);
      focusTerminal();
      scheduleResize();
    } catch (error) {
      sessionIdRef.current = "";
      stopInCleanupRef.current = false;
      writeLocalMessage(
        String(error?.message || "Could not start the sandbox terminal."),
        "91"
      );
      setTerminalState((current) => ({
        ...current,
        status: "failed",
        summary: String(error?.message || "Could not start the sandbox terminal."),
      }));
    }
  };

  const handleStop = async (
    reason = "Terminal stopped.",
    { silent = false, fromCleanup = false } = {}
  ) => {
    const activeSessionId = String(sessionIdRef.current || "").trim();
    clearQueuedInput();
    closeTerminalStream();

    if (!activeSessionId) {
      if (!silent) {
        setTerminalState((current) => ({
          ...current,
          status: "stopped",
          summary: reason,
        }));
      }
      return;
    }

    sessionIdRef.current = "";
    stopInCleanupRef.current = false;

    try {
      await stopSandboxTerminal({
        hiveID,
        sessionId: activeSessionId,
        reason,
      });
    } catch (error) {
      if (!fromCleanup) {
        writeLocalMessage(
          String(error?.message || "Could not stop the sandbox terminal cleanly."),
          "91"
        );
      }
    } finally {
      if (!silent) {
        setTerminalState((current) => ({
          ...current,
          status: "stopped",
          summary: reason,
        }));
      }
    }
  };

  const handleRestart = async () => {
    if (sessionIdRef.current) {
      await handleStop("Terminal restarting...");
    }

    await handleStart();
  };

  const handleClear = () => {
    terminalRef.current?.clear();
    focusTerminal();
  };

  useEffect(() => {
    const term = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        '"Fira Code", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.22,
      scrollback: 4000,
      theme: {
        background: "rgba(3, 10, 23, 0.82)",
        foreground: "#e8eef9",
        cursor: "#7ae7d8",
        cursorAccent: "#09111f",
        black: "#09111f",
        red: "#ff8f8f",
        green: "#7ef0c9",
        yellow: "#f6c869",
        blue: "#80bfff",
        magenta: "#d4a7ff",
        cyan: "#7ae7d8",
        white: "#e8eef9",
        brightBlack: "#4b5a75",
        brightRed: "#ffb0a8",
        brightGreen: "#b6ffd9",
        brightYellow: "#ffe1a6",
        brightBlue: "#b2d7ff",
        brightMagenta: "#e5c6ff",
        brightCyan: "#b5fff4",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    if (hostRef.current) {
      hostRef.current.innerHTML = "";
    }
    term.open(hostRef.current);
    fitAddon.fit();
    term.writeln("\x1b[90mStart the sandbox terminal to run real commands inside the workspace copy.\x1b[0m");

    const dataDisposable = term.onData((data) => {
      if (!sessionIdRef.current || !["running", "stopping"].includes(terminalStatusRef.current)) {
        return;
      }

      inputQueueRef.current += data;
      scheduleInputFlush();
    });

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });

    if (hostRef.current) {
      observer.observe(hostRef.current);
    }

    return () => {
      dataDisposable.dispose();
      observer.disconnect();
      closeTerminalStream();
      clearQueuedInput();
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }
      if (stopInCleanupRef.current && sessionIdRef.current) {
        void handleStop("Terminal stopped because the workspace changed.", {
          silent: true,
          fromCleanup: true,
        });
      }
      term.dispose();
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (blockedReason && sessionIdRef.current) {
      void handleStop("Terminal stopped because sandbox access changed.");
    }
  }, [blockedReason]);

  const terminalControls = (
    <div className="flex w-full min-w-0 max-w-full flex-wrap items-start gap-2">
      <span className={`status-pill ${makeTerminalTone(terminalState.status)}`}>
        {makeTerminalBadge(terminalState.status)}
      </span>
      <span className="status-pill">{makeShellModeLabel(config)}</span>
      {terminalState.shellLabel ? (
        <span className="status-pill">{terminalState.shellLabel}</span>
      ) : null}
      {applyDraft && config?.targetFilePath ? (
        <span className="status-pill">Draft synced: {config.targetFilePath}</span>
      ) : (
        <span className="status-pill">Repo root shell</span>
      )}
      <button
        type="button"
        className="button-secondary text-sm"
        onClick={handleClear}
      >
        Clear
      </button>
      <button
        type="button"
        className="button-secondary text-sm"
        onClick={handleRestart}
        disabled={!canStartTerminal || terminalState.status === "starting"}
      >
        Restart
      </button>
      <button
        type="button"
        className="button-ghost text-sm"
        onClick={() => handleStop("Terminal stopped.")}
        disabled={!sessionIdRef.current && terminalState.status !== "running"}
      >
        Stop
      </button>
      <button
        type="button"
        className="button-primary text-sm"
        onClick={handleStart}
        disabled={!canStartTerminal || terminalState.status === "starting"}
      >
        {terminalState.status === "running" ? "Focus terminal" : "Start terminal"}
      </button>
    </div>
  );

  const terminalSummary = terminalState.summary ? (
    <div className="border-b border-white/8 px-5 py-3 text-sm text-slate-300/80">
      <div className="min-w-0 break-words">
        {terminalState.summary}
        {terminalState.workingDirectory ? (
          <span className="ml-2 break-all text-slate-400">{terminalState.workingDirectory}</span>
        ) : null}
      </div>
    </div>
  ) : null;

  const terminalSurface = (
    <div className="min-w-0 max-w-full px-5 py-5">
      <div className="sandbox-terminal overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#030a17]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/8 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          <span>Sandbox shell</span>
          <span className="min-w-0 truncate text-right">
            {terminalState.sessionId || "No active session"}
          </span>
        </div>
        <div
          ref={hostRef}
          className="min-w-0 max-w-full w-full overflow-hidden px-3 py-3"
          style={{ height: panelHeight }}
          onClick={focusTerminal}
        />
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="min-w-0 max-w-full overflow-x-hidden">
        <div className="border-b border-white/10 px-5 py-4">{terminalControls}</div>
        {blockedReason ? (
          <div className="border-b border-amber-300/18 bg-amber-300/8 px-5 py-3 text-sm text-amber-100">
            {blockedReason}
          </div>
        ) : null}
        {terminalSummary}
        {terminalSurface}
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden rounded-[1.35rem] border border-white/10 bg-slate-950/40">
      <div className="chat-header gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/60">
            Interactive terminal
          </div>
          <div className="mt-2 text-sm text-slate-300/75">
            Real shell access runs inside the sandbox workspace copy, so you can execute language
            tools and see native errors without touching the linked repo directly.
          </div>
        </div>

        {terminalControls}
      </div>

      {blockedReason ? (
        <div className="border-b border-amber-300/18 bg-amber-300/8 px-5 py-3 text-sm text-amber-100">
          {blockedReason}
        </div>
      ) : null}

      {terminalSummary}
      {terminalSurface}
    </div>
  );
}
