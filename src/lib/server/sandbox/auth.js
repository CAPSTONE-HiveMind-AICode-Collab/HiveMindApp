import { NextResponse } from "next/server";
import {
  adminAuth,
  adminDb,
  isFirebaseAdminConfigured,
} from "@/lib/firebase/firebaseAdmin";

const ROLE_RANK = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2,
  VIEWER: 3,
};

function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status });
}

function extractToken(req) {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  let token = "";

  try {
    token = new URL(req.url).searchParams.get("token") || "";
  } catch {
    token = "";
  }

  if (!token) {
    token = req.nextUrl?.searchParams?.get("token") || "";
  }

  return String(token || "").trim();
}

export async function authenticateSandboxRequest(req, hiveID) {
  if (!isFirebaseAdminConfigured || !adminAuth || !adminDb) {
    return {
      error: jsonError(
        "Firebase Admin SDK is not configured. Secure sandbox routes need FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
        500
      ),
    };
  }

  const token = extractToken(req);
  if (!token) {
    return { error: jsonError("Authentication required.", 401) };
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error("Sandbox route token verification failed:", error);
    return { error: jsonError("Invalid or expired token.", 401) };
  }

  if (!hiveID) {
    return {
      auth: {
        uid: decodedToken.uid,
      },
    };
  }

  const memberRef = adminDb
    .collection("Hive")
    .doc(String(hiveID))
    .collection("members")
    .doc(decodedToken.uid);
  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    return {
      error: jsonError("You do not have access to this hive.", 403),
    };
  }

  return {
    auth: {
      uid: decodedToken.uid,
      role: String(memberSnap.data()?.role || "VIEWER"),
    },
  };
}

export function hasSandboxRole(role, minimumRole = "VIEWER") {
  const currentRank = ROLE_RANK[String(role || "").toUpperCase()] ?? 99;
  const minimumRank = ROLE_RANK[String(minimumRole || "").toUpperCase()] ?? 99;
  return currentRank <= minimumRank;
}

export async function loadSandboxRoomConfig(hiveID, honeycombID) {
  if (!isFirebaseAdminConfigured || !adminDb) {
    throw new Error("Firebase Admin SDK is not configured.");
  }

  if (!hiveID || !honeycombID) {
    throw new Error("hiveID and honeycombID are required.");
  }

  const roomRef = adminDb
    .collection("Hive")
    .doc(String(hiveID))
    .collection("Honeycomb")
    .doc(String(honeycombID));
  const roomSnap = await roomRef.get();

  if (!roomSnap.exists) {
    throw new Error("This room no longer exists.");
  }

  return roomSnap.data()?.sandbox || {};
}
