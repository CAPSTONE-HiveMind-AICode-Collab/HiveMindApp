import path from "path";
import { promises as fs } from "fs";
import { spawn as spawnChild } from "child_process";
import * as pty from "node-pty";
import {
  appendSandboxOutput,
  completeSandboxSession,
  getSandboxSession,
  markSandboxRunning,
  mergeSandboxSessionMeta,
  pushSandboxSessionEvent,
} from "@/lib/server/sandbox/sessionStore";
import {
  getSandboxRunnerImage,
  normalizeSandboxConfig,
} from "@/lib/sandbox/config";

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 32;
const TERMINAL_TERM = "xterm-256color";
const terminalStoreKey = "__hivemindSandboxTerminals__";
const terminalStore = globalThis[terminalStoreKey] || new Map();

if (!globalThis[terminalStoreKey]) {
  globalThis[terminalStoreKey] = terminalStore;
}

function sanitizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInsideParent(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative ? !relative.startsWith("..") && !path.isAbsolute(relative) : true;
}

function ensureAllowedTarget(config, relativeTargetPath) {
  if (!relativeTargetPath) {
    throw new Error("Choose a target file path in sandbox settings before running.");
  }

  const normalizedTarget = sanitizeRelativePath(relativeTargetPath);
  const allowedRoots = Array.isArray(config.allowedPaths) ? config.allowedPaths : [];
  if (!allowedRoots.length) {
    return normalizedTarget;
  }

  const allowed = allowedRoots.some((entry) => {
    const prefix = sanitizeRelativePath(entry);
    if (!prefix || prefix === ".") {
      return true;
    }

    return normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`);
  });

  if (!allowed) {
    throw new Error("That file is outside this room's allowed sandbox paths.");
  }

  return normalizedTarget;
}

async function ensureDirectoryExists(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function copyWorkspace(repoPath, repoCopyPath) {
  await ensureDirectoryExists(path.dirname(repoCopyPath));
  await fs.cp(repoPath, repoCopyPath, {
    recursive: true,
    force: true,
  });
}

async function removeWorkspace(sessionRoot) {
  if (!sessionRoot) {
    return;
  }

  await fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});
}

function clampTerminalDimension(value, fallback, minimum, maximum) {
  const numericValue = Number(value || fallback);
  if (!Number.isInteger(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(numericValue, minimum), maximum);
}

function normalizeTerminalSize(size = {}) {
  return {
    cols: clampTerminalDimension(size.cols, DEFAULT_TERMINAL_COLS, 40, 240),
    rows: clampTerminalDimension(size.rows, DEFAULT_TERMINAL_ROWS, 12, 120),
  };
}

function resolveHostShell() {
  const configuredShell = String(process.env.HIVEMIND_SANDBOX_SHELL || "").trim();
  if (configuredShell) {
    return {
      command: configuredShell,
      args: [],
      label: configuredShell,
    };
  }

  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo"],
      label: "PowerShell",
    };
  }

  const shellCommand = String(process.env.SHELL || "/bin/sh").trim() || "/bin/sh";
  return {
    command: shellCommand,
    args: [],
    label: path.basename(shellCommand),
  };
}

function buildDockerTerminalArgs({ repoCopyPath, config, containerName }) {
  return [
    "run",
    "--rm",
    "--init",
    "-it",
    "--name",
    containerName,
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "768m",
    "-e",
    `TERM=${TERMINAL_TERM}`,
    "-w",
    "/workspace/repo",
    "-v",
    `${repoCopyPath}:/workspace/repo`,
    getSandboxRunnerImage(config),
    "sh",
    "-lc",
    "if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh -i; fi",
  ];
}

function buildTerminalContainerName({ hiveID = "", honeycombID = "", sessionId = "" }) {
  const rawKey =
    [String(hiveID || "").trim(), String(honeycombID || "").trim(), String(sessionId || "").trim()]
      .filter(Boolean)
      .join("-") || "terminal";

  const safeId = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `hivemind-terminal-${safeId || "session"}`;
}

async function removeDockerContainer(containerName) {
  const safeName = String(containerName || "").trim();
  if (!safeName) {
    return;
  }

  await new Promise((resolve, reject) => {
    const remover = spawnChild("docker", ["rm", "-f", safeName], {
      windowsHide: true,
      env: {
        ...process.env,
      },
    });

    let stderr = "";
    remover.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    remover.on("error", reject);
    remover.on("close", (exitCode) => {
      if (
        Number(exitCode) === 0 ||
        /No such container|is not running|cannot find/i.test(stderr)
      ) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || "Could not remove Docker terminal container."));
    });
  });
}

async function killProcessTree(pid) {
  const numericPid = Number(pid || 0);
  if (!numericPid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const killer = spawnChild("taskkill", ["/PID", String(numericPid), "/T", "/F"], {
        windowsHide: true,
      });
      let stderr = "";

      killer.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      killer.on("error", reject);
      killer.on("close", (exitCode) => {
        if (Number(exitCode) === 0 || /not found|no running instance/i.test(stderr)) {
          resolve();
          return;
        }

        reject(new Error(stderr || `Could not stop terminal process ${numericPid}.`));
      });
    });
    return;
  }

  try {
    process.kill(numericPid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

async function prepareTerminalWorkspace(config, sessionId, { draftCode = "", applyDraft = false } = {}) {
  if (!config.enabled) {
    throw new Error("Enable the sandbox in room settings before starting a terminal.");
  }

  if (!config.linkedProjectPath) {
    throw new Error("Link a local project path in sandbox settings before starting a terminal.");
  }

  const repoPath = path.resolve(config.linkedProjectPath);
  const repoStats = await fs.stat(repoPath).catch(() => null);
  if (!repoStats?.isDirectory()) {
    throw new Error("The linked project path does not exist on this machine.");
  }

  const workspacesRoot = path.join(process.cwd(), ".sandbox-workspaces");
  const sessionRoot = path.join(workspacesRoot, sessionId);
  const repoCopyPath = path.join(sessionRoot, "repo");

  await copyWorkspace(repoPath, repoCopyPath);

  let relativeTargetPath = "";
  if (applyDraft && config.targetFilePath) {
    relativeTargetPath = ensureAllowedTarget(config, config.targetFilePath);
    const targetCopyPath = path.resolve(repoCopyPath, relativeTargetPath);

    if (!isInsideParent(repoCopyPath, targetCopyPath)) {
      throw new Error("The sandbox target file escaped the workspace root.");
    }

    await ensureDirectoryExists(path.dirname(targetCopyPath));
    await fs.writeFile(targetCopyPath, String(draftCode || ""), "utf8");
  }

  return {
    repoPath,
    sessionRoot,
    repoCopyPath,
    relativeTargetPath,
  };
}

function createTerminalPty({
  config,
  repoCopyPath,
  cols,
  rows,
  containerName,
}) {
  if (config.executionMode === "docker") {
    return {
      process: pty.spawn(
        "docker",
        buildDockerTerminalArgs({ repoCopyPath, config, containerName }),
        {
          name: TERMINAL_TERM,
          cols,
          rows,
          cwd: repoCopyPath,
          env: {
            ...process.env,
            TERM: TERMINAL_TERM,
          },
        }
      ),
      shellLabel: `${getSandboxRunnerImage(config)} shell`,
    };
  }

  const hostShell = resolveHostShell();
  return {
    process: pty.spawn(hostShell.command, hostShell.args, {
      name: TERMINAL_TERM,
      cols,
      rows,
      cwd: repoCopyPath,
      env: {
        ...process.env,
        TERM: TERMINAL_TERM,
      },
    }),
    shellLabel: hostShell.label,
  };
}

function getLiveTerminalSession(sessionId) {
  return terminalStore.get(String(sessionId || "").trim()) || null;
}

function flushBufferedTerminalOutput(sessionId) {
  const liveSession = getLiveTerminalSession(sessionId);
  if (!liveSession?.outputBuffer) {
    return;
  }

  if (liveSession.outputTimer) {
    clearTimeout(liveSession.outputTimer);
    liveSession.outputTimer = null;
  }

  appendSandboxOutput(sessionId, liveSession.outputBuffer, "terminal");
  liveSession.outputBuffer = "";
}

function queueTerminalOutput(sessionId, chunk) {
  const liveSession = getLiveTerminalSession(sessionId);
  if (!liveSession) {
    return;
  }

  liveSession.outputBuffer += String(chunk || "");
  if (liveSession.outputTimer) {
    return;
  }

  liveSession.outputTimer = setTimeout(() => {
    flushBufferedTerminalOutput(sessionId);
  }, 32);
}

async function finalizeTerminalSession(sessionId, result = {}) {
  const liveSession = getLiveTerminalSession(sessionId);
  flushBufferedTerminalOutput(sessionId);
  if (liveSession) {
    terminalStore.delete(sessionId);
  }

  const session = getSandboxSession(sessionId, { fresh: true });
  if (session && !session.finalized) {
    completeSandboxSession(sessionId, {
      success: Boolean(result.success),
      exitCode:
        result.exitCode === undefined || result.exitCode === null ? null : Number(result.exitCode),
      summary: String(result.summary || "Terminal session ended."),
      status: String(result.status || (result.success ? "stopped" : "failed")),
    });
  }

  if (liveSession?.containerName) {
    await removeDockerContainer(liveSession.containerName).catch(() => {});
  }

  await removeWorkspace(liveSession?.sessionRoot || result.sessionRoot || "");
}

function buildTerminalSummary({ exitCode = null, stopReason = "", signal = 0, shellLabel = "" }) {
  if (stopReason) {
    return stopReason;
  }

  if (exitCode === 0) {
    return `${shellLabel || "Terminal"} session closed.`;
  }

  if (exitCode === null || exitCode === undefined) {
    return `${shellLabel || "Terminal"} session ended before completion.`;
  }

  if (signal) {
    return `${shellLabel || "Terminal"} session stopped by signal ${signal}.`;
  }

  return `${shellLabel || "Terminal"} session exited with code ${exitCode}.`;
}

export async function startSandboxTerminalSession(
  sessionId,
  { config: rawConfig, draftCode = "", applyDraft = false, cols, rows } = {}
) {
  const config = normalizeSandboxConfig(rawConfig);
  const terminalSize = normalizeTerminalSize({ cols, rows });
  let workspace = null;

  try {
    const sessionMeta = getSandboxSession(sessionId, { fresh: true })?.meta || {};
    workspace = await prepareTerminalWorkspace(config, sessionId, {
      draftCode,
      applyDraft,
    });

    const containerName =
      config.executionMode === "docker"
        ? buildTerminalContainerName({
            hiveID: sessionMeta.hiveID,
            honeycombID: sessionMeta.honeycombID,
            sessionId,
          })
        : "";

    if (containerName) {
      await removeDockerContainer(containerName).catch(() => {});
    }

    const terminal = createTerminalPty({
      config,
      repoCopyPath: workspace.repoCopyPath,
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      containerName,
    });

    terminalStore.set(sessionId, {
      sessionId,
      ptyProcess: terminal.process,
      pid: Number(terminal.process.pid || 0) || null,
      sessionRoot: workspace.sessionRoot,
      repoCopyPath: workspace.repoCopyPath,
      containerName,
      shellLabel: terminal.shellLabel,
      executionMode: config.executionMode,
      stopRequested: false,
      stopReason: "",
      outputBuffer: "",
      outputTimer: null,
    });

    appendSandboxOutput(
      sessionId,
      `[HiveMind] Workspace copied to ${workspace.repoCopyPath}\n[HiveMind] Terminal attached in ${workspace.repoCopyPath}\n`,
      "system"
    );
    markSandboxRunning(sessionId, {
      kind: "terminal",
      shellLabel: terminal.shellLabel,
      targetFilePath: workspace.relativeTargetPath || config.targetFilePath || "",
      repoLabel: config.repoLabel || path.basename(workspace.repoPath),
      runtime: config.runtime,
      executionMode: config.executionMode,
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      cwd: workspace.repoCopyPath,
      sessionRoot: workspace.sessionRoot,
      pid: Number(terminal.process.pid || 0) || null,
      containerName,
    });
    pushSandboxSessionEvent(sessionId, "status", {
      status: "running",
      summary: `${terminal.shellLabel} ready in sandbox workspace.`,
      timestamp: Date.now(),
    });

    terminal.process.onData((data) => {
      queueTerminalOutput(sessionId, data);
    });

    terminal.process.onExit(({ exitCode, signal }) => {
      const liveSession = getLiveTerminalSession(sessionId);
      const summary = buildTerminalSummary({
        exitCode,
        signal,
        stopReason: liveSession?.stopReason || "",
        shellLabel: liveSession?.shellLabel || terminal.shellLabel,
      });

      void finalizeTerminalSession(sessionId, {
        success: Boolean(liveSession?.stopRequested) || Number(exitCode) === 0,
        exitCode,
        summary,
        status: Boolean(liveSession?.stopRequested) || Number(exitCode) === 0 ? "stopped" : "failed",
        sessionRoot: workspace?.sessionRoot || "",
      });
    });

    return {
      shellLabel: terminal.shellLabel,
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      workingDirectory: workspace.repoCopyPath,
    };
  } catch (error) {
    appendSandboxOutput(sessionId, `${String(error?.message || error)}\n`, "stderr");
    await finalizeTerminalSession(sessionId, {
      success: false,
      exitCode: null,
      summary: String(error?.message || "Could not start the sandbox terminal."),
      status: "failed",
      sessionRoot: workspace?.sessionRoot || "",
    });
    throw error;
  }
}

export async function writeSandboxTerminalInput(sessionId, input) {
  const liveSession = getLiveTerminalSession(sessionId);
  if (!liveSession?.ptyProcess) {
    throw new Error("Terminal session is no longer active.");
  }

  const text = String(input || "");
  if (!text) {
    return { success: true };
  }

  liveSession.ptyProcess.write(text);
  return { success: true };
}

export async function resizeSandboxTerminalSession(sessionId, size = {}) {
  const liveSession = getLiveTerminalSession(sessionId);
  if (!liveSession?.ptyProcess) {
    throw new Error("Terminal session is no longer active.");
  }

  const nextSize = normalizeTerminalSize(size);
  liveSession.ptyProcess.resize(nextSize.cols, nextSize.rows);
  mergeSandboxSessionMeta(sessionId, nextSize);

  return {
    success: true,
    cols: nextSize.cols,
    rows: nextSize.rows,
  };
}

export async function stopSandboxTerminalSession(
  sessionId,
  { reason = "Terminal stopped." } = {}
) {
  const liveSession = getLiveTerminalSession(sessionId);
  if (!liveSession) {
    const session = getSandboxSession(sessionId, { fresh: true });
    if (session && !session.finalized) {
      completeSandboxSession(sessionId, {
        success: true,
        exitCode: null,
        summary: String(reason || "Terminal stopped."),
        status: "stopped",
      });
    }

    return {
      success: true,
      stopped: false,
    };
  }

  liveSession.stopRequested = true;
  liveSession.stopReason = String(reason || "Terminal stopped.");
  pushSandboxSessionEvent(sessionId, "status", {
    status: "stopping",
    summary: liveSession.stopReason,
    timestamp: Date.now(),
  });

  await killProcessTree(liveSession.pid || liveSession.ptyProcess.pid).catch(() => {
    liveSession.ptyProcess.kill();
  });

  if (liveSession.containerName) {
    await removeDockerContainer(liveSession.containerName).catch(() => {});
  }

  return {
    success: true,
    stopped: true,
  };
}
