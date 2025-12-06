import { db } from "@/lib/firebase/config";
import { collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from "firebase/firestore";

/**
 * Audit Log Service
 * Tracks security-relevant events for compliance and monitoring
 * Part of Functional Area 3: Security & Cloud Infrastructure
 */

// Event types
export const AUDIT_EVENTS = {
  // Authentication
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",
  
  // Hive operations
  HIVE_CREATED: "HIVE_CREATED",
  HIVE_DELETED: "HIVE_DELETED",
  HIVE_UPDATED: "HIVE_UPDATED",
  
  // Member operations
  MEMBER_ADDED: "MEMBER_ADDED",
  MEMBER_REMOVED: "MEMBER_REMOVED",
  ROLE_CHANGED: "ROLE_CHANGED",
  
  // Access control
  ACCESS_DENIED: "ACCESS_DENIED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  
  // File operations
  FILE_UPLOADED: "FILE_UPLOADED",
  FILE_DELETED: "FILE_DELETED",
  FILE_DOWNLOAD: "FILE_DOWNLOAD",
  
  // Data operations
  MESSAGE_CREATED: "MESSAGE_CREATED",
  MESSAGE_DELETED: "MESSAGE_DELETED",
  THREAD_CREATED: "THREAD_CREATED",
  SUMMARY_GENERATED: "SUMMARY_GENERATED",
  
  // Security events
  INVALID_TOKEN: "INVALID_TOKEN",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  SUSPICIOUS_ACTIVITY: "SUSPICIOUS_ACTIVITY",
};

/**
 * Log an audit event
 * @param {string} event - Event type from AUDIT_EVENTS
 * @param {string} userId - User who performed the action
 * @param {Object} details - Additional event details
 * @param {boolean} success - Whether the action succeeded
 * @returns {Promise<string>} Document ID of the created log
 */
export async function logAuditEvent(event, userId, details = {}, success = true) {
  try {
    const auditLog = {
      event,
      userId,
      timestamp: serverTimestamp(),
      success,
      details,
      // Optional: Add IP address if available (requires backend)
      // ip: details.ip || null,
    };

    const docRef = await addDoc(collection(db, "auditLogs"), auditLog);
    console.log(`Audit log created: ${event} by ${userId}`);
    return docRef.id;
  } catch (error) {
    // Don't throw on audit failures to avoid breaking app flow
    console.error("Failed to create audit log:", error);
    return null;
  }
}

/**
 * Log authentication events
 */
export async function logLogin(userId) {
  return logAuditEvent(AUDIT_EVENTS.LOGIN, userId, { method: "Google OAuth" }, true);
}

export async function logLogout(userId) {
  return logAuditEvent(AUDIT_EVENTS.LOGOUT, userId, {}, true);
}

export async function logLoginFailed(userId, reason) {
  return logAuditEvent(AUDIT_EVENTS.LOGIN_FAILED, userId, { reason }, false);
}

/**
 * Log hive operations
 */
export async function logHiveCreated(userId, hiveID, hiveName) {
  return logAuditEvent(AUDIT_EVENTS.HIVE_CREATED, userId, { hiveID, hiveName }, true);
}

export async function logHiveDeleted(userId, hiveID, hiveName) {
  return logAuditEvent(AUDIT_EVENTS.HIVE_DELETED, userId, { hiveID, hiveName }, true);
}

export async function logHiveUpdated(userId, hiveID, changes) {
  return logAuditEvent(AUDIT_EVENTS.HIVE_UPDATED, userId, { hiveID, changes }, true);
}

/**
 * Log member operations
 */
export async function logMemberAdded(userId, hiveID, newMemberId, role) {
  return logAuditEvent(AUDIT_EVENTS.MEMBER_ADDED, userId, { hiveID, newMemberId, role }, true);
}

export async function logMemberRemoved(userId, hiveID, removedMemberId) {
  return logAuditEvent(AUDIT_EVENTS.MEMBER_REMOVED, userId, { hiveID, removedMemberId }, true);
}

export async function logRoleChanged(userId, hiveID, targetUserId, oldRole, newRole) {
  return logAuditEvent(AUDIT_EVENTS.ROLE_CHANGED, userId, { hiveID, targetUserId, oldRole, newRole }, true);
}

/**
 * Log access control events
 */
export async function logAccessDenied(userId, resource, reason) {
  return logAuditEvent(AUDIT_EVENTS.ACCESS_DENIED, userId, { resource, reason }, false);
}

export async function logPermissionDenied(userId, action, resource, requiredRole) {
  return logAuditEvent(AUDIT_EVENTS.PERMISSION_DENIED, userId, { action, resource, requiredRole }, false);
}

/**
 * Log file operations
 */
export async function logFileUploaded(userId, hiveID, fileName, fileSize, fileType) {
  return logAuditEvent(AUDIT_EVENTS.FILE_UPLOADED, userId, { hiveID, fileName, fileSize, fileType }, true);
}

export async function logFileDeleted(userId, hiveID, fileName) {
  return logAuditEvent(AUDIT_EVENTS.FILE_DELETED, userId, { hiveID, fileName }, true);
}

export async function logFileDownload(userId, hiveID, fileName) {
  return logAuditEvent(AUDIT_EVENTS.FILE_DOWNLOAD, userId, { hiveID, fileName }, true);
}

/**
 * Log data operations
 */
export async function logMessageCreated(userId, hiveID, honeycombID, messageID) {
  return logAuditEvent(AUDIT_EVENTS.MESSAGE_CREATED, userId, { hiveID, honeycombID, messageID }, true);
}

export async function logMessageDeleted(userId, hiveID, honeycombID, messageID) {
  return logAuditEvent(AUDIT_EVENTS.MESSAGE_DELETED, userId, { hiveID, honeycombID, messageID }, true);
}

export async function logThreadCreated(userId, hiveID, honeycombID, messageID, threadID) {
  return logAuditEvent(AUDIT_EVENTS.THREAD_CREATED, userId, { hiveID, honeycombID, messageID, threadID }, true);
}

export async function logSummaryGenerated(userId, hiveID, honeycombID, summaryType) {
  return logAuditEvent(AUDIT_EVENTS.SUMMARY_GENERATED, userId, { hiveID, honeycombID, summaryType }, true);
}

/**
 * Log security events
 */
export async function logInvalidToken(userId) {
  return logAuditEvent(AUDIT_EVENTS.INVALID_TOKEN, userId, {}, false);
}

export async function logRateLimitExceeded(userId, endpoint) {
  return logAuditEvent(AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, userId, { endpoint }, false);
}

export async function logSuspiciousActivity(userId, description) {
  return logAuditEvent(AUDIT_EVENTS.SUSPICIOUS_ACTIVITY, userId, { description }, false);
}

/**
 * Query audit logs (for admin dashboard)
 * @param {Object} filters - Query filters
 * @returns {Promise<Array>} Array of audit log entries
 */
export async function getAuditLogs(filters = {}) {
  try {
    let q = collection(db, "auditLogs");

    // Apply filters
    const constraints = [];
    
    if (filters.userId) {
      constraints.push(where("userId", "==", filters.userId));
    }
    
    if (filters.event) {
      constraints.push(where("event", "==", filters.event));
    }
    
    if (filters.success !== undefined) {
      constraints.push(where("success", "==", filters.success));
    }
    
    // Always order by timestamp (newest first)
    constraints.push(orderBy("timestamp", "desc"));
    
    // Limit results
    const maxResults = filters.limit || 100;
    constraints.push(limit(maxResults));

    q = query(q, ...constraints);
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate(), // Convert Firestore timestamp
    }));
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    throw error;
  }
}

