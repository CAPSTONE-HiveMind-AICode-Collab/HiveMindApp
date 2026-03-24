// src/lib/data/roleRepository.js
import { db } from "@/lib/firebase/config";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

// Allowed roles for a hive
export const HIVE_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

export const ONBOARDING_TEAM_ROLES = [
  {
    id: "founder",
    label: "Founder",
    subtitle: "Vision, priorities, decisions",
    hiveRole: HIVE_ROLES.OWNER,
  },
  {
    id: "lead-dev",
    label: "Lead Dev",
    subtitle: "Architecture and technical calls",
    hiveRole: HIVE_ROLES.ADMIN,
  },
  {
    id: "team-member",
    label: "Team Member",
    subtitle: "Build and ship the work",
    hiveRole: HIVE_ROLES.MEMBER,
  },
];

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
      photoURL: profile.photoURL || null,
    },
    { merge: true }
  );

  return { hiveID, uid, role };
}

export async function setUserOnboardingProfile(uid, profile = {}) {
  if (!uid) throw new Error("Missing uid");

  const userRef = doc(db, "Users", String(uid));
  const payload = {
    onboarding: {
      teamRoleId: String(profile.teamRoleId || "").trim(),
      teamRoleLabel: String(profile.teamRoleLabel || "").trim(),
      hiveName: String(profile.hiveName || "").trim(),
      invitedEmails: Array.isArray(profile.invitedEmails)
        ? profile.invitedEmails.map((email) => String(email).trim()).filter(Boolean)
        : [],
      updatedAt: serverTimestamp(),
    },
  };

  await setDoc(userRef, payload, { merge: true });
  return payload.onboarding;
}

export async function getHiveMemberProfile(hiveID, uid) {
  if (!hiveID || !uid) return null;

  const memberRef = doc(db, "Hive", String(hiveID), "members", String(uid));
  const snapshot = await getDoc(memberRef);

  if (!snapshot.exists()) return null;

  return {
    uid: snapshot.id,
    ...snapshot.data(),
  };
}

export async function markHiveBriefingSeen(hiveID, uid) {
  if (!hiveID || !uid) {
    throw new Error("Missing hiveID or uid");
  }

  const memberRef = doc(db, "Hive", String(hiveID), "members", String(uid));
  await setDoc(
    memberRef,
    {
      hasSeenBriefing: true,
      lastActive: serverTimestamp(),
    },
    { merge: true }
  );
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
  return snap.docs.map((memberDoc) => ({
    uid: memberDoc.id,
    ...memberDoc.data(),
  }));
}
