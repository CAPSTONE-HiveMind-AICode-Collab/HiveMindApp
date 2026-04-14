import { db } from "@/lib/firebase/config";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { normalizeDecisionRecordPayload } from "@/lib/ai/structuredOutput";
import { syncHiveDirectoryMetrics } from "@/lib/data/hiveRepository";
import {
  normalizeDecisionStatus,
  normalizeSupersedesDecisionId,
} from "@/lib/workflow/validation";

export const DECISION_STATUSES = {
  DRAFT: "draft",
  ACTIVE: "active",
  SUPERSEDED: "superseded",
  ARCHIVED: "archived",
};

export function decisionRecordsCollection(hiveID) {
  if (!hiveID) {
    throw new Error("hiveID is required");
  }

  return collection(db, "Hive", String(hiveID), "decisionRecords");
}

export function buildDecisionRecord({
  title = "",
  summary = "",
  rationale = "",
  decision = "",
  status = DECISION_STATUSES.DRAFT,
  hiveID,
  honeycombID = "",
  parentMessageID = "",
  threadID = "",
  tags = [],
  risks = [],
  linkedFiles = [],
  linkedTaskIds = [],
  actionItems = [],
  supersedesDecisionId = "",
  supersededByDecisionId = "",
  ownerUserId = null,
  ownerDisplayName = null,
  createdByUserId = null,
  createdByDisplayName = null,
  generatedBy = "manual",
  source = null,
  rawSummaryText = "",
  closedAt = null,
}) {
  if (!hiveID) {
    throw new Error("hiveID is required");
  }

  return {
    title: String(title).trim(),
    summary: String(summary).trim(),
    rationale: String(rationale).trim(),
    decision: String(decision).trim(),
    status,
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    risks: Array.isArray(risks) ? risks.filter(Boolean) : [],
    linkedFiles: Array.isArray(linkedFiles) ? linkedFiles.filter(Boolean) : [],
    linkedTaskIds: Array.isArray(linkedTaskIds) ? linkedTaskIds.filter(Boolean) : [],
    actionItems: Array.isArray(actionItems) ? actionItems.filter(Boolean) : [],
    supersedesDecisionId: String(supersedesDecisionId || "").trim(),
    supersededByDecisionId: String(supersededByDecisionId || "").trim(),
    ownerUserId,
    ownerDisplayName,
    createdByUserId,
    createdByDisplayName,
    generatedBy,
    source:
      source && typeof source === "object"
        ? {
            hiveID: String(source.hiveID || hiveID),
            honeycombID: String(source.honeycombID || honeycombID || ""),
            parentMessageID: String(source.parentMessageID || parentMessageID || ""),
            threadID: String(source.threadID || threadID || ""),
          }
        : null,
    rawSummaryText: String(rawSummaryText || "").trim(),
    closedAt: closedAt || null,
    hiveID: String(hiveID),
    honeycombID: String(honeycombID || ""),
    parentMessageID: String(parentMessageID || ""),
    threadID: String(threadID || ""),
    updatedAt: serverTimestamp(),
  };
}

