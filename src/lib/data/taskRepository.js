// src/lib/data/taskRepository.js
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { syncHiveDirectoryMetrics } from "@/lib/data/hiveRepository";
import {
  normalizeAssignees,
  normalizeBlockReason,
  normalizeTaskPriority,
  normalizeTaskStatus,
} from "@/lib/workflow/validation";

const asId = (v, name) => {
  if (v === undefined || v === null || v === "") throw new Error(`${name} is required`);
  return String(v);
};

export async function createTaskFromMessage({
  hiveID,
  honeycombID,
  messageID,
  title,
  description = "",
  checklist = [],
  status = "todo",
  priority = "medium",
  blockReason = "",
  assignees = [],
  dueAt = null,
  createdBy,
  linkedDecisionId = "",
  linkedDecisionTitle = "",
  linkedFiles = [],
  sourceThreadID = "",
  sourceDecisionID = "",
  sourcePreview = null,
}) {
  return createTaskRecord({
    hiveID,
    title,
    description,
    checklist,
    status,
    priority,
    blockReason,
    assignees,
    dueAt,
    createdBy,
    linkedDecisionId,
    linkedDecisionTitle,
    linkedFiles,
    source: {
      honeycombID,
      messageID,
      threadID: sourceThreadID,
      decisionID: sourceDecisionID || linkedDecisionId || "",
    },
    sourcePreview,
  });
}

export async function createTaskRecord({
  hiveID,
  title,
  description = "",
  checklist = [],
  status = "todo",
  priority = "medium",
  blockReason = "",
  assignees = [],
  dueAt = null,
  createdBy,
  linkedDecisionId = "",
  linkedDecisionTitle = "",
  linkedFiles = [],
  source = null,
  sourcePreview = null,
}) {
  const hid = asId(hiveID, "hiveID");
  const uid = asId(createdBy, "createdBy");
  const normalizedSource =
    source && typeof source === "object"
      ? {
          hiveID: hid,
          honeycombID: String(source.honeycombID || ""),
          messageID: String(source.messageID || ""),
          threadID: String(source.threadID || ""),
          decisionID: String(source.decisionID || linkedDecisionId || ""),
        }
      : null;

  const tasksRef = collection(db, "Hive", hid, "tasks");

  const dueTimestamp =
    dueAt ? Timestamp.fromDate(dueAt instanceof Date ? dueAt : new Date(dueAt)) : null;

  const normalizedSourcePreview =
    sourcePreview && typeof sourcePreview === "object"
      ? {
          parentMessageText: String(sourcePreview.parentMessageText || "").trim(),
          decisionTitle: String(sourcePreview.decisionTitle || "").trim(),
          decisionSummary: String(sourcePreview.decisionSummary || "").trim(),
        }
      : null;

  const taskPayload = {
    title: String(title || "").trim() || "New Task",
    description: String(description || ""),
    checklist: Array.isArray(checklist) ? checklist : [],
    status: normalizeTaskStatus(status),
    priority: normalizeTaskPriority(priority),
    blockReason: normalizeBlockReason(status, blockReason),
    assignees: normalizeAssignees(assignees),
    dueAt: dueTimestamp,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    linkedDecisionId: String(linkedDecisionId || ""),
    linkedDecisionTitle: String(linkedDecisionTitle || ""),
    linkedFiles: Array.isArray(linkedFiles) ? linkedFiles.filter(Boolean) : [],
    sourcePreview: normalizedSourcePreview,
    source: normalizedSource,
  };

  const taskDoc = await addDoc(tasksRef, taskPayload);

  if (normalizedSource?.honeycombID && normalizedSource?.messageID) {
    const msgRef = doc(
      db,
      "Hive",
      hid,
      "Honeycomb",
      normalizedSource.honeycombID,
      "messages",
      normalizedSource.messageID
    );
    await updateDoc(msgRef, {
      linkedTaskIds: arrayUnion(taskDoc.id),
    });
  }

  if (linkedDecisionId) {
    const decisionRef = doc(db, "Hive", hid, "decisionRecords", String(linkedDecisionId));
    await updateDoc(decisionRef, {
      linkedTaskIds: arrayUnion(taskDoc.id),
      updatedAt: serverTimestamp(),
    });
  }

  await syncHiveDirectoryMetrics(hid, { touchLastActive: true });

  return taskDoc.id;
}

export async function listTasksForHive(hiveID) {
  const hid = asId(hiveID, "hiveID");
  const tasksRef = collection(db, "Hive", hid, "tasks");
  const tasksQuery = query(tasksRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(tasksQuery);

  return snapshot.docs.map((taskDoc) => ({
    id: taskDoc.id,
    ...taskDoc.data(),
  }));
}

export async function updateTaskRecord({ hiveID, taskID, patch }) {
  const hid = asId(hiveID, "hiveID");
  const tid = asId(taskID, "taskID");
  if (!patch || typeof patch !== "object") {
    throw new Error("patch is required");
  }

  const nextPatch = { ...patch };

  if (Object.prototype.hasOwnProperty.call(nextPatch, "dueAt")) {
    nextPatch.dueAt = nextPatch.dueAt
      ? nextPatch.dueAt instanceof Date
        ? Timestamp.fromDate(nextPatch.dueAt)
        : nextPatch.dueAt
      : null;
  }

  if (Object.prototype.hasOwnProperty.call(nextPatch, "status")) {
    nextPatch.status = normalizeTaskStatus(nextPatch.status);
  }

  if (Object.prototype.hasOwnProperty.call(nextPatch, "priority")) {
    nextPatch.priority = normalizeTaskPriority(nextPatch.priority);
  }

  if (
    Object.prototype.hasOwnProperty.call(nextPatch, "blockReason") ||
    Object.prototype.hasOwnProperty.call(nextPatch, "status")
  ) {
    nextPatch.blockReason = Object.prototype.hasOwnProperty.call(nextPatch, "status")
      ? normalizeBlockReason(nextPatch.status, nextPatch.blockReason)
      : String(nextPatch.blockReason || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(nextPatch, "assignees")) {
    nextPatch.assignees = normalizeAssignees(nextPatch.assignees);
  }

  const taskRef = doc(db, "Hive", hid, "tasks", tid);
  await updateDoc(taskRef, {
    ...nextPatch,
    updatedAt: serverTimestamp(),
  });

  await syncHiveDirectoryMetrics(hid, { touchLastActive: true });
}

export async function deleteTaskRecord({ hiveID, taskID }) {
  const hid = asId(hiveID, "hiveID");
  const tid = asId(taskID, "taskID");

  const taskRef = doc(db, "Hive", hid, "tasks", tid);
  await deleteDoc(taskRef);

  await syncHiveDirectoryMetrics(hid, { touchLastActive: true });
}
