// src/lib/business/notificationService.js
import { db } from "../firebase/config";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  updateDoc,
  doc,
  where,
  addDoc,
  serverTimestamp,
  getDoc,
  setDoc,
  deleteDoc,
} from "firebase/firestore";

import {
  addNotificationToDB,
  getNotificationsFromDB,
  updateNotificationRead,
} from "@/lib/data/firestoreRepository";

/* --------------------- CORE NOTIFICATION LOGIC --------------------- */

/**
 * Create a notification object
 */
function createNotification({ type, hiveID, honeycombID, threadID, message, notifyAt = null }) {
  return {
    type,
    hiveID: hiveID || null,
    honeycombID: honeycombID || null,
    threadID: threadID || null,
    message: message || "(no message)",
    notifyAt: notifyAt || null,
    timestamp: serverTimestamp(), // ✅ Use Firestore timestamp
    read: false,
  };
}

/**
 * Send a notification to multiple users
 */
export async function notifyUsers(userIDs, notificationData) {
  const notification = createNotification(notificationData);
  for (const userID of userIDs) {
    if (!userID) continue;
    const userNotifRef = collection(db, "Users", userID, "notifications");
    await addDoc(userNotifRef, notification);
  }
}

/**
 * Notify when a thread is closed
 */
export async function notifyThreadClosed(hiveID, honeycombID, threadID) {
  // Fetch thread participants
  const threadRef = doc(db, "Threads", threadID);
  const threadSnap = await getDoc(threadRef);

  if (!threadSnap.exists()) {
    console.error("Thread not found:", threadID);
    return;
  }

  const threadData = threadSnap.data();
  const userIDs = threadData.participants || [];

  if (userIDs.length === 0) {
    console.warn("No participants to notify for thread:", threadID);
    return;
  }

  const message = `Thread ${threadID} in Honeycomb ${honeycombID} has been closed.`;
  console.log("notifyThreadClosed -> sending to userIDs:", userIDs);

  await notifyUsers(userIDs, { type: "THREAD_CLOSED", hiveID, honeycombID, threadID, message });
}

/**
 * Notify when a thread is updated (new message, status change)
 */
export async function notifyThreadUpdated(hiveID, honeycombID, threadID, userIDs, updateInfo) {
  const message = `Thread ${threadID} updated: ${updateInfo}`;
  await notifyUsers(userIDs, { type: "THREAD_UPDATED", hiveID, honeycombID, threadID, message });
}

/**
 * Notify multiple threads at once
 */
export async function notifyMultipleThreads(threadNotifications) {
  for (const tn of threadNotifications) {
    await notifyUsers(tn.userIDs, {
      type: tn.type,
      hiveID: tn.hiveID,
      honeycombID: tn.honeycombID,
      threadID: tn.threadID,
      message: tn.message,
      notifyAt: tn.notifyAt || null,
    });
  }
}

/**
 * Schedule a time-based notification
 * Relies on client-side polling instead of Cloud Functions
 */
export async function scheduleTimeBasedNotification(
  hiveID,
  honeycombID,
  threadID,
  userIDs,
  message,
  notifyAt,
  type = "TIME_BASED"
) {
  const notification = createNotification({
    type,          // use the passed type
    hiveID,
    honeycombID,
    threadID,
    message,
    notifyAt,
  });

  for (const userID of userIDs) {
    const userNotifRef = collection(db, "Users", userID, "notifications");
    await addDoc(userNotifRef, notification);
  }
}


/* --------------------- CLIENT-SIDE LISTENERS --------------------- */

/**
 * Listen to *all* notifications for a user in real-time.
 */
export function listenToNotifications(userID, callback) {
  if (!userID) return () => {};

  const notificationsRef = collection(db, "Users", userID, "notifications");
  const q = query(notificationsRef, orderBy("timestamp", "desc")); // ✅ newest first

  return onSnapshot(q, (snapshot) => {
    const notifications = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  
    // 🔹 Debug log
    console.log("Notifications fetched for user:", userID, notifications);

    // ✅ Sort by timestamp just in case
    const sorted = notifications.sort((a, b) => {
      const tA = a.timestamp?.toDate?.() ?? new Date(0);
      const tB = b.timestamp?.toDate?.() ?? new Date(0);
      return tB - tA;
    });

    callback(sorted);
  });
}



/**
 * Poll for *only* due time-based notifications (used for triggering events).
 */
export async function pollTimeBasedNotifications(userID) {
  if (!userID) return [];

  const allNotifications = await getNotificationsFromDB(userID);
  const now = new Date();

  // ✅ Only return due TIME_BASED notifications for triggering (not for display)
  return allNotifications.filter(
    (notif) =>
      notif.type === "TIME_BASED" &&
      notif.notifyAt &&
      new Date(notif.notifyAt) <= now &&
      !notif.read
  );
}


/**
 * Mark a notification as read
 */
export async function markNotificationRead(userID, notificationID) {
  await updateNotificationRead(userID, notificationID, true);
}

/* --------------------- JOIN REQUEST LOGIC --------------------- */

/**
 * Send a join request notification to honeycomb owner
 */
