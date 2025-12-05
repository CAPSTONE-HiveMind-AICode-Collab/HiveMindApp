const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

/**
 * Cloud Function: Set user custom claims for role-based access control
 * Only hive owners can assign roles
 */
exports.setUserRole = onCall(async (request) => {
  const { hiveID, targetUserID, role } = request.data;
  const callerUID = request.auth?.uid;

  if (!callerUID) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  if (!hiveID || !targetUserID || !role) {
    throw new HttpsError("invalid-argument", "Missing required fields: hiveID, targetUserID, role");
  }

  const validRoles = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
  if (!validRoles.includes(role)) {
    throw new HttpsError("invalid-argument", `Invalid role. Must be one of: ${validRoles.join(", ")}`);
  }

  try {
    const db = admin.firestore();

    // Verify caller is hive owner
    const hiveDoc = await db.collection("Hive").doc(hiveID).get();
    if (!hiveDoc.exists) {
      throw new HttpsError("not-found", "Hive not found");
    }

    const hiveData = hiveDoc.data();
    if (hiveData.ownerId !== callerUID) {
      throw new HttpsError("permission-denied", "Only hive owner can assign roles");
    }

    // Set custom claims on user account
    const currentClaims = (await admin.auth().getUser(targetUserID)).customClaims || {};
    const hiveClaims = currentClaims.hives || {};
    hiveClaims[hiveID] = role;

    await admin.auth().setCustomUserClaims(targetUserID, {
      ...currentClaims,
      hives: hiveClaims,
    });

    // Also update Firestore member record
    await db
      .collection("Hive")
      .doc(hiveID)
      .collection("members")
      .doc(targetUserID)
      .set(
        {
          role,
          updatedBy: callerUID,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // Audit log
    await db.collection("auditLogs").add({
      event: "ROLE_CHANGED_ADMIN",
      userId: callerUID,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      success: true,
      details: {
        hiveID,
        targetUserId: targetUserID,
        newRole: role,
        method: "customClaims",
      },
    });

    logger.info(`Role set via custom claims: ${targetUserID} -> ${role} in hive ${hiveID}`);

    return { success: true, message: `Role ${role} assigned to user ${targetUserID}` };
  } catch (error) {
    logger.error("Failed to set user role:", error);
    throw new HttpsError("internal", error.message);
  }
});

/**
 * Cloud Function: Verify user has required role in hive
 * Used for sensitive operations requiring server-side validation
 */
exports.verifyHiveAccess = onCall(async (request) => {
  const { hiveID, requiredRole } = request.data;
  const callerUID = request.auth?.uid;

  if (!callerUID) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  if (!hiveID) {
    throw new HttpsError("invalid-argument", "Missing hiveID");
  }

  try {
    const db = admin.firestore();

    // Check custom claims first (fastest)
    const userRecord = await admin.auth().getUser(callerUID);
    const customClaims = userRecord.customClaims || {};
    const userRole = customClaims.hives?.[hiveID];

    if (!userRole) {
      // Fallback to Firestore check
      const memberDoc = await db
        .collection("Hive")
        .doc(hiveID)
        .collection("members")
        .doc(callerUID)
        .get();

      if (!memberDoc.exists) {
        throw new HttpsError("permission-denied", "User is not a member of this hive");
      }

      const memberRole = memberDoc.data().role;

      // Sync custom claims if missing
      const hiveClaims = customClaims.hives || {};
      hiveClaims[hiveID] = memberRole;
      await admin.auth().setCustomUserClaims(callerUID, {
        ...customClaims,
        hives: hiveClaims,
      });

      return { hasAccess: true, role: memberRole };
    }

    // Verify role hierarchy if required role specified
    if (requiredRole) {
      const roleHierarchy = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };
      const hasAccess = roleHierarchy[userRole] >= roleHierarchy[requiredRole];

      if (!hasAccess) {
        throw new HttpsError(
          "permission-denied",
          `Requires ${requiredRole} role or higher. User has ${userRole}`
        );
      }
    }

    return { hasAccess: true, role: userRole };
  } catch (error) {
    logger.error("Failed to verify hive access:", error);
    throw error;
  }
});

/**
 * Cloud Function: Revoke all user access to a hive (ban user)
 * Only hive owner can revoke access
 */
exports.revokeHiveAccess = onCall(async (request) => {
  const { hiveID, targetUserID, reason } = request.data;
  const callerUID = request.auth?.uid;

  if (!callerUID) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  if (!hiveID || !targetUserID) {
    throw new HttpsError("invalid-argument", "Missing required fields: hiveID, targetUserID");
  }

  try {
    const db = admin.firestore();

    // Verify caller is hive owner
    const hiveDoc = await db.collection("Hive").doc(hiveID).get();
    if (!hiveDoc.exists) {
      throw new HttpsError("not-found", "Hive not found");
    }

    const hiveData = hiveDoc.data();
    if (hiveData.ownerId !== callerUID) {
      throw new HttpsError("permission-denied", "Only hive owner can revoke access");
    }

    // Cannot revoke owner's own access
    if (targetUserID === callerUID) {
      throw new HttpsError("invalid-argument", "Owner cannot revoke their own access");
    }

    // Remove from hive members array
    await db
      .collection("Hive")
      .doc(hiveID)
      .update({
        members: admin.firestore.FieldValue.arrayRemove(targetUserID),
      });

    // Delete member document
    await db.collection("Hive").doc(hiveID).collection("members").doc(targetUserID).delete();

    // Remove custom claims for this hive
    const userRecord = await admin.auth().getUser(targetUserID);
    const customClaims = userRecord.customClaims || {};
    const hiveClaims = customClaims.hives || {};
    delete hiveClaims[hiveID];

    await admin.auth().setCustomUserClaims(targetUserID, {
      ...customClaims,
      hives: hiveClaims,
    });

    // Audit log
    await db.collection("auditLogs").add({
      event: "ACCESS_REVOKED",
      userId: callerUID,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      success: true,
      details: {
        hiveID,
        targetUserId: targetUserID,
        reason: reason || "Access revoked by owner",
      },
    });

    logger.info(`Access revoked for user ${targetUserID} in hive ${hiveID}`);

    return { success: true, message: `Access revoked for user ${targetUserID}` };
  } catch (error) {
    logger.error("Failed to revoke hive access:", error);
    throw new HttpsError("internal", error.message);
  }
});

/**
 * Cloud Function: Get user's effective permissions in a hive
 * Returns detailed permission breakdown
 */
exports.getUserPermissions = onCall(async (request) => {
  const { hiveID } = request.data;
  const callerUID = request.auth?.uid;

  if (!callerUID) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  if (!hiveID) {
    throw new HttpsError("invalid-argument", "Missing hiveID");
  }

  try {
    const db = admin.firestore();

    // Get user role from custom claims
    const userRecord = await admin.auth().getUser(callerUID);
    const customClaims = userRecord.customClaims || {};
    const userRole = customClaims.hives?.[hiveID];

    if (!userRole) {
      return {
        hasAccess: false,
        role: null,
        permissions: {
          canRead: false,
          canWrite: false,
          canDelete: false,
          canManageMembers: false,
          canCreateHoneycomb: false,
          canDeleteHive: false,
        },
      };
    }

    // Define permissions per role
    const permissions = {
      OWNER: {
        canRead: true,
        canWrite: true,
        canDelete: true,
        canManageMembers: true,
        canCreateHoneycomb: true,
        canDeleteHive: true,
      },
      ADMIN: {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageMembers: true,
        canCreateHoneycomb: true,
        canDeleteHive: false,
      },
      MEMBER: {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageMembers: false,
        canCreateHoneycomb: false,
        canDeleteHive: false,
      },
      VIEWER: {
        canRead: true,
        canWrite: false,
        canDelete: false,
        canManageMembers: false,
        canCreateHoneycomb: false,
        canDeleteHive: false,
      },
    };

    return {
      hasAccess: true,
      role: userRole,
      permissions: permissions[userRole],
    };
  } catch (error) {
    logger.error("Failed to get user permissions:", error);
    throw new HttpsError("internal", error.message);
  }
});
