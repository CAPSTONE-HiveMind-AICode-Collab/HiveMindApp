import { storage } from "@/lib/firebase/config";
import { ref, uploadBytesResumable, getDownloadURL, listAll, deleteObject } from "firebase/storage";

/** Path helper: keep a tidy, queryable layout per hive/honeycomb/message */
const pathFor = (hiveID, honeycombID, messageID, fileName="") =>
  `Hive/${hiveID}/Honeycomb/${honeycombID}/messages/${messageID}/${fileName}`;

export function uploadFile({ hiveID, honeycombID, messageID, file, onProgress }) {
  return new Promise((resolve, reject) => {
    const fileRef = ref(storage, pathFor(hiveID, honeycombID, messageID, file.name));
    const task = uploadBytesResumable(fileRef, file);

    task.on("state_changed",
      (snap) => {
        const pct = Math.round(100 * snap.bytesTransferred / snap.totalBytes);
        onProgress?.(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ name: file.name, url, size: file.size, contentType: file.type });
      }
    );
  });
}

export async function listFiles({ hiveID, honeycombID, messageID }) {
  const dirRef = ref(storage, pathFor(hiveID, honeycombID, messageID));
  const result = await listAll(dirRef);
  const items = await Promise.all(
    result.items.map(async (itemRef) => ({
      name: itemRef.name,
      url: await getDownloadURL(itemRef)
    }))
  );
  return items;
}

export async function deleteFile({ hiveID, honeycombID, messageID, fileName }) {
  const fileRef = ref(storage, pathFor(hiveID, honeycombID, messageID, fileName));
  await deleteObject(fileRef);
}
