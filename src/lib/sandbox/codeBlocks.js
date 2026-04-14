function detectLanguageFromSnippet(language, code = "") {
  if (language) return String(language).toLowerCase();

  if (/^\s*(import|export)\s/m.test(code) || /<\w+/.test(code)) {
    return "jsx";
  }

  if (/^\s*def\s+\w+\(/m.test(code) || /print\(/.test(code)) {
    return "python";
  }

  return "javascript";
}

const FILE_REFERENCE_PATTERNS = [
  /`([^`\n]+\.(?:jsx?|tsx?|py|json|css|html|mjs|cjs))`/gi,
  /\b(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.(?:jsx?|tsx?|py|json|css|html|mjs|cjs)\b/gi,
  /\b[A-Za-z0-9_.-]+\.(?:jsx?|tsx?|py|json|css|html|mjs|cjs)\b/gi,
];

function normalizeFileReference(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

export function extractCodeBlocks(text) {
  const value = String(text || "");
  const blocks = [];
  const regex = /```(\w+)?\n?([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(value)) !== null) {
    blocks.push({
      language: detectLanguageFromSnippet(match[1], match[2]),
      code: String(match[2] || ""),
    });
  }

  return blocks;
}

export function getFirstCodeBlock(text) {
  return extractCodeBlocks(text)[0] || null;
}

export function extractFileReferences(text) {
  const value = String(text || "");
  if (!value.trim()) {
    return [];
  }

  const matches = [];

  for (const pattern of FILE_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(value)) !== null) {
      const rawValue = match[1] || match[0];
      const normalized = normalizeFileReference(rawValue);
      if (!normalized) {
        continue;
      }
      matches.push(normalized);
    }
  }

  return [...new Set(matches)];
}

export function buildSandboxTaskAttachment({
  config,
  sourceMessage,
  latestOutput = "",
  draftCode = "",
  verification = "sandbox-run",
}) {
  const lines = [];
  const repoLabel = config?.repoLabel || "Linked project";
  const branch = config?.defaultBranch || "main";
  const targetFile = config?.targetFilePath || "not set";
  const command = getTaskCommandLabel(config);

  lines.push("Sandbox verification snapshot");
  lines.push(`Repo: ${repoLabel}`);
  lines.push(`Branch: ${branch}`);
  lines.push(`Target file: ${targetFile}`);
  lines.push(`Verification level: ${verification}`);

  if (command) {
    lines.push(`Command: ${command}`);
  }

  if (sourceMessage?.sender || sourceMessage?.text) {
    lines.push("");
    lines.push("Source message:");
    lines.push(`${sourceMessage.sender || "Teammate"}: ${String(sourceMessage.text || "").trim()}`);
  }

  if (latestOutput) {
    lines.push("");
    lines.push("Latest output:");
    lines.push(latestOutput.trim());
  }

  if (draftCode) {
    lines.push("");
    lines.push("Current draft:");
    lines.push("```");
    lines.push(draftCode.trim());
    lines.push("```");
  }

  return lines.filter(Boolean).join("\n");
}

function getTaskCommandLabel(config) {
  if (!config) return "";
  if (config.runtime === "python") {
    return config.pythonTestCommand || config.pythonRunCommand || "";
  }
  return config.reactTestCommand || config.reactBuildCommand || "";
}