export async function createDecisionRecord({
  hiveID,
  decisionID,
  ...input
}) {
  if (!hiveID || !decisionID) {
    throw new Error("hiveID and decisionID are required");
  }

  const record = buildDecisionRecord({
    hiveID,
    ...input,
    status: normalizeDecisionStatus(input.status),
    supersedesDecisionId: normalizeSupersedesDecisionId(
      decisionID,
      input.supersedesDecisionId
    ),
  });
  const recordRef = doc(db, "Hive", String(hiveID), "decisionRecords", String(decisionID));

  await setDoc(
    recordRef,
    {
      ...record,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (record.supersedesDecisionId) {
    const supersededRef = doc(
      db,
      "Hive",
      String(hiveID),
      "decisionRecords",
      String(record.supersedesDecisionId)
    );
    await updateDoc(supersededRef, {
      status: DECISION_STATUSES.SUPERSEDED,
      supersededByDecisionId: recordRef.id,
      updatedAt: serverTimestamp(),
    });
  }

  await syncHiveDirectoryMetrics(String(hiveID), { touchLastActive: true });

  return recordRef.id;
}

export async function deleteDecisionRecord({ hiveID, decisionID }) {
  if (!hiveID || !decisionID) {
    throw new Error("hiveID and decisionID are required");
  }

  const hid = String(hiveID);
  const did = String(decisionID);
  const decisionRef = doc(db, "Hive", hid, "decisionRecords", did);

  const tasksRef = collection(db, "Hive", hid, "tasks");
  const tasksSnapshot = await getDocs(tasksRef);
  await Promise.all(
    tasksSnapshot.docs
      .filter((taskDoc) => String(taskDoc.data()?.linkedDecisionId || "") === did)
      .map((taskDoc) =>
        updateDoc(taskDoc.ref, {
          linkedDecisionId: "",
          linkedDecisionTitle: "",
          sourcePreview: {
            ...(taskDoc.data()?.sourcePreview || {}),
            decisionTitle: "",
            decisionSummary: "",
          },
          updatedAt: serverTimestamp(),
        })
      )
  );

  const decisionsRef = collection(db, "Hive", hid, "decisionRecords");
  const decisionsSnapshot = await getDocs(decisionsRef);
  await Promise.all(
    decisionsSnapshot.docs
      .filter((recordDoc) => recordDoc.id !== did)
      .map(async (recordDoc) => {
        const data = recordDoc.data() || {};
        const patch = {};

        if (String(data.supersedesDecisionId || "") === did) {
          patch.supersedesDecisionId = "";
        }

        if (String(data.supersededByDecisionId || "") === did) {
          patch.supersededByDecisionId = "";
          if (String(data.status || "").toLowerCase() === DECISION_STATUSES.SUPERSEDED) {
            patch.status = DECISION_STATUSES.ACTIVE;
          }
        }

        if (Object.keys(patch).length) {
          patch.updatedAt = serverTimestamp();
          await updateDoc(recordDoc.ref, patch);
        }
      })
  );

  await deleteDoc(decisionRef);
  await syncHiveDirectoryMetrics(hid, { touchLastActive: true });
}

export async function listDecisionRecords(hiveID) {
  const recordsRef = decisionRecordsCollection(hiveID);
  const recordsQuery = query(recordsRef, orderBy("updatedAt", "desc"));
  const snapshot = await getDocs(recordsQuery);

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

function sanitizeAttachmentList(raw) {
  const attachments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return attachments
    .filter(Boolean)
    .map((file) => ({
      name: String(file.name || file.filename || "file"),
      url: String(file.url || file.downloadURL || file.downloadUrl || ""),
      contentType: String(file.contentType || file.type || "unknown"),
      size: Number(file.size || 0),
    }));
}

function firstNonEmptyLine(text, fallback = "Decision Record") {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line || fallback;
}

function parseSummaryText(summaryText, parentText) {
  const raw = String(summaryText || "").trim();
  if (!raw) {
    return {
      title: firstNonEmptyLine(parentText, "Decision Record"),
      summary: String(parentText || "").trim(),
      rationale: "",
      decision: String(parentText || "").trim(),
      tags: [],
      risks: [],
      actionItems: [],
    };
  }

  const titleMatch = raw.match(/Title:\s*(.+)/i);
  const summaryMatch = raw.match(/Summary:\s*([\s\S]*?)(?:Follow-ups?:|$)/i);
  const followUpsMatch = raw.match(/Follow-ups?:\s*([\s\S]*)$/i);

  const actionItems = String(followUpsMatch?.[1] || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  return {
    title: String(titleMatch?.[1] || "").trim() || firstNonEmptyLine(parentText, "Decision Record"),
    summary: String(summaryMatch?.[1] || raw).trim(),
    rationale: String(summaryMatch?.[1] || "").trim(),
    decision: String(summaryMatch?.[1] || raw).trim(),
    tags: [],
    risks: [],
    actionItems,
  };
}

async function linkExistingTasksToDecision({
  hiveID,
  decisionID,
  decisionTitle,
  honeycombID,
  parentMessageID,
  decisionSummary,
}) {
  const tasksRef = collection(db, "Hive", String(hiveID), "tasks");
  const snapshot = await getDocs(tasksRef);
  const linkedTaskIds = [];

  for (const taskDoc of snapshot.docs) {
    const data = taskDoc.data();
    const matchesSource =
      String(data?.source?.honeycombID || "") === String(honeycombID || "") &&
      String(data?.source?.messageID || "") === String(parentMessageID || "");

    if (!matchesSource) continue;

    linkedTaskIds.push(taskDoc.id);

    await updateDoc(taskDoc.ref, {
      linkedDecisionId: String(decisionID),
      linkedDecisionTitle: String(decisionTitle || ""),
      source: {
        ...(data?.source || {}),
        decisionID: String(decisionID),
      },
      sourcePreview: {
        ...(data?.sourcePreview || {}),
        decisionTitle: String(decisionTitle || ""),
        decisionSummary: String(decisionSummary || ""),
      },
      updatedAt: serverTimestamp(),
    });
  }

  return linkedTaskIds;
}

export async function linkTaskToDecisionRecord({ hiveID, decisionID, taskID }) {
  if (!hiveID || !decisionID || !taskID) return;

  const decisionRef = doc(db, "Hive", String(hiveID), "decisionRecords", String(decisionID));
  await updateDoc(decisionRef, {
    linkedTaskIds: arrayUnion(String(taskID)),
    updatedAt: serverTimestamp(),
  });
}

export async function findDecisionRecordBySourceMessage({
  hiveID,
  honeycombID,
  parentMessageID,
}) {
  if (!hiveID || !parentMessageID) return null;

  const records = await listDecisionRecords(hiveID);
  return (
    records.find(
      (record) =>
        String(record.honeycombID || "") === String(honeycombID || "") &&
        String(record.parentMessageID || "") === String(parentMessageID)
    ) || null
  );
}

export async function generateAndStoreDecisionRecordForThread({
  hiveID,
  honeycombID,
  parentMessageID,
  threadID,
  closedByUser,
  summaryText = "",
}) {
  if (!hiveID || !honeycombID || !parentMessageID || !threadID) {
    throw new Error("Missing IDs for decision generation");
  }

  const parentRef = doc(
    db,
    "Hive",
    String(hiveID),
    "Honeycomb",
    String(honeycombID),
    "messages",
    String(parentMessageID)
  );

  const parentSnap = await getDoc(parentRef);
  const parentData = parentSnap.exists() ? parentSnap.data() : {};
  const parentText = String(parentData?.text || "").trim();
  const linkedFiles = sanitizeAttachmentList(parentData?.attachment);

  const threadRef = collection(
    db,
    "Hive",
    String(hiveID),
    "Honeycomb",
    String(honeycombID),
    "messages",
    String(parentMessageID),
    "Threads"
  );
  await getDocs(query(threadRef, orderBy("timestamp", "asc")));

  const fallback = parseSummaryText(summaryText, parentText);
  const normalized = normalizeDecisionRecordPayload(null, fallback);

  const decisionRecord = {
    title: String(normalized?.title || fallback.title || "").trim(),
    summary: String(normalized?.summary || fallback.summary || "").trim(),
    rationale: String(normalized?.rationale || fallback.rationale || "").trim(),
    decision: String(normalized?.decision || fallback.decision || "").trim(),
    tags: Array.isArray(normalized?.tags) ? normalized.tags.filter(Boolean) : fallback.tags,
    risks: Array.isArray(normalized?.risks) ? normalized.risks.filter(Boolean) : fallback.risks,
    actionItems: Array.isArray(normalized?.actionItems)
      ? normalized.actionItems.filter(Boolean)
      : fallback.actionItems,
  };

  const linkedTaskIds = await linkExistingTasksToDecision({
    hiveID,
    decisionID: threadID,
    decisionTitle: decisionRecord.title,
    honeycombID,
    parentMessageID,
    decisionSummary: decisionRecord.summary,
  });

  await createDecisionRecord({
    hiveID,
    decisionID: threadID,
    title: decisionRecord.title || "Decision Record",
    summary: decisionRecord.summary,
    rationale: decisionRecord.rationale,
    decision: decisionRecord.decision || decisionRecord.summary,
    status: DECISION_STATUSES.ACTIVE,
    honeycombID,
    parentMessageID,
    threadID,
    tags: decisionRecord.tags,
    risks: decisionRecord.risks,
    linkedFiles,
    linkedTaskIds,
    actionItems: decisionRecord.actionItems,
    ownerUserId: closedByUser?.uid || null,
    ownerDisplayName: closedByUser?.displayName || closedByUser?.email || null,
    createdByUserId: closedByUser?.uid || null,
    createdByDisplayName: closedByUser?.displayName || closedByUser?.email || null,
    generatedBy: "thread-close-ai",
    source: {
      hiveID,
      honeycombID,
      parentMessageID,
      threadID,
    },
    rawSummaryText: summaryText,
    closedAt: serverTimestamp(),
  });

  return threadID;
}