export async function sendJoinRequest(honeycombID, requestingUserID, requestingUserName) {
  try {
    // Get honeycomb data to find the owner
    // First, we need to find which hive this honeycomb belongs to
    // Since honeycomb is stored under Hive/{hiveID}/Honeycomb/{honeycombID}
    // we'll search through hives to find it
    
    const hivesRef = collection(db, "Hive");
    const hivesSnap = await getDocs(hivesRef);
    
    let hiveID = null;
    let honeycombData = null;
    let ownerID = null;
    
    // Search for the honeycomb across all hives
    for (const hiveDoc of hivesSnap.docs) {
      const honeycombRef = doc(db, "Hive", hiveDoc.id, "Honeycomb", honeycombID);
      const honeycombSnap = await getDoc(honeycombRef);
      
      if (honeycombSnap.exists()) {
        hiveID = hiveDoc.id;
        honeycombData = honeycombSnap.data();
        ownerID = hiveDoc.data().ownerId; // lowercase 'd'
        break;
      }
    }

    if (!hiveID || !honeycombData) {
      throw new Error("Honeycomb not found");
    }

    if (!ownerID) {
      throw new Error("Hive owner not found");
    }

    // Create join request notification for owner
    const message = `${requestingUserName} wants to join honeycomb "${honeycombData.name}"`;
    const notification = {
      type: "JOIN_REQUEST",
      hiveID,
      honeycombID,
      requestingUserID,
      requestingUserName,
      message,
      timestamp: serverTimestamp(),
      read: false,
      status: "pending", // pending, approved, denied
    };

    const ownerNotifRef = collection(db, "Users", ownerID, "notifications");
    await addDoc(ownerNotifRef, notification);

    return { success: true, message: "Join request sent to owner" };
  } catch (error) {
    console.error("Error sending join request:", error);
    throw error;
  }
}

/**
 * Approve a join request and add user to honeycomb with specified role
 */
export async function approveJoinRequest(notificationID, ownerID, honeycombID, hiveID, requestingUserID, requestingUserName, role = "MEMBER") {
  try {
    // Get requesting user's info from Users collection
    const userRef = doc(db, "Users", requestingUserID);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};
    
    // Add user to hive members with role and display info
    const hiveMemberRef = doc(db, "Hive", hiveID, "members", requestingUserID);
    await setDoc(hiveMemberRef, {
      userID: requestingUserID,
      role: role,
      displayName: userData.displayName || requestingUserName || userData.email || "Unknown User",
      email: userData.email || null,
      joinedAt: serverTimestamp(),
    });
    
    // Also add to hive members array for backward compatibility
    const hiveRef = doc(db, "Hive", hiveID);
    const hiveSnap = await getDoc(hiveRef);
    if (hiveSnap.exists()) {
      const hiveData = hiveSnap.data();
      const currentMembers = hiveData.members || [];
      if (!currentMembers.includes(requestingUserID)) {
        await updateDoc(hiveRef, {
          members: [...currentMembers, requestingUserID]
        });
      }
    }

    // Log to audit trail
    const auditRef = collection(db, "auditLogs");
    await addDoc(auditRef, {
      hiveID,
      action: "USER_JOINED",
      performedBy: ownerID,
      targetUserID: requestingUserID,
      targetUserName: userData.displayName || requestingUserName || userData.email || "Unknown User",
      role: role,
      details: `User ${userData.displayName || requestingUserName} was approved to join with role ${role}`,
      timestamp: serverTimestamp(),
    });

    // Update notification status to approved
    const notifRef = doc(db, "Users", ownerID, "notifications", notificationID);
    await updateDoc(notifRef, {
      status: "approved",
      approvedRole: role,
      read: true,
    });

    // Send approval notification to requesting user
    const approvalMessage = `Your request to join the honeycomb has been approved! You've been assigned the ${role} role.`;
    const approvalNotif = {
      type: "JOIN_APPROVED",
      hiveID,
      honeycombID,
      message: approvalMessage,
      role,
      timestamp: serverTimestamp(),
      read: false,
    };

    const userNotifRef = collection(db, "Users", requestingUserID, "notifications");
    await addDoc(userNotifRef, approvalNotif);

    return { success: true, message: "User added to honeycomb" };
  } catch (error) {
    console.error("Error approving join request:", error);
    throw error;
  }
}

/**
 * Deny a join request
 */
export async function denyJoinRequest(notificationID, ownerID, requestingUserID, honeycombID, hiveID) {
  try {
    // Get requesting user's info for audit log
    const userRef = doc(db, "Users", requestingUserID);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};
    const userName = userData.displayName || userData.email || "Unknown User";
    
    // Update notification status to denied
    const notifRef = doc(db, "Users", ownerID, "notifications", notificationID);
    await updateDoc(notifRef, {
      status: "denied",
      read: true,
    });

    // Log to audit trail
    const auditRef = collection(db, "auditLogs");
    await addDoc(auditRef, {
      hiveID,
      action: "JOIN_REQUEST_DENIED",
      performedBy: ownerID,
      targetUserID: requestingUserID,
      targetUserName: userName,
      details: `Join request from ${userName} was denied`,
      timestamp: serverTimestamp(),
    });

    // Send denial notification to requesting user
    const denialMessage = `Your request to join the honeycomb has been denied.`;
    const denialNotif = {
      type: "JOIN_DENIED",
      hiveID,
      honeycombID,
      message: denialMessage,
      timestamp: serverTimestamp(),
      read: false,
    };

    const userNotifRef = collection(db, "Users", requestingUserID, "notifications");
    await addDoc(userNotifRef, denialNotif);

    return { success: true, message: "Join request denied" };
  } catch (error) {
    console.error("Error denying join request:", error);
    throw error;
  }
}
