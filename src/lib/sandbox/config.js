import {
  buildStaticPreviewRoute,
  detectStaticPreviewKind,
} from "@/lib/sandbox/fileSupport";

const DEFAULT_ALLOWED_PATHS = ["."];
const LEGACY_ALLOWED_PATHS = ["src", "app", "components", "tests"];
const STATIC_PREVIEW_COMMAND =
  'node scripts/sandbox-static-preview.cjs --root . --target "{file}" --port {port}';

export const DEFAULT_SANDBOX_CONFIG = {
  enabled: false,
  linkedProjectPath: "",
  repoLabel: "",
  defaultBranch: "main",
  targetFilePath: "",
  runtime: "react",
  executionMode: "docker",
  dockerImage: "",
  allowedPaths: DEFAULT_ALLOWED_PATHS,
  pythonRunCommand: "python main.py",
  pythonTestCommand: "",
  pythonPreviewCommand: "",
  reactBuildCommand: "npm run build",
  reactTestCommand: "npm test",
  reactPreviewCommand: "npm run dev -- --host 127.0.0.1 --port {port}",
  previewPort: "4173",
  previewRoute: "/",
};

function asString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizePreviewPort(value, fallback = DEFAULT_SANDBOX_CONFIG.previewPort) {
  const normalized = String(value ?? fallback).trim();
  if (!normalized) return String(fallback);

  const numericValue = Number(normalized);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 65535) {
    return String(fallback);
  }

  return String(numericValue);
}

