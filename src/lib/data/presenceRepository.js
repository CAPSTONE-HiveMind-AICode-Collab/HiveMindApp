import { database } from "@/lib/firebase/config";
import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
} from "firebase/database";
import { buildSandboxSessionId } from "@/lib/sandbox/sessionKeys";

function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("permission-denied") || message.includes("permission_denied");
}

function buildPresencePath(hiveID, uid) {
  return `presence/hives/${String(hiveID)}/members/${String(uid)}`;
}

function buildPresencePayload(user, state) {
  return {
    uid: String(user?.uid || ""),
    displayName: String(user?.displayName || ""),
    email: String(user?.email || ""),
    photoURL: String(user?.photoURL || ""),
    state: String(state || "offline"),
    lastChanged: serverTimestamp(),
  };
}

function buildSandboxPresencePath(hiveID, honeycombID, targetFilePath, uid) {
  return `presence/hives/${String(hiveID)}/sandbox/${String(
    honeycombID
  )}/${buildSandboxSessionId(targetFilePath)}/members/${String(uid)}`;
}

function buildSandboxPresenceListPath(hiveID, honeycombID, targetFilePath) {
  return `presence/hives/${String(hiveID)}/sandbox/${String(
    honeycombID
  )}/${buildSandboxSessionId(targetFilePath)}/members`;
}

function buildSandboxPresencePayload({
  user,
  state,
  targetFilePath,
  layoutMode = "split",
}) {
  return {
    uid: String(user?.uid || ""),
    displayName: String(user?.displayName || ""),
    email: String(user?.email || ""),
    photoURL: String(user?.photoURL || ""),
    state: String(state || "watching"),
    targetFilePath: String(targetFilePath || ""),
    layoutMode: String(layoutMode || "split"),
    lastChanged: serverTimestamp(),
  };
}

export function subscribeToHivePresence(hiveID, callback) {
  if (!database || !hiveID) {
    console.warn("Realtime presence is unavailable because Firebase Realtime Database is not configured.");
    callback?.({});
    return () => {};
  }

  const presenceRef = ref(database, `presence/hives/${String(hiveID)}/members`);
  return onValue(
    presenceRef,
    (snapshot) => {
      callback?.(snapshot.val() || {});
    },
    (error) => {
      if (!isPermissionDeniedError(error)) {
        console.error("Realtime presence subscription failed:", error);
      }
      callback?.({});
    }
  );
}

export function syncHivePresence({ hiveID, user }) {
  if (!database || !hiveID || !user?.uid || typeof window === "undefined") {
    return () => {};
  }

  const statusRef = ref(database, buildPresencePath(hiveID, user.uid));
  const connectedRef = ref(database, ".info/connected");

  const writePresence = (state) =>
    set(statusRef, buildPresencePayload(user, state)).catch(() => {});

  const handleVisibilityChange = () => {
    const nextState = document.visibilityState === "hidden" ? "idle" : "online";
    writePresence(nextState);
  };

  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() === false) {
      return;
    }

    try {
      await onDisconnect(statusRef).set(buildPresencePayload(user, "offline"));
      await writePresence(document.visibilityState === "hidden" ? "idle" : "online");
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        console.error("Failed to sync realtime presence:", error);
      }
    }
  });

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    unsubscribe?.();
    writePresence("offline");
  };
}

export function subscribeToSandboxPresence(
  { hiveID, honeycombID, targetFilePath },
  callback
) {
  if (!database || !hiveID || !honeycombID || !targetFilePath) {
    callback?.({});
    return () => {};
  }

  const presenceRef = ref(
    database,
    buildSandboxPresenceListPath(hiveID, honeycombID, targetFilePath)
  );

  return onValue(
    presenceRef,
    (snapshot) => {
      callback?.(snapshot.val() || {});
    },
    (error) => {
      if (!isPermissionDeniedError(error)) {
        console.error("Sandbox presence subscription failed:", error);
      }
      callback?.({});
    }
  );
}

export function syncSandboxPresence({
  hiveID,
  honeycombID,
  targetFilePath,
  user,
  state = "watching",
  layoutMode = "split",
}) {
  if (
    !database ||
    !hiveID ||
    !honeycombID ||
    !targetFilePath ||
    !user?.uid ||
    typeof window === "undefined"
  ) {
    return () => {};
  }

  const statusRef = ref(
    database,
    buildSandboxPresencePath(hiveID, honeycombID, targetFilePath, user.uid)
  );
  const connectedRef = ref(database, ".info/connected");

  const writePresence = (nextState) =>
    set(
      statusRef,
      buildSandboxPresencePayload({
        user,
        state: nextState,
        targetFilePath,
        layoutMode,
      })
    ).catch(() => {});

  const handleVisibilityChange = () => {
    const nextState =
      document.visibilityState === "hidden" ? "idle" : state || "watching";
    writePresence(nextState);
  };

  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() === false) {
      return;
    }

    try {
      await onDisconnect(statusRef).set(
        buildSandboxPresencePayload({
          user,
          state: "offline",
          targetFilePath,
          layoutMode,
        })
      );
      await writePresence(
        document.visibilityState === "hidden" ? "idle" : state || "watching"
      );
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        console.error("Failed to sync sandbox presence:", error);
      }
    }
  });

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    unsubscribe?.();
    writePresence("offline");
  };
}
