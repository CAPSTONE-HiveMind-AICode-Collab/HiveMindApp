import { httpsCallable } from "firebase/functions";
import { getFunctions } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/config";

const functions = getFunctions(firebaseApp);

/**
 * Call Cloud Function to set user role with custom claims (server-side enforcement)
 * @param {string} hiveID - Hive ID
 * @param {string} targetUserID - User to assign role to
 * @param {string} role - Role to assign (OWNER, ADMIN, MEMBER, VIEWER)
 * @returns {Promise<Object>} Result
 */
export async function setUserRoleWithClaims(hiveID, targetUserID, role) {
  const setUserRole = httpsCallable(functions, "setUserRole");
  
  try {
    const result = await setUserRole({ hiveID, targetUserID, role });
    return result.data;
  } catch (error) {
    console.error("Failed to set user role:", error);
    throw error;
  }
}

/**
 * Verify user has access to hive (server-side check)
 * @param {string} hiveID - Hive ID
 * @param {string} requiredRole - Optional minimum role required
 * @returns {Promise<Object>} { hasAccess: boolean, role: string }
 */
export async function verifyHiveAccessServerSide(hiveID, requiredRole = null) {
  const verifyAccess = httpsCallable(functions, "verifyHiveAccess");
  
  try {
    const result = await verifyAccess({ hiveID, requiredRole });
    return result.data;
  } catch (error) {
    console.error("Access verification failed:", error);
    throw error;
  }
}

/**
 * Revoke user's access to hive (ban user)
 * @param {string} hiveID - Hive ID
 * @param {string} targetUserID - User to ban
 * @param {string} reason - Reason for ban
 * @returns {Promise<Object>} Result
 */
export async function revokeHiveAccessServerSide(hiveID, targetUserID, reason = "") {
  const revokeAccess = httpsCallable(functions, "revokeHiveAccess");
  
  try {
    const result = await revokeAccess({ hiveID, targetUserID, reason });
    return result.data;
  } catch (error) {
    console.error("Failed to revoke access:", error);
    throw error;
  }
}

/**
 * Get detailed permissions for current user in hive
 * @param {string} hiveID - Hive ID
 * @returns {Promise<Object>} { hasAccess, role, permissions: { canRead, canWrite, ... } }
 */
export async function getUserPermissionsServerSide(hiveID) {
  const getPermissions = httpsCallable(functions, "getUserPermissions");
  
  try {
    const result = await getPermissions({ hiveID });
    return result.data;
  } catch (error) {
    console.error("Failed to get permissions:", error);
    throw error;
  }
}
