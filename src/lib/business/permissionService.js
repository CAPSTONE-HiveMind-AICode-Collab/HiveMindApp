// src/lib/business/permissionService.js
import { HIVE_ROLES } from "@/lib/data/roleRepository";

/**
 * Central permission logic.
 * This is essentially your "ValidationEngine" from the VPP.
 */

export function canCreateHoneycomb(role) {
  return role === HIVE_ROLES.OWNER || role === HIVE_ROLES.ADMIN;
}

export function canSendMessages(role) {
  // Members, admins, and owners can chat
  return (
    role === HIVE_ROLES.OWNER ||
    role === HIVE_ROLES.ADMIN ||
    role === HIVE_ROLES.MEMBER
  );
}

export function canManageMembers(role) {
  return role === HIVE_ROLES.OWNER;
}

export function canManageThreads(role) {
  // Members, admins, and owners can close/open threads (not viewers)
  return (
    role === HIVE_ROLES.OWNER ||
    role === HIVE_ROLES.ADMIN ||
    role === HIVE_ROLES.MEMBER
  );
}

/**
 * Generic check the UI can call before an action.
 */
export function checkPermission(role, action) {
  switch (action) {
    case "CREATE_HONEYCOMB":
      return canCreateHoneycomb(role);
    case "SEND_MESSAGE":
      return canSendMessages(role);
    case "MANAGE_MEMBERS":
      return canManageMembers(role);
    case "MANAGE_THREADS":
      return canManageThreads(role);
    default:
      return false; // unknown action -> deny
  }
}
