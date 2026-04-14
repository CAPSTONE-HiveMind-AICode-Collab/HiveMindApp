import { database } from "@/lib/firebase/config";
import {
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
} from "firebase/database";
import * as Y from "yjs";
import { buildSandboxSessionId } from "@/lib/sandbox/sessionKeys";

function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("permission-denied") || message.includes("permission_denied");
}

function buildSandboxCollabStatePath(hiveID, honeycombID, targetFilePath) {
  return `sandboxCollab/hives/${String(hiveID)}/honeycombs/${String(
    honeycombID
  )}/sessions/${buildSandboxSessionId(targetFilePath)}/state`;
}

function buildSandboxCollabAwarenessClientPath(
  hiveID,
  honeycombID,
  targetFilePath,
  clientId
) {
  return `sandboxCollab/hives/${String(hiveID)}/honeycombs/${String(
    honeycombID
  )}/sessions/${buildSandboxSessionId(targetFilePath)}/awareness/${String(clientId)}`;
}

function buildSandboxCollabAwarenessListPath(hiveID, honeycombID, targetFilePath) {
  return `sandboxCollab/hives/${String(hiveID)}/honeycombs/${String(
    honeycombID
  )}/sessions/${buildSandboxSessionId(targetFilePath)}/awareness`;
}

function encodeUint8Array(value) {
  if (!(value instanceof Uint8Array) || !value.length) {
    return "";
  }

  let binary = "";
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary);
}

function decodeUint8Array(value) {
  const encoded = String(value || "").trim();
  if (!encoded) {
    return new Uint8Array();
  }

  const binary = atob(encoded);
  const decoded = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    decoded[index] = binary.charCodeAt(index);
  }
  return decoded;
}

function buildStateUpdateFromText(initialText = "") {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  if (initialText) {
    text.insert(0, String(initialText));
  }
  return encodeUint8Array(Y.encodeStateAsUpdate(doc));
}

export function subscribeToSandboxCollabState(
  { hiveID, honeycombID, targetFilePath },
  callback
) {
  if (!database || !hiveID || !honeycombID || !targetFilePath) {
    callback?.(null);
    return () => {};
  }

  const stateRef = ref(
    database,
    buildSandboxCollabStatePath(hiveID, honeycombID, targetFilePath)
  );

  return onValue(
    stateRef,
    (snapshot) => {
      callback?.(snapshot.val() || null);
    },
    (error) => {
      if (!isPermissionDeniedError(error)) {
        console.error("Sandbox collaboration subscription failed:", error);
      }
      callback?.(null);
    }
  );
}

export async function ensureSandboxCollabState({
  hiveID,
  honeycombID,
  targetFilePath,
  initialText = "",
  clientId = "",
}) {
  if (!database || !hiveID || !honeycombID || !targetFilePath) {
    return null;
  }

  const stateRef = ref(
    database,
    buildSandboxCollabStatePath(hiveID, honeycombID, targetFilePath)
  );
  const initialUpdate = buildStateUpdateFromText(initialText);

  try {
    const result = await runTransaction(stateRef, (current) => {
      if (current?.update) {
        return current;
      }

      return {
        update: initialUpdate,
        updatedAt: Date.now(),
        updatedBy: String(clientId || "seed"),
      };
    });

    return result?.snapshot?.val?.() || null;
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      console.error("Sandbox collaboration bootstrap failed:", error);
    }
    throw error;
  }
}

export async function mergeSandboxCollabUpdate({
  hiveID,
  honeycombID,
  targetFilePath,
  updateBase64 = "",
  clientId = "",
}) {
  if (
    !database ||
    !hiveID ||
    !honeycombID ||
    !targetFilePath ||
    !String(updateBase64 || "").trim()
  ) {
    return null;
  }

  const stateRef = ref(
    database,
    buildSandboxCollabStatePath(hiveID, honeycombID, targetFilePath)
  );

  try {
    const result = await runTransaction(stateRef, (current) => {
      const nextDoc = new Y.Doc();
      if (current?.update) {
        Y.applyUpdate(nextDoc, decodeUint8Array(current.update));
      }

      Y.applyUpdate(nextDoc, decodeUint8Array(updateBase64));

      return {
        update: encodeUint8Array(Y.encodeStateAsUpdate(nextDoc)),
        updatedAt: Date.now(),
        updatedBy: String(clientId || ""),
      };
    });

    return result?.snapshot?.val?.() || null;
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      console.error("Sandbox collaboration merge failed:", error);
    }
    throw error;
  }
}

