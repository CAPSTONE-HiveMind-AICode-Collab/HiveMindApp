import path from "path";
import { promises as fs } from "fs";
import { createServer } from "net";
import { spawn } from "child_process";
import { setTimeout as delay } from "timers/promises";
import {
  appendSandboxOutput,
  completeSandboxSession,
  getSandboxSession,
  markSandboxRunning,
  mergeSandboxSessionMeta,
  pushSandboxSessionEvent,
} from "@/lib/server/sandbox/sessionStore";
import {
  canUseSandboxPreview,
  getSandboxPreviewCommand,
  getSandboxPreviewRoute,
  getSandboxRunCommand,
  getSandboxRunnerImage,
  normalizeSandboxConfig,
} from "@/lib/sandbox/config";
import { detectSandboxLanguage } from "@/lib/sandbox/fileSupport";

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
  if (!allowedRoots.length) return normalizedTarget;

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

function isIgnoredEntry(name) {
  return [
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "coverage",
    ".turbo",
  ].includes(String(name || ""));
}

async function walkDirectory(rootPath, currentPath, collector, limit) {
  if (collector.length >= limit) {
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (collector.length >= limit) {
      return;
    }

    if (isIgnoredEntry(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = sanitizeRelativePath(path.relative(rootPath, absolutePath));

    if (entry.isDirectory()) {
      await walkDirectory(rootPath, absolutePath, collector, limit);
      continue;
    }

    if (entry.isFile()) {
        collector.push({
          path: relativePath,
          language: detectSandboxLanguage(relativePath),
        });
      }
  }
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

function buildDockerArgs({ repoCopyPath, config, command }) {
  return [
    "run",
    "--rm",
    "--init",
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "-w",
    "/workspace/repo",
    "-v",
    `${repoCopyPath}:/workspace/repo`,
    getSandboxRunnerImage(config),
    "sh",
    "-lc",
    command,
  ];
}

function buildDockerPreviewArgs({ repoCopyPath, config, command, previewPort, containerName }) {
  return [
    "run",
    "--rm",
    "--init",
    ...(containerName ? ["--name", containerName] : []),
    "--cpus",
    "1",
    "--memory",
    "768m",
    "-e",
    `PORT=${previewPort}`,
    "-e",
    "HOST=0.0.0.0",
    "-e",
    "BROWSER=none",
    "-p",
    `${previewPort}:${previewPort}`,
    "-w",
    "/workspace/repo",
    "-v",
    `${repoCopyPath}:/workspace/repo`,
    getSandboxRunnerImage(config),
    "sh",
    "-lc",
    command,
  ];
}

function buildPreviewContainerName({ hiveID = "", honeycombID = "", targetFilePath = "", sessionId = "" }) {
  const rawKey =
    [String(hiveID || "").trim(), String(honeycombID || "").trim(), sanitizeRelativePath(targetFilePath)]
      .filter(Boolean)
      .join("-") || String(sessionId || "preview");

  const safeId = rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `hivemind-preview-${safeId || "session"}`;
}

function buildSummary(command, exitCode, success) {
  if (success) {
    return `Command passed: ${command}`;
  }

  if (exitCode === null || exitCode === undefined) {
    return `Command failed before completion: ${command}`;
  }

  return `Command exited with code ${exitCode}: ${command}`;
}

function normalizePreviewRoute(value) {
  const route = String(value || "/").trim() || "/";
  return route.startsWith("/") ? route : `/${route}`;
}

function parsePreferredPort(value, fallback = 4173) {
  const numericValue = Number(value || fallback);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 65535) {
    return fallback;
  }

  return numericValue;
}

function buildPreviewUrl(port, previewRoute) {
  return `http://127.0.0.1:${port}${normalizePreviewRoute(previewRoute)}`;
}

function waitForMs(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

function normalizeDockerPreviewCommand(command, previewPort) {
  let nextCommand = String(command || "").trim();
  if (!nextCommand) {
    return "";
  }

  nextCommand = nextCommand.replace(
    /--host(?:=|\s+)(127\.0\.0\.1|localhost)\b/gi,
    "--host 0.0.0.0"
  );
  nextCommand = nextCommand.replace(
    /--server\.address(?:=|\s+)(127\.0\.0\.1|localhost)\b/gi,
    "--server.address 0.0.0.0"
  );
  nextCommand = nextCommand.replace(
    /--bind(?:=|\s+)(127\.0\.0\.1|localhost)(:\d+)?\b/gi,
    (_match, _host, portSuffix = previewPort ? `:${previewPort}` : "") =>
      `--bind 0.0.0.0${portSuffix}`
  );
  nextCommand = nextCommand.replace(
    /\brunserver\s+(127\.0\.0\.1|localhost):(\d+)\b/gi,
    (_match, _host, portValue) => `runserver 0.0.0.0:${portValue}`
  );

  return nextCommand;
}

async function claimPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();

    server.once("error", (error) => {
      reject(error);
    });

    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const resolvedPort =
        typeof address === "object" && address ? Number(address.port || port) : Number(port);
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(resolvedPort);
      });
    });
  });
}

