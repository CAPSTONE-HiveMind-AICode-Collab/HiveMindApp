// src/lib/data/storageRepository.js
import { storage } from "@/lib/firebase/config";
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata,
} from "firebase/storage";

/**
 * Upload file to Firebase Storage
 * @param {File} file - File object to upload
 * @param {string} path - Storage path (e.g., 'hives/hiveID/attachments/messageID/filename.jpg')
 * @param {object} metadata - Custom metadata (uploadedBy, contentType, etc.)
 * @param {function} onProgress - Progress callback (percent)
 * @returns {Promise<string>} Download URL
 */
export async function uploadFile(file, path, metadata = {}, onProgress = null) {
  if (!file) throw new Error("No file provided");
  
  // Validate file size (max 50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`File too large. Max size: ${maxSize / 1024 / 1024}MB`);
  }
  
  // Validate file type
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'video/mp4', 'video/quicktime',
  ];
  
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`File type not allowed: ${file.type}`);
  }
  
  const storageRef = ref(storage, path);
  
  const customMetadata = {
    contentType: file.type,
    uploadedAt: new Date().toISOString(),
    originalName: file.name,
    ...metadata,
  };
  
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
    customMetadata,
  });
  
  return new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (onProgress) {
          onProgress(progress);
        }
      },
      (error) => {
        console.error("Upload error:", error);
        reject(error);
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadURL);
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

/**
 * Upload message attachment
 */
export async function uploadMessageAttachment(
  hiveID,
  honeycombID,
  messageID,
  file,
  userId,
  onProgress
) {
  const timestamp = Date.now();
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `hives/${hiveID}/attachments/${honeycombID}/${messageID}/${timestamp}_${sanitizedFilename}`;
  
  return uploadFile(
    file,
    path,
    {
      uploadedBy: userId,
      hiveID,
      honeycombID,
      messageID,
    },
    onProgress
  );
}

/**
 * Upload user profile picture
 */
export async function uploadProfilePicture(userId, file, onProgress) {
  const timestamp = Date.now();
  const extension = file.name.split('.').pop();
  const path = `users/${userId}/profile/${timestamp}.${extension}`;
  
  return uploadFile(
    file,
    path,
    {
      uploadedBy: userId,
      type: 'profile-picture',
    },
    onProgress
  );
}

/**
 * Delete file from storage
 */
export async function deleteFile(path) {
  try {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
    return true;
  } catch (error) {
    console.error("Delete error:", error);
    throw error;
  }
}

/**
 * List files in a directory
 */
export async function listFiles(path) {
  try {
    const storageRef = ref(storage, path);
    const result = await listAll(storageRef);
    
    const files = await Promise.all(
      result.items.map(async (itemRef) => {
        const url = await getDownloadURL(itemRef);
        const metadata = await getMetadata(itemRef);
        return {
          name: itemRef.name,
          fullPath: itemRef.fullPath,
          url,
          metadata,
          size: metadata.size,
          contentType: metadata.contentType,
          createdAt: metadata.timeCreated,
          updatedAt: metadata.updated,
        };
      })
    );
    
    return files;
  } catch (error) {
    console.error("List files error:", error);
    throw error;
  }
}

/**
 * Get file metadata
 */
export async function getFileMetadata(path) {
  try {
    const storageRef = ref(storage, path);
    const metadata = await getMetadata(storageRef);
    return metadata;
  } catch (error) {
    console.error("Get metadata error:", error);
    throw error;
  }
}

/**
 * Get download URL for a file
 */
export async function getFileURL(path) {
  try {
    const storageRef = ref(storage, path);
    const url = await getDownloadURL(storageRef);
    return url;
  } catch (error) {
    console.error("Get URL error:", error);
    throw error;
  }
}
