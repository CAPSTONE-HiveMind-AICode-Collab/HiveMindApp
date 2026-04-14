export function normalizeSandboxSessionTargetPath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function toHex(value = "") {
  const encoder = new TextEncoder();
  return Array.from(encoder.encode(String(value || "")))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildSandboxSessionId(targetFilePath = "") {
  const normalized = normalizeSandboxSessionTargetPath(targetFilePath);
  if (!normalized) {
    return "default";
  }

  return `file-${toHex(normalized)}`;
}