async function findAvailablePort(preferredPort) {
  const startPort = parsePreferredPort(preferredPort);

  for (let offset = 0; offset < 20; offset += 1) {
    const nextPort = startPort + offset;
    try {
      return await claimPort(nextPort);
    } catch {
      // try the next port
    }
  }

  return claimPort(0);
}

async function waitForPreviewReady({ sessionId, previewUrl, child, timeoutMs = 20000 }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const session = getSandboxSession(sessionId, { fresh: true });
    if (!session || session.finalized) {
      return false;
    }

    if (child.exitCode !== null || child.killed) {
      return false;
    }

    try {
      const response = await fetch(previewUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(2500),
      });

      if (response.ok || [301, 302, 303, 307, 308, 404].includes(response.status)) {
        return true;
      }
    } catch {
      // keep waiting while the preview server starts
    }

    await delay(500);
  }

  return false;
}

async function killProcessTree(pid) {
  const numericPid = Number(pid || 0);
  if (!numericPid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const killer = spawn("taskkill", ["/PID", String(numericPid), "/T", "/F"], {
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

        reject(new Error(stderr || `Could not stop preview process ${numericPid}.`));
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

function createChildProcess({
  config,
  repoCopyPath,
  command,
  previewPort = null,
  sessionId = "",
  previewContainerName = "",
}) {
  if (config.executionMode === "host") {
    return spawn(command, {
      cwd: repoCopyPath,
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        BROWSER: "none",
        HOST: "127.0.0.1",
        ...(previewPort ? { PORT: String(previewPort) } : {}),
      },
    });
  }

  const containerName = previewPort ? String(previewContainerName || "").trim() : "";

  return spawn(
    "docker",
    previewPort
      ? buildDockerPreviewArgs({
          repoCopyPath,
          config,
          command,
          previewPort,
          containerName,
        })
      : buildDockerArgs({ repoCopyPath, config, command }),
    {
      cwd: repoCopyPath,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
      },
    }
  );
}

async function removeDockerContainer(containerName) {
  const safeName = String(containerName || "").trim();
  if (!safeName) {
    return;
  }

  await new Promise((resolve, reject) => {
    const remover = spawn("docker", ["rm", "-f", safeName], {
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
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
      reject(new Error(stderr.trim() || "Could not remove Docker preview container."));
    });
  });
}

async function prepareSandboxWorkspace(config, sessionId, draftCode) {
  if (!config.enabled) {
    throw new Error("Enable the sandbox in room settings before running code.");
  }

  if (!config.linkedProjectPath) {
    throw new Error("Link a local project path in sandbox settings before running code.");
  }

  const repoPath = path.resolve(config.linkedProjectPath);
  const repoStats = await fs.stat(repoPath).catch(() => null);
  if (!repoStats?.isDirectory()) {
    throw new Error("The linked project path does not exist on this machine.");
  }

  const relativeTargetPath = ensureAllowedTarget(config, config.targetFilePath);
  const workspacesRoot = path.join(process.cwd(), ".sandbox-workspaces");
  const sessionRoot = path.join(workspacesRoot, sessionId);
  const repoCopyPath = path.join(sessionRoot, "repo");
  const targetCopyPath = path.resolve(repoCopyPath, relativeTargetPath);

  if (!isInsideParent(repoCopyPath, targetCopyPath)) {
    throw new Error("The sandbox target file escaped the workspace root.");
  }

  await copyWorkspace(repoPath, repoCopyPath);
  await ensureDirectoryExists(path.dirname(targetCopyPath));
  await fs.writeFile(targetCopyPath, String(draftCode || ""), "utf8");

  return {
    repoPath,
    sessionRoot,
    repoCopyPath,
    targetCopyPath,
    relativeTargetPath,
  };
}

export async function readLinkedProjectFile({
  linkedProjectPath,
  targetFilePath,
  allowedPaths = [],
}) {
  const repoPath = path.resolve(String(linkedProjectPath || ""));
  const relativeTargetPath = ensureAllowedTarget(
    { allowedPaths },
    sanitizeRelativePath(targetFilePath)
  );

  if (!repoPath || repoPath === process.cwd()) {
    throw new Error("Add a linked project path in sandbox settings first.");
  }

  const targetPath = path.resolve(repoPath, relativeTargetPath);
  if (!isInsideParent(repoPath, targetPath)) {
    throw new Error("Target file path must stay inside the linked project.");
  }

  const content = await fs.readFile(targetPath, "utf8");
  return {
    content,
    language: detectSandboxLanguage(relativeTargetPath),
    targetFilePath: relativeTargetPath,
  };
}

export async function writeLinkedProjectFile({ config: rawConfig, draftCode }) {
  const config = normalizeSandboxConfig(rawConfig);

  if (!config.enabled) {
    throw new Error("Enable the sandbox in room settings before saving code.");
  }

  if (!config.linkedProjectPath) {
    throw new Error("Link a local project path in sandbox settings before saving code.");
  }

  const repoPath = path.resolve(String(config.linkedProjectPath || ""));
  const repoStats = await fs.stat(repoPath).catch(() => null);
  if (!repoStats?.isDirectory()) {
    throw new Error("The linked project path does not exist on this machine.");
  }

  const relativeTargetPath = ensureAllowedTarget(config, config.targetFilePath);
  const targetPath = path.resolve(repoPath, relativeTargetPath);

  if (!isInsideParent(repoPath, targetPath)) {
    throw new Error("The target file path escaped the linked project.");
  }

  await ensureDirectoryExists(path.dirname(targetPath));
  await fs.writeFile(targetPath, String(draftCode || ""), "utf8");

  return {
    targetFilePath: relativeTargetPath,
    language: detectSandboxLanguage(relativeTargetPath),
    savedAt: Date.now(),
  };
}

export async function listLinkedProjectFiles({ linkedProjectPath, allowedPaths = [] }) {
  const repoPath = path.resolve(String(linkedProjectPath || ""));
  if (!linkedProjectPath) {
    throw new Error("Add a linked project path in sandbox settings first.");
  }

  const repoStats = await fs.stat(repoPath).catch(() => null);
  if (!repoStats?.isDirectory()) {
    throw new Error("The linked project path does not exist on this machine.");
  }

  const allowedRoots =
    Array.isArray(allowedPaths) && allowedPaths.length > 0 ? allowedPaths : ["."];
  const files = [];

  for (const entry of allowedRoots) {
    const relativeRoot = sanitizeRelativePath(entry);
    const absoluteRoot = relativeRoot ? path.resolve(repoPath, relativeRoot) : repoPath;

    if (!isInsideParent(repoPath, absoluteRoot)) {
      continue;
    }

    const stats = await fs.stat(absoluteRoot).catch(() => null);
    if (!stats?.isDirectory()) {
      continue;
    }

    await walkDirectory(repoPath, absoluteRoot, files, 400);
  }

  return files
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 400);
}

export async function runSandboxSession(sessionId, { config: rawConfig, draftCode }) {
  const config = normalizeSandboxConfig(rawConfig);
  const command = getSandboxRunCommand(config);
  let sessionRoot = "";

  try {
    if (!command) {
      throw new Error("Add a run or test command in sandbox settings before starting a session.");
    }

    const workspace = await prepareSandboxWorkspace(config, sessionId, draftCode);
    sessionRoot = workspace.sessionRoot;

    appendSandboxOutput(
      sessionId,
      `[HiveMind] Workspace copied to ${workspace.repoCopyPath}\n[HiveMind] Running ${command}\n`,
      "system"
    );
    markSandboxRunning(sessionId, {
      command,
      kind: "run",
      targetFilePath: workspace.relativeTargetPath,
      repoLabel: config.repoLabel || path.basename(workspace.repoPath),
      runtime: config.runtime,
      executionMode: config.executionMode,
    });

    const child = createChildProcess({
      config,
      repoCopyPath: workspace.repoCopyPath,
      command,
      sessionId,
    });

    child.stdout?.on("data", (chunk) => {
      appendSandboxOutput(sessionId, chunk.toString(), "stdout");
    });

    child.stderr?.on("data", (chunk) => {
      appendSandboxOutput(sessionId, chunk.toString(), "stderr");
    });

    child.on("error", async (error) => {
      appendSandboxOutput(sessionId, `${String(error?.message || error)}\n`, "stderr");
      completeSandboxSession(sessionId, {
        success: false,
        exitCode: null,
        summary: buildSummary(command, null, false),
      });
      await removeWorkspace(sessionRoot);
    });

    child.on("close", async (exitCode) => {
      completeSandboxSession(sessionId, {
        success: Number(exitCode) === 0,
        exitCode,
        summary: buildSummary(command, exitCode, Number(exitCode) === 0),
      });
      await removeWorkspace(sessionRoot);
    });
  } catch (error) {
    appendSandboxOutput(sessionId, `${String(error?.message || error)}\n`, "stderr");
    completeSandboxSession(sessionId, {
      success: false,
      exitCode: null,
      summary: String(error?.message || "Sandbox run failed."),
    });
    await removeWorkspace(sessionRoot);
  }

  return {
    command,
  };
}

export async function startSandboxPreview(sessionId, { config: rawConfig, draftCode }) {
  const config = normalizeSandboxConfig(rawConfig);
  let sessionRoot = "";
  let child = null;

  try {
    const sessionMeta = getSandboxSession(sessionId, { fresh: true })?.meta || {};
    if (!canUseSandboxPreview(config, draftCode, config.targetFilePath)) {
      if (config.runtime === "python") {
        throw new Error(
          "This Python file does not look like a visual app yet. Use Run for console/test output, or add a Python preview command for Streamlit, Gradio, Flask, or Dash."
        );
      }

      throw new Error("Add a preview command in sandbox settings before starting live preview.");
    }

    const preferredPort = parsePreferredPort(config.previewPort);
    const previewPort = await findAvailablePort(preferredPort);
    const rawPreviewCommand = getSandboxPreviewCommand(config, previewPort, {
      sourceCode: draftCode,
      targetFilePath: config.targetFilePath,
    });
    const previewCommand =
      config.executionMode === "docker"
        ? normalizeDockerPreviewCommand(rawPreviewCommand, previewPort)
        : rawPreviewCommand;
    if (!previewCommand) {
      throw new Error(
        config.runtime === "python"
          ? "Add a Python preview command in sandbox settings before starting live preview."
          : "Add a React preview command in sandbox settings before starting live preview."
      );
    }

    const workspace = await prepareSandboxWorkspace(config, sessionId, draftCode);
    sessionRoot = workspace.sessionRoot;

    const previewRoute = getSandboxPreviewRoute(config, {
      sourceCode: draftCode,
      targetFilePath: config.targetFilePath,
    });
    const previewUrl = buildPreviewUrl(previewPort, previewRoute);
    const previewContainerName =
      config.executionMode === "docker"
        ? buildPreviewContainerName({
            hiveID: sessionMeta.hiveID,
            honeycombID: sessionMeta.honeycombID,
            targetFilePath: config.targetFilePath,
            sessionId,
          })
        : "";

    if (config.executionMode === "docker" && previewContainerName) {
      await removeDockerContainer(previewContainerName).catch(() => {});
      await waitForMs(500);
    }

    appendSandboxOutput(
      sessionId,
      `[HiveMind] Workspace copied to ${workspace.repoCopyPath}\n[HiveMind] Starting preview with ${previewCommand}\n`,
      "system"
    );
    markSandboxRunning(sessionId, {
      kind: "preview",
      command: previewCommand,
      targetFilePath: workspace.relativeTargetPath,
      repoLabel: config.repoLabel || path.basename(workspace.repoPath),
      runtime: config.runtime,
      executionMode: config.executionMode,
      previewPort,
      previewRoute: normalizePreviewRoute(previewRoute),
      previewUrl,
    });

    child = createChildProcess({
      config,
      repoCopyPath: workspace.repoCopyPath,
      command: previewCommand,
      previewPort,
      sessionId,
      previewContainerName,
    });

    mergeSandboxSessionMeta(
      sessionId,
      {
        pid: Number(child.pid || 0) || null,
        sessionRoot: workspace.sessionRoot,
        repoCopyPath: workspace.repoCopyPath,
        previewPort,
        previewRoute: normalizePreviewRoute(previewRoute),
        previewUrl,
        previewContainerName,
      },
      {
        eventType: "meta",
      }
    );

    child.stdout?.on("data", (chunk) => {
      appendSandboxOutput(sessionId, chunk.toString(), "stdout");
    });

    child.stderr?.on("data", (chunk) => {
      appendSandboxOutput(sessionId, chunk.toString(), "stderr");
    });

    child.on("error", async (error) => {
      appendSandboxOutput(sessionId, `${String(error?.message || error)}\n`, "stderr");
      completeSandboxSession(sessionId, {
        success: false,
        exitCode: null,
        summary: "Preview failed to start.",
        status: "failed",
      });
      await removeWorkspace(sessionRoot);
    });

    child.on("close", async (exitCode) => {
      const session = getSandboxSession(sessionId, { fresh: true });
      if (!session?.finalized) {
        completeSandboxSession(sessionId, {
          success: Number(exitCode) === 0,
          exitCode,
          summary:
            Number(exitCode) === 0
              ? "Preview server stopped."
              : `Preview server exited with code ${exitCode}.`,
          status: Number(exitCode) === 0 ? "stopped" : "failed",
        });
      }
      await removeWorkspace(sessionRoot);
    });

    const ready = await waitForPreviewReady({
      sessionId,
      previewUrl,
      child,
    });

    if (!ready) {
      appendSandboxOutput(
        sessionId,
        "[HiveMind] Preview server did not become ready in time.\n",
        "stderr"
      );
      await stopSandboxPreview(sessionId, {
        reason: "Preview server did not become ready in time.",
      });
      throw new Error("Preview server did not become ready in time.");
    }

    appendSandboxOutput(
      sessionId,
      `[HiveMind] Preview ready at ${previewUrl}\n`,
      "system"
    );
    mergeSandboxSessionMeta(
      sessionId,
      {
        previewReady: true,
        previewUrl,
        previewPort,
      },
      {
        eventType: "preview",
      }
    );
    pushSandboxSessionEvent(sessionId, "status", {
      status: "ready",
      summary: `Preview live at ${previewUrl}`,
      timestamp: Date.now(),
    });

    return {
      command: previewCommand,
      previewPort,
      previewUrl,
    };
  } catch (error) {
    const session = getSandboxSession(sessionId, { fresh: true });
    if (!session?.finalized) {
      appendSandboxOutput(sessionId, `${String(error?.message || error)}\n`, "stderr");
      completeSandboxSession(sessionId, {
        success: false,
        exitCode: null,
        summary: String(error?.message || "Live preview failed."),
        status: "failed",
      });
    }
    await removeWorkspace(sessionRoot);
    throw error;
  }
}

export async function stopSandboxPreview(sessionId, { reason = "Preview stopped." } = {}) {
  const session = getSandboxSession(sessionId, { fresh: true });
  if (!session) {
    throw new Error("Preview session not found.");
  }

  const pid = Number(session.meta?.pid || 0);
  const sessionRoot = String(session.meta?.sessionRoot || "");
  const executionMode = String(session.meta?.executionMode || "");
  const previewContainerName = String(session.meta?.previewContainerName || "");

  if (!session.finalized) {
    if (executionMode === "docker" && previewContainerName) {
      try {
        await removeDockerContainer(previewContainerName);
      } catch (error) {
        appendSandboxOutput(
          sessionId,
          `[HiveMind] ${String(error?.message || error)}\n`,
          "stderr"
        );
      }
    } else if (pid) {
      try {
        await killProcessTree(pid);
      } catch (error) {
        appendSandboxOutput(
          sessionId,
          `[HiveMind] ${String(error?.message || error)}\n`,
          "stderr"
        );
      }
    }

    completeSandboxSession(sessionId, {
      success: true,
      exitCode: null,
      summary: reason,
      status: "stopped",
    });
  }

  await removeWorkspace(sessionRoot);

  if (executionMode === "docker") {
    await waitForMs(700);
  }

  return {
    stopped: true,
  };
}
