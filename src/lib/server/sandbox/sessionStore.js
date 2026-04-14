import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

const globalKey = "__hivemindSandboxSessions__";
const store = globalThis[globalKey] || new Map();

if (!globalThis[globalKey]) {
  globalThis[globalKey] = store;
}

function createEmitter() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  return emitter;
}

function getSessionsRoot() {
  const root = path.join(process.cwd(), ".sandbox-sessions");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getSessionFilePath(sessionId) {
  return path.join(getSessionsRoot(), `${String(sessionId || "")}.json`);
}

function toSerializableSession(session) {
  return {
    id: session.id,
    meta: session.meta,
    status: session.status,
    events: session.events,
    finalized: session.finalized,
    createdAt: session.createdAt,
  };
}

function writeSessionFile(session) {
  const targetPath = getSessionFilePath(session.id);
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(toSerializableSession(session), null, 2), "utf8");
  fs.renameSync(tempPath, targetPath);
}

function hydrateSession(snapshot) {
  const existing = store.get(snapshot.id);
  const emitter = existing?.emitter || createEmitter();
  const session = {
    id: snapshot.id,
    meta: snapshot.meta || {},
    status: snapshot.status || "queued",
    events: Array.isArray(snapshot.events) ? snapshot.events : [],
    finalized: Boolean(snapshot.finalized),
    createdAt: Number(snapshot.createdAt || Date.now()),
    emitter,
  };

  store.set(session.id, session);
  return session;
}

function loadSessionFromDisk(sessionId) {
  const filePath = getSessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed?.id) {
      return null;
    }

    return hydrateSession(parsed);
  } catch (error) {
    console.error("Sandbox session load failed:", error);
    return null;
  }
}

function pushEvent(session, type, payload) {
  const event = { type, payload };
  session.events.push(event);
  writeSessionFile(session);
  session.emitter.emit("event", event);
}

export function pushSandboxSessionEvent(sessionId, type, payload = {}) {
  const session = getSandboxSession(sessionId);
  if (!session || !type) {
    return;
  }

  pushEvent(session, String(type), payload);
}

export function createSandboxSession(meta = {}) {
  const id = randomUUID();
  const session = {
    id,
    meta,
    status: "queued",
    events: [],
    finalized: false,
    createdAt: Date.now(),
    emitter: createEmitter(),
  };

  store.set(id, session);
  writeSessionFile(session);
  return session;
}

export function getSandboxSession(sessionId, options = {}) {
  const normalizedId = String(sessionId || "");
  if (!normalizedId) {
    return null;
  }

  if (options.fresh) {
    return loadSessionFromDisk(normalizedId);
  }

  return store.get(normalizedId) || loadSessionFromDisk(normalizedId);
}

export function appendSandboxOutput(sessionId, text, stream = "stdout") {
  const session = getSandboxSession(sessionId);
  if (!session || !text) {
    return;
  }

  pushEvent(session, "output", {
    stream,
    text: String(text),
    timestamp: Date.now(),
  });
}

export function markSandboxRunning(sessionId, meta = {}) {
  const session = getSandboxSession(sessionId);
  if (!session) {
    return;
  }

  session.status = "running";
  session.meta = {
    ...session.meta,
    ...meta,
  };
  pushEvent(session, "meta", {
    ...meta,
    timestamp: Date.now(),
  });
}

export function mergeSandboxSessionMeta(sessionId, meta = {}, options = {}) {
  const session = getSandboxSession(sessionId);
  if (!session) {
    return;
  }

  session.meta = {
    ...session.meta,
    ...meta,
  };

  if (options.status) {
    session.status = String(options.status);
  }

  if (options.eventType) {
    pushEvent(session, options.eventType, {
      ...meta,
      timestamp: Date.now(),
    });
    return;
  }

  writeSessionFile(session);
}

export function setSandboxSessionStatus(sessionId, status) {
  const session = getSandboxSession(sessionId);
  if (!session || !status) {
    return;
  }

  session.status = String(status);
  writeSessionFile(session);
}

export function completeSandboxSession(sessionId, result = {}) {
  const session = getSandboxSession(sessionId);
  if (!session || session.finalized) {
    return;
  }

  session.finalized = true;
  session.status = String(result.status || (result.success ? "passed" : "failed"));
  pushEvent(session, "done", {
    success: Boolean(result.success),
    exitCode:
      result.exitCode === undefined || result.exitCode === null ? null : Number(result.exitCode),
    summary: String(result.summary || ""),
    status: String(result.status || (result.success ? "passed" : "failed")),
    timestamp: Date.now(),
  });
}

export function subscribeToSandboxSession(sessionId, handler) {
  const session = getSandboxSession(sessionId);
  if (!session) {
    return () => {};
  }

  const listener = (event) => handler(event);
  session.emitter.on("event", listener);

  return () => {
    session.emitter.off("event", listener);
  };
}
