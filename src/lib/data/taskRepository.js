// src/lib/data/taskRepository.js
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";

const asId = (v, name) => {
  if (v === undefined || v === null || v === "") throw new Error(`${name} is required`);
  return String(v);
};

export async function createTaskFromMessage({
  hiveID,
  honeycombID,
  messageID,
  title,
  description = "",
  checklist = [],
  status = "todo",
  priority = "normal",
  assignees = [],
  dueAt = null,
  createdBy,
}) {
  const hid = asId(hiveID, "hiveID");
  const cid = asId(honeycombID, "honeycombID");
  const mid = asId(messageID, "messageID");
  const uid = asId(createdBy, "createdBy");

  const tasksRef = collection(db, "Hive", hid, "tasks");

  const dueTimestamp =
    dueAt ? Timestamp.fromDate(dueAt instanceof Date ? dueAt : new Date(dueAt)) : null;

  const taskDoc = await addDoc(tasksRef, {
    title: String(title || "").trim() || "New Task",
    description: String(description || ""),
    checklist: Array.isArray(checklist) ? checklist : [],
    status,
    priority,
    assignees: Array.isArray(assignees) ? assignees : [],
    dueAt: dueTimestamp,
    createdBy: uid,
    createdAt: serverTimestamp(),

    // link back to source
    source: {
      hiveID: hid,
      honeycombID: cid,
      messageID: mid,
    },
  });

  // write the task id into the message doc so UI can show indicator
  const msgRef = doc(db, "Hive", hid, "Honeycomb", cid, "messages", mid);
  await updateDoc(msgRef, {
    linkedTaskIds: arrayUnion(taskDoc.id),
  });

  return taskDoc.id;
}
