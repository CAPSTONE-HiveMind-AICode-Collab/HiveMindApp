// src/components/fileUploader.jsx
"use client";

import { useRef, useState } from "react";
import { storage } from "@/lib/firebase/config";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

function safeName(name) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

/**
 * Reads small text files on the client (txt / csv / md).
 * Returns trimmed text or null.
 */
async function maybeReadText(file) {
  const lower = file.name.toLowerCase();
  const isTextLike =
    file.type.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".md");

  if (!isTextLike) return null;

  const text = await file.text();
  const MAX = 80_000; // safety limit for prompt size
  return text.length > MAX ? text.slice(0, MAX) + "\n\n[TRUNCATED]" : text;
}

/**
 * Ask Next.js API to extract text from a PDF by URL.
 * This will hit /api/extract/pdf which you already created.
 */
async function extractPdfTextFromServer(downloadUrl) {
  try {
    const res = await fetch("/api/extract/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: downloadUrl }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("PDF extract failed:", data?.error || res.statusText);
      return null;
    }

    return data?.text || null;
  } catch (err) {
    console.warn("PDF extract error:", err);
    return null;
  }
}

/**
 * Ask Next.js API to get an image description by URL.
 * This will call /api/image-caption, which proxies to your FastAPI BLIP server.
 */
async function getImageDescriptionFromServer(downloadUrl) {
  try {
    const res = await fetch("/api/image-caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // send both keys so route.js can choose either shape
        image_url: downloadUrl,
        imageUrl: downloadUrl,
        max_tokens: 40,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("Image caption failed:", data?.error || res.statusText);
      return null;
    }

    return data?.description || null;
  } catch (err) {
    console.warn("Image caption error:", err);
    return null;
  }
}

export default function FileUploader({ hiveID, honeycombID, userId, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");

  const pick = () => inputRef.current?.click();

  const onChange = async (e) => {
    setErr("");
    const file = e.target.files?.[0];
    if (!file) return;

    if (!hiveID || !honeycombID || !userId) {
      setErr("Missing hiveID/honeycombID/userId");
      return;
    }

    setUploading(true);
    setPct(0);

    try {
      const fileName = `${Date.now()}_${safeName(file.name)}`;
      const storagePath = `Hive/${hiveID}/${honeycombID}/${userId}/${fileName}`;
      const storageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type || "application/octet-stream",
      });

      uploadTask.on(
        "state_changed",
        (snap) => {
          const progress = (snap.bytesTransferred / snap.totalBytes) * 100;
          setPct(Math.round(progress));
        },
        (error) => {
          console.error(error);
          setErr(error?.message || "Upload failed");
          setUploading(false);
        },
        async () => {
          try {
            const url = await getDownloadURL(uploadTask.snapshot.ref);

            const lowerName = file.name.toLowerCase();
            const isPdf =
              file.type === "application/pdf" || lowerName.endsWith(".pdf");
            const isImage =
              file.type.startsWith("image/") &&
              !lowerName.endsWith(".svg"); // skip svg for now

            let extractedText = null;
            let imageDescription = null;

            if (isPdf) {
              // Server-side PDF parser
              extractedText = await extractPdfTextFromServer(url);
            } else if (isImage) {
              // Local BLIP caption via Next API
              imageDescription = await getImageDescriptionFromServer(url);
              extractedText = imageDescription; // also treat as text for Ask AI
            } else {
              // Plain text / csv / md
              extractedText = await maybeReadText(file);
            }

            const meta = {
              name: file.name,
              size: file.size,
              contentType: file.type || "application/octet-stream",
              url,
              storagePath,
              uploadedAt: Date.now(),
              text: extractedText,          // generic text for AI context
              imageDescription,             // for images
            };

            console.log("UPLOAD META", meta);

            onUploaded?.(meta);
          } catch (doneErr) {
            console.error(doneErr);
            setErr(doneErr?.message || "Upload finalize error");
          } finally {
            setUploading(false);
            setPct(0);
            if (inputRef.current) inputRef.current.value = "";
          }
        }
      );
    } catch (e2) {
      console.error(e2);
      setErr(e2?.message || "Upload error");
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={onChange}
      />

      <button
        type="button"
        onClick={pick}
        disabled={uploading}
        className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm"
        title="Upload file"
      >
        📎 Upload
      </button>

      {uploading && (
        <span className="text-xs text-gray-700 min-w-[48px]">{pct}%</span>
      )}

      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
