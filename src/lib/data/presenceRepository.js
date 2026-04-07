import { database } from "@/lib/firebase/config";
import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
} from "firebase/database";

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
      console.error("Realtime presence subscription failed:", error);
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
      console.error("Failed to sync realtime presence:", error);
    }
  });

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    unsubscribe?.();
    writePresence("offline");
  };
}