/**
 * Get recent security events (for dashboard alerts)
 * @param {number} hours - Look back this many hours
 * @returns {Promise<Array>} Recent security events
 */
export async function getRecentSecurityEvents(hours = 24) {
  const securityEvents = [
    AUDIT_EVENTS.ACCESS_DENIED,
    AUDIT_EVENTS.PERMISSION_DENIED,
    AUDIT_EVENTS.INVALID_TOKEN,
    AUDIT_EVENTS.RATE_LIMIT_EXCEEDED,
    AUDIT_EVENTS.SUSPICIOUS_ACTIVITY,
  ];

  try {
    const results = [];
    for (const event of securityEvents) {
      const logs = await getAuditLogs({ event, limit: 20 });
      results.push(...logs);
    }

    // Sort by timestamp and filter by time window
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return results
      .filter(log => log.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("Failed to fetch security events:", error);
    return [];
  }
}

/**
 * Get audit log statistics
 * @param {string} hiveID - Optional hive filter
 * @returns {Promise<Object>} Statistics object
 */
export async function getAuditStats(hiveID = null) {
  try {
    let q = collection(db, "auditLogs");
    
    if (hiveID) {
      q = query(q, where("details.hiveID", "==", hiveID));
    }
    
    q = query(q, orderBy("timestamp", "desc"), limit(1000));
    const snapshot = await getDocs(q);

    const logs = snapshot.docs.map(doc => doc.data());

    // Calculate statistics
    const stats = {
      total: logs.length,
      successful: logs.filter(log => log.success).length,
      failed: logs.filter(log => log.success === false).length,
      byEvent: {},
      recentActivity: logs.slice(0, 10),
    };

    // Count by event type
    logs.forEach(log => {
      stats.byEvent[log.event] = (stats.byEvent[log.event] || 0) + 1;
    });

    return stats;
  } catch (error) {
    console.error("Failed to get audit stats:", error);
    return { total: 0, successful: 0, failed: 0, byEvent: {}, recentActivity: [] };
  }
}
