// src/lib/data/fileRepository.js
import { storage } from "@/lib/firebase/config";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const sanitizeName = (name) => (name || "upload.bin").replace(/[^\w.\-]/g, "_");
const makeId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function uploadChatFile({ file, hiveID, honeycombID, userId, onProgress }) {
  if (!file) return Promise.reject(new Error("file is required"));
  if (!hiveID || !honeycombID) return Promise.reject(new Error("hiveID and honeycombID are required"));
  if (!userId) return Promise.reject(new Error("userId is required"));

  return new Promise((resolve, reject) => {
    const fileId = makeId();
    const safeName = sanitizeName(file.name);

    const path = `Hive/${hiveID}/Honeycomb/${honeycombID}/uploads/${userId}/${fileId}-${safeName}`;
    const storageRef = ref(storage, path);

    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        originalName: file.name || "",
        hiveID: String(hiveID),
        honeycombID: String(honeycombID),
        userId: String(userId),
      },
    });

    task.on(
      "state_changed",
      (snap) => {
        if (typeof onProgress === "function") {
          const pct = snap.totalBytes
            ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
            : 0;
          onProgress(pct);
        }
      },
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            id: fileId,
            name: file.name,
            url,
            path,
            size: file.size,
            contentType: file.type || "application/octet-stream",
          });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}
export function uploadAssistantFile({ file, userId, onProgress }) {
  if (!file) return Promise.reject(new Error("file is required"));
  if (!userId) return Promise.reject(new Error("userId is required"));

  return new Promise((resolve, reject) => {
    const fileId = makeId();
    const safeName = sanitizeName(file.name);

    const path = `Users/${userId}/assistantThreads/default/uploads/${fileId}-${safeName}`;
    const storageRef = ref(storage, path);

    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        originalName: file.name || "",
        userId: String(userId),
        threadId: "default",
      },
    });

    task.on(
      "state_changed",
      (snap) => {
        if (typeof onProgress === "function") {
          const pct = snap.totalBytes
            ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
            : 0;
          onProgress(pct);
        }
      },
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            id: fileId,
            name: file.name,
            url,
            path,
            size: file.size,
            contentType: file.type || "application/octet-stream",
          });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}