function normalizePreviewRoute(value) {
  const normalized = asString(value, DEFAULT_SANDBOX_CONFIG.previewRoute) || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeTargetFilePath(value) {
  return asString(value).replace(/\\/g, "/");
}

export function normalizePathList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim().replace(/\\/g, "/"))
      .filter(Boolean);
  }

  return String(value || "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function pathsMatch(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

function normalizeAllowedPaths(value) {
  const normalized = normalizePathList(value);

  if (!normalized.length) {
    return [...DEFAULT_ALLOWED_PATHS];
  }

  // Upgrade older room configs that were still scoped to the original narrow defaults.
  if (pathsMatch(normalized, LEGACY_ALLOWED_PATHS)) {
    return [...DEFAULT_ALLOWED_PATHS];
  }

  return normalized;
}

export function normalizeSandboxConfig(rawConfig = {}) {
  const runtime = asString(rawConfig.runtime, DEFAULT_SANDBOX_CONFIG.runtime).toLowerCase();
  const executionMode = asString(
    rawConfig.executionMode,
    DEFAULT_SANDBOX_CONFIG.executionMode
  ).toLowerCase();

  return {
    enabled: asBoolean(rawConfig.enabled, DEFAULT_SANDBOX_CONFIG.enabled),
    linkedProjectPath: asString(
      rawConfig.linkedProjectPath,
      DEFAULT_SANDBOX_CONFIG.linkedProjectPath
    ),
    repoLabel: asString(rawConfig.repoLabel, DEFAULT_SANDBOX_CONFIG.repoLabel),
    defaultBranch: asString(
      rawConfig.defaultBranch,
      DEFAULT_SANDBOX_CONFIG.defaultBranch
    ),
    targetFilePath: asString(
      rawConfig.targetFilePath,
      DEFAULT_SANDBOX_CONFIG.targetFilePath
    ).replace(/\\/g, "/"),
    runtime: runtime === "python" ? "python" : "react",
    executionMode: executionMode === "host" ? "host" : "docker",
    dockerImage: asString(rawConfig.dockerImage, DEFAULT_SANDBOX_CONFIG.dockerImage),
    allowedPaths: normalizeAllowedPaths(rawConfig.allowedPaths),
    pythonRunCommand: asString(
      rawConfig.pythonRunCommand,
      DEFAULT_SANDBOX_CONFIG.pythonRunCommand
    ),
    pythonTestCommand: asString(
      rawConfig.pythonTestCommand,
      DEFAULT_SANDBOX_CONFIG.pythonTestCommand
    ),
    pythonPreviewCommand: asString(
      rawConfig.pythonPreviewCommand,
      DEFAULT_SANDBOX_CONFIG.pythonPreviewCommand
    ),
    reactBuildCommand: asString(
      rawConfig.reactBuildCommand,
      DEFAULT_SANDBOX_CONFIG.reactBuildCommand
    ),
    reactTestCommand: asString(
      rawConfig.reactTestCommand,
      DEFAULT_SANDBOX_CONFIG.reactTestCommand
    ),
    reactPreviewCommand: asString(
      rawConfig.reactPreviewCommand,
      DEFAULT_SANDBOX_CONFIG.reactPreviewCommand
    ),
    previewPort: normalizePreviewPort(rawConfig.previewPort),
    previewRoute: normalizePreviewRoute(rawConfig.previewRoute),
  };
}

export function getSandboxRunCommand(config) {
  const sandboxConfig = normalizeSandboxConfig(config);

  if (sandboxConfig.runtime === "python") {
    return sandboxConfig.pythonTestCommand || sandboxConfig.pythonRunCommand;
  }

  return sandboxConfig.reactTestCommand || sandboxConfig.reactBuildCommand;
}

export function getSandboxRunnerImage(config) {
  const sandboxConfig = normalizeSandboxConfig(config);

  if (sandboxConfig.dockerImage) {
    return sandboxConfig.dockerImage;
  }

  return sandboxConfig.runtime === "python" ? "python:3.12-slim" : "node:20-bullseye";
}

export function detectPythonPreviewKind(sourceCode = "", targetFilePath = "") {
  const code = String(sourceCode || "");
  const lowerCode = code.toLowerCase();
  const lowerPath = String(targetFilePath || "").toLowerCase();

  if (
    /\bimport\s+streamlit\b/.test(code) ||
    /\bfrom\s+streamlit\s+import\b/.test(code) ||
    /\bst\./.test(lowerCode)
  ) {
    return "streamlit";
  }

  if (
    /\bimport\s+gradio\b/.test(code) ||
    /\bfrom\s+gradio\s+import\b/.test(code) ||
    /\bgr\.(interface|blocks|chatinterface)\b/.test(lowerCode)
  ) {
    return "gradio";
  }

  if (
    /\bfrom\s+flask\s+import\b/.test(code) ||
    /\bimport\s+flask\b/.test(code) ||
    /\bflask\s*\(/i.test(code)
  ) {
    return "flask";
  }

  if (
    /\bfrom\s+fastapi\s+import\b/.test(code) ||
    /\bimport\s+fastapi\b/.test(code) ||
    /\bfastapi\s*\(/i.test(code)
  ) {
    return "fastapi";
  }

  if (
    /\bimport\s+dash\b/.test(code) ||
    /\bfrom\s+dash\s+import\b/.test(code) ||
    /\bdash\s*\(/i.test(code)
  ) {
    return "dash";
  }

  if (
    /\bimport\s+panel\b/.test(code) ||
    /\bfrom\s+panel\s+import\b/.test(code) ||
    /\bpn\./.test(lowerCode)
  ) {
    return "panel";
  }

  if (
    /\bimport\s+nicegui\b/.test(code) ||
    /\bfrom\s+nicegui\s+import\b/.test(code) ||
    /\bui\./.test(lowerCode)
  ) {
    return "nicegui";
  }

  if (/(^|\/)manage\.py$/i.test(lowerPath) || /\bdjango\b/.test(lowerCode)) {
    return "django";
  }

  return "";
}

function replacePreviewTokens(command, sandboxConfig, portOverride, targetFilePath = "") {
  const resolvedPort = String(portOverride || sandboxConfig.previewPort || "");
  const resolvedTargetFile = normalizeTargetFilePath(
    targetFilePath || sandboxConfig.targetFilePath || ""
  );

  return String(command || "")
    .replace(/\{port\}/gi, resolvedPort)
    .replace(/\{route\}/gi, sandboxConfig.previewRoute || "/")
    .replace(/\{file\}|\{targetfile\}/gi, resolvedTargetFile)
    .trim();
}

export function canUseSandboxPreview(config, sourceCode = "", targetFilePath = "") {
  const sandboxConfig = normalizeSandboxConfig(config);
  const resolvedTargetFilePath = targetFilePath || sandboxConfig.targetFilePath;

  if (detectStaticPreviewKind(resolvedTargetFilePath)) {
    return true;
  }

  if (sandboxConfig.runtime === "react") {
    return Boolean(String(sandboxConfig.reactPreviewCommand || "").trim());
  }

  const previewKind = detectPythonPreviewKind(
    sourceCode,
    resolvedTargetFilePath
  );

  if (!previewKind) {
    return false;
  }

  return Boolean(
    String(sandboxConfig.pythonPreviewCommand || "").trim() ||
      String(sandboxConfig.pythonRunCommand || "").trim() ||
      targetFilePath ||
      sandboxConfig.targetFilePath
  );
}

export function getSandboxPreviewCommand(config, portOverride, options = {}) {
  const sandboxConfig = normalizeSandboxConfig(config);
  const targetFilePath = options.targetFilePath || sandboxConfig.targetFilePath;
  const sourceCode = options.sourceCode || "";
  const staticPreviewKind = detectStaticPreviewKind(targetFilePath);

  if (staticPreviewKind) {
    return replacePreviewTokens(
      STATIC_PREVIEW_COMMAND,
      sandboxConfig,
      portOverride,
      targetFilePath
    );
  }

  if (sandboxConfig.runtime === "react") {
    return replacePreviewTokens(
      sandboxConfig.reactPreviewCommand,
      sandboxConfig,
      portOverride,
      targetFilePath
    );
  }

  const previewKind = detectPythonPreviewKind(sourceCode, targetFilePath);
  if (!previewKind) {
    return "";
  }

  if (sandboxConfig.pythonPreviewCommand) {
    return replacePreviewTokens(
      sandboxConfig.pythonPreviewCommand,
      sandboxConfig,
      portOverride,
      targetFilePath
    );
  }

  if (previewKind === "streamlit") {
    return replacePreviewTokens(
      "streamlit run {file} --server.port {port} --server.address 127.0.0.1 --server.headless true",
      sandboxConfig,
      portOverride,
      targetFilePath
    );
  }

  if (previewKind === "django" && /(^|\/)manage\.py$/i.test(String(targetFilePath || ""))) {
    return replacePreviewTokens(
      "python {file} runserver 127.0.0.1:{port}",
      sandboxConfig,
      portOverride,
      targetFilePath
    );
  }

  if (sandboxConfig.pythonRunCommand) {
    return replacePreviewTokens(
      sandboxConfig.pythonRunCommand,
      sandboxConfig,
      portOverride,
      targetFilePath
    );
  }

  return replacePreviewTokens("python {file}", sandboxConfig, portOverride, targetFilePath);
}

export function getSandboxPreviewRoute(config, options = {}) {
  const sandboxConfig = normalizeSandboxConfig(config);
  const targetFilePath = options.targetFilePath || sandboxConfig.targetFilePath;
  const staticPreviewKind = detectStaticPreviewKind(targetFilePath);

  if (staticPreviewKind) {
    return buildStaticPreviewRoute(targetFilePath);
  }

  return normalizePreviewRoute(sandboxConfig.previewRoute);
}
