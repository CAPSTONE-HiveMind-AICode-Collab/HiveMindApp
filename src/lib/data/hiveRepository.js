import { db } from "@/lib/firebase/config";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

const CLOSED_TASK_STATUSES = new Set([
  "done",
  "closed",
  "complete",
  "completed",
  "archived",
  "cancelled",
  "canceled",
]);

function normalizeMemberIds(members) {
  return Array.from(
    new Set(
      (Array.isArray(members) ? members : [])
        .map((member) => {
          if (typeof member === "string") return member.trim();
          if (member && typeof member === "object") {
            return String(member.uid || member.userID || "").trim();
          }
          return "";
        })
        .filter(Boolean)
    )
  );
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isOpenTask(status) {
  return !CLOSED_TASK_STATUSES.has(String(status || "todo").trim().toLowerCase());
}

export function buildHiveDirectoryDefaults({ ownerId = "", members = [] } = {}) {
  return {
    members: normalizeMemberIds([ownerId, ...members]),
    decisionCount: 0,
    openTasks: 0,
    lastActive: serverTimestamp(),
  };
}

export async function touchHiveLastActive(hiveID, extra = null) {
  const hid = String(hiveID || "").trim();
  if (!hid) return;

  const payload = {
    lastActive: serverTimestamp(),
  };

  if (extra && typeof extra === "object") {
    Object.assign(payload, extra);
  }

  await setDoc(doc(db, "Hive", hid), payload, { merge: true });
}

export async function syncHiveDirectoryMetrics(
  hiveID,
  { currentHive = null, touchLastActive = false } = {}
) {
  const hid = String(hiveID || "").trim();
  if (!hid) {
    throw new Error("hiveID is required");
  }

  const hiveRef = doc(db, "Hive", hid);
  const [hiveSnap, tasksSnap, decisionsSnap, membersSnap] = await Promise.all([
    currentHive ? Promise.resolve(null) : getDoc(hiveRef),
    getDocs(collection(db, "Hive", hid, "tasks")),
    getDocs(collection(db, "Hive", hid, "decisionRecords")),
    getDocs(collection(db, "Hive", hid, "members")),
  ]);

  const hiveData = currentHive || (hiveSnap?.exists() ? hiveSnap.data() : null);
  if (!hiveData) return null;

  const memberIds = normalizeMemberIds([
    ...(Array.isArray(hiveData.members) ? hiveData.members : []),
    ...membersSnap.docs.map((memberDoc) => memberDoc.id),
  ]);

  const payload = {
    members: memberIds,
    decisionCount: decisionsSnap.size,
    openTasks: tasksSnap.docs.reduce((count, taskDoc) => {
      return count + (isOpenTask(taskDoc.data()?.status) ? 1 : 0);
    }, 0),
  };

  if (touchLastActive) {
    payload.lastActive = serverTimestamp();
  } else if (!hiveData.lastActive) {
    payload.lastActive = hiveData.updatedAt || hiveData.createdAt || new Date();
  }

  await setDoc(hiveRef, payload, { merge: true });

  return {
    ...hiveData,
    ...payload,
  };
}

export async function ensureHiveDirectoryMetadata(hiveID, hiveData = null) {
  const hid = String(hiveID || "").trim();
  if (!hid) return null;

  let currentHive = hiveData;

  if (!currentHive) {
    const hiveSnap = await getDoc(doc(db, "Hive", hid));
    if (!hiveSnap.exists()) return null;
    currentHive = hiveSnap.data();
  }

  const members = normalizeMemberIds(currentHive.members);
  const hasCompleteMetadata =
    members.length > 0 &&
    isFiniteNumber(currentHive.decisionCount) &&
    isFiniteNumber(currentHive.openTasks) &&
    Boolean(currentHive.lastActive);

  if (hasCompleteMetadata) {
    return {
      ...currentHive,
      members,
    };
  }

  return syncHiveDirectoryMetrics(hid, {
    currentHive: {
      ...currentHive,
      members,
    },
  });
}

export async function listHiveMemberPreview(hiveID, memberIds = [], limit = 4) {
  const hid = String(hiveID || "").trim();
  if (!hid) return [];

  const membersSnap = await getDocs(collection(db, "Hive", hid, "members"));
  const memberDocs = membersSnap.docs.map((memberDoc) => ({
    uid: memberDoc.id,
    ...memberDoc.data(),
  }));

  const preferredOrder = normalizeMemberIds(memberIds);
  const orderedMembers = preferredOrder.length
    ? preferredOrder
        .map((uid) => memberDocs.find((member) => member.uid === uid) || { uid })
        .filter(Boolean)
    : memberDocs;

  const results = [];
  const seen = new Set();

  for (const member of orderedMembers) {
    if (!member?.uid || seen.has(member.uid)) continue;
    seen.add(member.uid);
    results.push(member);
    if (results.length >= limit) break;
  }

  return results;
}

export function getHiveMemberCount(hive) {
  return normalizeMemberIds(hive?.members).length;
}
