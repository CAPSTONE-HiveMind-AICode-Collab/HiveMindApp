// src/lib/data/roleRepository.js
import { db } from "@/lib/firebase/config";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";

// Allowed roles for a hive
export const HIVE_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

/**
 * Create/update a member document for this hive.
 * Path: Hive/{hiveID}/members/{uid}
 */
export async function setUserRoleForHive(hiveID, uid, role, profile = {}) {
  if (!hiveID || !uid) throw new Error("Missing hiveID or uid");
  const memberRef = doc(db, "Hive", hiveID, "members", uid);

  await setDoc(
    memberRef,
    {
      role,
      displayName: profile.displayName || null,
      email: profile.email || null,
    },
    { merge: true }
  );

  return { hiveID, uid, role };
}

/**
 * Get the role of the given user for this hive.
 * Defaults to VIEWER if no document exists.
 */
export async function getUserRoleForHive(hiveID, uid) {
  if (!hiveID || !uid) return HIVE_ROLES.VIEWER;
  const memberRef = doc(db, "Hive", hiveID, "members", uid);
  const snap = await getDoc(memberRef);

  if (!snap.exists()) return HIVE_ROLES.VIEWER;

  const data = snap.data();
  return data.role || HIVE_ROLES.VIEWER;
}

/**
 * List all members of a hive with their roles.
 */
export async function listHiveMembers(hiveID) {
  if (!hiveID) return [];
  const membersRef = collection(db, "Hive", hiveID, "members");
  const snap = await getDocs(membersRef);
  return snap.docs.map((d) => ({
    uid: d.id,
    ...d.data(),
  }));
}
