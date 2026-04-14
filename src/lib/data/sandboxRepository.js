import { auth } from "@/lib/firebase/config";

async function getAuthHeaders(extraHeaders = {}) {
  const currentUser = auth.currentUser;
  const idToken = currentUser ? await currentUser.getIdToken(false) : "";

  return {
    "Content-Type": "application/json",
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    ...extraHeaders,
  };
}

async function requestJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Sandbox request failed.");
  }

  return data;
}

export async function loadSandboxFile(payload) {
  const { signal, ...body } = payload || {};
  return requestJson("/api/sandbox/file", body, { signal });
}

export async function listSandboxFiles(payload) {
  return requestJson("/api/sandbox/files", payload);
}

export async function startSandboxRun(payload) {
  return requestJson("/api/sandbox/run", payload);
}

export async function saveSandboxFile(payload) {
  return requestJson("/api/sandbox/save", payload);
}

export async function startSandboxPreview(payload) {
  return requestJson("/api/sandbox/preview", payload);
}

export async function startSandboxTerminal(payload) {
  return requestJson("/api/sandbox/terminal", payload);
}

export async function stopSandboxPreview(payload) {
  const sessionId = String(payload?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Preview session ID is required.");
  }

  return requestJson(`/api/sandbox/preview/${sessionId}/stop`, {
    hiveID: payload?.hiveID || "",
  });
}

export async function sendSandboxTerminalInput(payload) {
  const sessionId = String(payload?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Terminal session ID is required.");
  }

  return requestJson(`/api/sandbox/terminal/${sessionId}/input`, {
    hiveID: payload?.hiveID || "",
    input: String(payload?.input || ""),
  });
}

export async function resizeSandboxTerminal(payload) {
  const sessionId = String(payload?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Terminal session ID is required.");
  }

  return requestJson(`/api/sandbox/terminal/${sessionId}/resize`, {
    hiveID: payload?.hiveID || "",
    cols: payload?.cols,
    rows: payload?.rows,
  });
}

export async function stopSandboxTerminal(payload) {
  const sessionId = String(payload?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Terminal session ID is required.");
  }

  return requestJson(`/api/sandbox/terminal/${sessionId}/stop`, {
    hiveID: payload?.hiveID || "",
    reason: payload?.reason || "Terminal stopped.",
  });
}

export async function buildSandboxStreamUrl(sessionId, streamType = "run") {
  const currentUser = auth.currentUser;
  const idToken = currentUser ? await currentUser.getIdToken(false) : "";
  const params = new URLSearchParams();

  if (idToken) {
    params.set("token", idToken);
  }

  return `/api/sandbox/${streamType}/${sessionId}/stream?${params.toString()}`;
}