export async function replaceSandboxCollabState({
  hiveID,
  honeycombID,
  targetFilePath,
  text = "",
  clientId = "",
}) {
  if (!database || !hiveID || !honeycombID || !targetFilePath) {
    return null;
  }

  const stateRef = ref(
    database,
    buildSandboxCollabStatePath(hiveID, honeycombID, targetFilePath)
  );

  try {
    await set(stateRef, {
      update: buildStateUpdateFromText(text),
      updatedAt: Date.now(),
      updatedBy: String(clientId || "replace"),
    });
    return true;
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      console.error("Sandbox collaboration replace failed:", error);
    }
    throw error;
  }
}

export function subscribeToSandboxCollabAwareness(
  { hiveID, honeycombID, targetFilePath },
  callback
) {
  if (!database || !hiveID || !honeycombID || !targetFilePath) {
    callback?.({});
    return () => {};
  }

  const awarenessRef = ref(
    database,
    buildSandboxCollabAwarenessListPath(hiveID, honeycombID, targetFilePath)
  );

  return onValue(
    awarenessRef,
    (snapshot) => {
      callback?.(snapshot.val() || {});
    },
    (error) => {
      if (!isPermissionDeniedError(error)) {
        console.error("Sandbox awareness subscription failed:", error);
      }
      callback?.({});
    }
  );
}

export function connectSandboxCollabAwareness({
  hiveID,
  honeycombID,
  targetFilePath,
  clientId,
  userId = "",
  displayName = "",
  email = "",
  photoURL = "",
  color = "",
}) {
  if (!database || !hiveID || !honeycombID || !targetFilePath || !clientId) {
    return () => {};
  }

  const awarenessRef = ref(
    database,
    buildSandboxCollabAwarenessClientPath(
      hiveID,
      honeycombID,
      targetFilePath,
      clientId
    )
  );
  const connectedRef = ref(database, ".info/connected");

  const basePayload = {
    clientId: Number(clientId) || 0,
    userId: String(userId || ""),
    displayName: String(displayName || ""),
    email: String(email || ""),
    photoURL: String(photoURL || ""),
    color: String(color || ""),
    updateBase64: "",
    updatedAt: Date.now(),
  };

  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() === false) {
      return;
    }

    try {
      await onDisconnect(awarenessRef).remove();
      await set(awarenessRef, basePayload);
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        console.error("Failed to connect sandbox awareness:", error);
      }
    }
  });

  return () => {
    unsubscribe?.();
    remove(awarenessRef).catch(() => {});
  };
}

export async function writeSandboxCollabAwareness({
  hiveID,
  honeycombID,
  targetFilePath,
  clientId,
  userId = "",
  displayName = "",
  email = "",
  photoURL = "",
  color = "",
  updateBase64 = "",
}) {
  if (!database || !hiveID || !honeycombID || !targetFilePath || !clientId) {
    return null;
  }

  const awarenessRef = ref(
    database,
    buildSandboxCollabAwarenessClientPath(
      hiveID,
      honeycombID,
      targetFilePath,
      clientId
    )
  );

  try {
    await set(awarenessRef, {
      clientId: Number(clientId) || 0,
      userId: String(userId || ""),
      displayName: String(displayName || ""),
      email: String(email || ""),
      photoURL: String(photoURL || ""),
      color: String(color || ""),
      updateBase64: String(updateBase64 || ""),
      updatedAt: Date.now(),
    });

    return true;
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      console.error("Sandbox awareness write failed:", error);
    }
    throw error;
  }
}
