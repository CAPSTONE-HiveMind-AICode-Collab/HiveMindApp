function normalizeSandboxFilePath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function getSandboxFileName(targetFilePath = "") {
  const normalized = normalizeSandboxFilePath(targetFilePath);
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function getSandboxExtension(targetFilePath = "") {
  const fileName = getSandboxFileName(targetFilePath);
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return "";
  }

  return fileName.slice(lastDotIndex).toLowerCase();
}

const LANGUAGE_BY_EXTENSION = {
  ".astro": "html",
  ".bash": "shell",
  ".bat": "bat",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".css": "css",
  ".cs": "csharp",
  ".cjs": "javascript",
  ".conf": "ini",
  ".csv": "plaintext",
  ".cxx": "cpp",
  ".dart": "dart",
  ".env": "shell",
  ".go": "go",
  ".gql": "graphql",
  ".graphql": "graphql",
  ".h": "c",
  ".handlebars": "handlebars",
  ".hbs": "handlebars",
  ".hpp": "cpp",
  ".htm": "html",
  ".html": "html",
  ".ini": "ini",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "jsx",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".less": "less",
  ".lua": "lua",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mjs": "javascript",
  ".php": "php",
  ".ps1": "powershell",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sass": "scss",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".svg": "xml",
  ".svelte": "html",
  ".swift": "swift",
  ".toml": "ini",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".txt": "plaintext",
  ".vue": "html",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "shell",
};

const SUPPORTED_EDITOR_LANGUAGES = new Set([
  "bat",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "dockerfile",
  "go",
  "graphql",
  "handlebars",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "less",
  "lua",
  "markdown",
  "php",
  "plaintext",
  "powershell",
  "python",
  "ruby",
  "rust",
  "scss",
  "shell",
  "sql",
  "swift",
  "typescript",
  "xml",
  "yaml",
]);

const DIRECT_STATIC_PREVIEW_EXTENSIONS = new Set([
  ".htm",
  ".html",
  ".svg",
  ".xml",
]);

const WRAPPED_STATIC_PREVIEW_EXTENSIONS = new Set([
  ".css",
  ".ini",
  ".json",
  ".less",
  ".md",
  ".markdown",
  ".sass",
  ".scss",
  ".txt",
  ".yaml",
  ".yml",
]);

export function detectSandboxLanguage(targetFilePath = "") {
  const normalized = normalizeSandboxFilePath(targetFilePath);
  const fileName = getSandboxFileName(normalized).toLowerCase();
  const extension = getSandboxExtension(normalized);

  if (!fileName) {
    return "plaintext";
  }

  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "dockerfile";
  }

  if (fileName.startsWith(".env")) {
    return "shell";
  }

  return LANGUAGE_BY_EXTENSION[extension] || "plaintext";
}

export function normalizeSandboxEditorLanguage(language = "") {
  const value = String(language || "").trim().toLowerCase();

  if (value === "react" || value === "jsx") {
    return "javascript";
  }

  if (value === "tsx" || value === "typescript") {
    return "typescript";
  }

  if (value === "text" || value === "plaintext" || value === "plain" || value === "txt") {
    return "plaintext";
  }

  return SUPPORTED_EDITOR_LANGUAGES.has(value) ? value : "plaintext";
}

export function detectStaticPreviewKind(targetFilePath = "") {
  const normalized = normalizeSandboxFilePath(targetFilePath);
  const fileName = getSandboxFileName(normalized).toLowerCase();
  const extension = getSandboxExtension(normalized);

  if (!normalized || !fileName) {
    return "";
  }

  if (DIRECT_STATIC_PREVIEW_EXTENSIONS.has(extension)) {
    return "direct";
  }

  if (
    WRAPPED_STATIC_PREVIEW_EXTENSIONS.has(extension) ||
    fileName === "readme" ||
    fileName === "readme.md" ||
    fileName === "readme.markdown"
  ) {
    return "wrapped";
  }

  return "";
}

export function buildStaticPreviewRoute(targetFilePath = "") {
  const normalized = normalizeSandboxFilePath(targetFilePath);
  const previewKind = detectStaticPreviewKind(normalized);

  if (!normalized || !previewKind) {
    return "/";
  }

  if (previewKind === "direct") {
    return `/${normalized}`;
  }

  return `/__hivemind__/preview?file=${encodeURIComponent(normalized)}`;
}
