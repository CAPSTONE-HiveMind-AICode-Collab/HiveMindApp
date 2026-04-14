import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  buildSandboxSessionId,
  normalizeSandboxSessionTargetPath,
} from "@/lib/sandbox/sessionKeys";

function buildSandboxSessionRef(hiveID, honeycombID, targetFilePath) {
  if (!hiveID || !honeycombID) {
    throw new Error("hiveID and honeycombID are required");
  }

  const sessionId = buildSandboxSessionId(targetFilePath);
  return doc(
    db,
    "Hive",
    String(hiveID),
    "Honeycomb",
    String(honeycombID),
    "sandboxSessions",
    sessionId
  );
}

function cleanString(value) {
  return String(value || "").trim();
}

export function subscribeToSandboxSession(
  { hiveID, honeycombID, targetFilePath },
  callback
) {
  if (!hiveID || !honeycombID || !targetFilePath) {
    callback?.(null);
    return () => {};
  }

  const sessionRef = buildSandboxSessionRef(hiveID, honeycombID, targetFilePath);
  return onSnapshot(
    sessionRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback?.(null);
        return;
      }

      callback?.({
        id: snapshot.id,
        ...snapshot.data(),
      });
    },
    (error) => {
      console.error("Sandbox session subscription failed:", error);
      callback?.(null);
    }
  );
}

export async function upsertSandboxSession({
  hiveID,
  honeycombID,
  targetFilePath,
  runtime = "",
  repoLabel = "",
  defaultBranch = "",
  sourceMessageID = "",
  sourceMessageText = "",
  language = "",
  draftCode = "",
  ownerUserId = "",
  ownerDisplayName = "",
  ownerEmail = "",
  status = "",
  handoffNote = "",
  lastEditedByUserId = "",
  lastEditedByDisplayName = "",
  runStatus = "",
  runSummary = "",
  previewStatus = "",
  previewSummary = "",
  previewUrl = "",
  saveStatus = "",
  saveSummary = "",
  savedByUserId = "",
  savedByDisplayName = "",
}) {
  if (!hiveID || !honeycombID || !targetFilePath) {
    throw new Error("hiveID, honeycombID, and targetFilePath are required");
  }

  const normalizedTargetFilePath =
    normalizeSandboxSessionTargetPath(targetFilePath);
  const sessionRef = buildSandboxSessionRef(
    hiveID,
    honeycombID,
    normalizedTargetFilePath
  );

  await setDoc(
    sessionRef,
    {
      hiveID: String(hiveID),
      honeycombID: String(honeycombID),
      sessionId: sessionRef.id,
      targetFilePath: normalizedTargetFilePath,
      runtime: cleanString(runtime),
      repoLabel: cleanString(repoLabel),
      defaultBranch: cleanString(defaultBranch),
      sourceMessageID: cleanString(sourceMessageID),
      sourceMessageText: String(sourceMessageText || ""),
      language: cleanString(language),
      draftCode: String(draftCode || ""),
      ownerUserId: cleanString(ownerUserId),
      ownerDisplayName: cleanString(ownerDisplayName),
      ownerEmail: cleanString(ownerEmail),
      status: cleanString(status) || "idle",
      handoffNote: String(handoffNote || ""),
      lastEditedByUserId: cleanString(lastEditedByUserId),
      lastEditedByDisplayName: cleanString(lastEditedByDisplayName),
      runStatus: cleanString(runStatus),
      runSummary: String(runSummary || ""),
      previewStatus: cleanString(previewStatus),
      previewSummary: String(previewSummary || ""),
      previewUrl: cleanString(previewUrl),
      saveStatus: cleanString(saveStatus),
      saveSummary: String(saveSummary || ""),
      savedByUserId: cleanString(savedByUserId),
      savedByDisplayName: cleanString(savedByDisplayName),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return sessionRef.id;
}
