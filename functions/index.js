const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();

// Import IAM (Identity & Access Management) functions
const iamFunctions = require("./iamFunctions");
exports.setUserRole = iamFunctions.setUserRole;
exports.verifyHiveAccess = iamFunctions.verifyHiveAccess;
exports.revokeHiveAccess = iamFunctions.revokeHiveAccess;
exports.getUserPermissions = iamFunctions.getUserPermissions;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Cloud Function: Auto-generate AI summary when thread is closed
 * Triggers on Thread status update from "open" -> "closed"
 */
exports.generateThreadSummary = onDocumentUpdated(
  "Hive/{hiveID}/Honeycomb/{honeycombID}/messages/{messageID}/Threads/{threadID}",
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // Only trigger if status changed to "closed"
    if (beforeData.status !== "closed" && afterData.status === "closed") {
      const { hiveID, honeycombID, messageID, threadID } = event.params;

      logger.info(`Thread closed: ${threadID}, generating summary...`);

      try {
        // Fetch all thread messages
        const threadsRef = db
          .collection("Hive")
          .doc(hiveID)
          .collection("Honeycomb")
          .doc(honeycombID)
          .collection("messages")
          .doc(messageID)
          .collection("Threads")
          .doc(threadID)
          .collection("messages");

        const snapshot = await threadsRef.orderBy("timestamp", "asc").get();

        if (snapshot.empty) {
          logger.warn("No messages in thread, skipping summary");
          return;
        }

        // Build conversation text
        const messages = snapshot.docs.map((doc) => {
          const data = doc.data();
          return `${data.sender || "Unknown"}: ${data.text || ""}`;
        });

        const conversationText = messages.join("\n");

        // Generate AI summary
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const prompt = `Summarize this conversation thread concisely (2-3 sentences):\n\n${conversationText}`;

        const result = await model.generateContent(prompt);
        const summary = result.response.text();

        // Store summary in Firestore
        const summaryRef = db
          .collection("Hive")
          .doc(hiveID)
          .collection("Honeycomb")
          .doc(honeycombID)
          .collection("summaries");

        await summaryRef.add({
          threadID,
          messageID,
          summary,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          type: "thread",
          messageCount: messages.length,
        });

        logger.info(`Summary generated for thread ${threadID}: ${summary.substring(0, 100)}...`);
      } catch (error) {
        logger.error("Failed to generate thread summary:", error);
      }
    }
  }
);

/**
 * Cloud Function: Cleanup temporary files older than 24 hours
 * Runs daily at 2 AM UTC
 */
exports.cleanupTempFiles = onSchedule("0 2 * * *", async (event) => {
  logger.info("Starting temp file cleanup...");

  try {
    const bucket = storage.bucket();
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

    // List all files in /temp/ directory
    const [files] = await bucket.getFiles({ prefix: "temp/" });

    let deletedCount = 0;

    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const createdTime = new Date(metadata.timeCreated).getTime();

      if (createdTime < cutoffTime) {
        await file.delete();
        deletedCount++;
        logger.info(`Deleted temp file: ${file.name}`);
      }
    }

    logger.info(`Temp file cleanup complete: ${deletedCount} files deleted`);
  } catch (error) {
    logger.error("Temp file cleanup failed:", error);
  }
});

/**
 * Cloud Function: Auto-log security events on hive deletion
 */
exports.logHiveDeletion = onDocumentUpdated("Hive/{hiveID}", async (event) => {
  const beforeData = event.data.before;
  const afterData = event.data.after;

  // Check if document was deleted (exists() changes from true to false)
  if (beforeData.exists && !afterData.exists) {
    const { hiveID } = event.params;
    const hiveData = beforeData.data();

    logger.info(`Hive deleted: ${hiveID}, logging audit event...`);

    try {
      await db.collection("auditLogs").add({
        event: "HIVE_DELETED",
        userId: hiveData.ownerId || "unknown",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        success: true,
        details: {
          hiveID,
          hiveName: hiveData.name,
          memberCount: hiveData.members?.length || 0,
        },
      });

      logger.info(`Audit log created for hive deletion: ${hiveID}`);
    } catch (error) {
      logger.error("Failed to log hive deletion:", error);
    }
  }
});

/**
 * Cloud Function: Auto-log role changes in hive members
 */
exports.logRoleChange = onDocumentUpdated(
  "Hive/{hiveID}/members/{userID}",
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // Check if role changed
    if (beforeData.role !== afterData.role) {
      const { hiveID, userID } = event.params;

      logger.info(`Role changed for user ${userID} in hive ${hiveID}`);

      try {
        await db.collection("auditLogs").add({
          event: "ROLE_CHANGED",
          userId: afterData.updatedBy || "system",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          success: true,
          details: {
            hiveID,
            targetUserId: userID,
            oldRole: beforeData.role,
            newRole: afterData.role,
          },
        });

        logger.info(`Audit log created for role change: ${beforeData.role} -> ${afterData.role}`);
      } catch (error) {
        logger.error("Failed to log role change:", error);
      }
    }
  }
);

/**
 * Cloud Function: Auto-log new member additions
 */
exports.logMemberAdded = onDocumentCreated("Hive/{hiveID}/members/{userID}", async (event) => {
  const memberData = event.data.data();
  const { hiveID, userID } = event.params;

  logger.info(`New member added: ${userID} to hive ${hiveID}`);

  try {
    await db.collection("auditLogs").add({
      event: "MEMBER_ADDED",
      userId: memberData.addedBy || "system",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      success: true,
      details: {
        hiveID,
        newMemberId: userID,
        role: memberData.role,
      },
    });

    logger.info(`Audit log created for member addition: ${userID}`);
  } catch (error) {
    logger.error("Failed to log member addition:", error);
  }
});

/**
 * Cloud Function: Auto-log file uploads
 */
exports.logFileUpload = onDocumentCreated(
  "Hive/{hiveID}/fileMetadata/{fileID}",
  async (event) => {
    const fileData = event.data.data();
    const { hiveID, fileID } = event.params;

    logger.info(`File uploaded: ${fileID} to hive ${hiveID}`);

    try {
      await db.collection("auditLogs").add({
        event: "FILE_UPLOADED",
        userId: fileData.uploadedBy || "unknown",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        success: true,
        details: {
          hiveID,
          fileName: fileData.name,
          fileSize: fileData.size,
          fileType: fileData.contentType,
        },
      });

      logger.info(`Audit log created for file upload: ${fileData.name}`);
    } catch (error) {
      logger.error("Failed to log file upload:", error);
    }
  }
);
