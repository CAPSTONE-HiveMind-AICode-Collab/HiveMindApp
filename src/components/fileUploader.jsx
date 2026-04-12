"use client";

import { useEffect, useRef, useState } from "react";
import { storage } from "@/lib/firebase/config";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { sanitizeImageCaption } from "@/lib/business/imageCaptionSanitizer";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_STALL_MS = 20000;

function safeName(name) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function getFriendlyUploadError(error, file) {
  const code = String(error?.code || "");
  const fallback = error?.message || "Upload failed. Please try again.";

  if (code === "storage/retry-limit-exceeded") {
    return `Upload timed out. Try a smaller file than ${formatBytes(
      file?.size || 0
    )}, check your connection, and confirm Firebase Storage is enabled.`;
  }

  if (code === "storage/unauthorized") {
    return "Upload blocked by Firebase Storage rules. Check storage permissions for this user.";
  }

  if (code === "storage/canceled") {
    return "Upload was canceled before completion.";
  }

  if (code === "storage/quota-exceeded") {
    return "Firebase Storage quota was exceeded. Try again later or use a smaller file.";
  }

  return fallback;
}

async function maybeReadText(file) {
  const lower = file.name.toLowerCase();
  const isTextLike =
    file.type.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".md");

  if (!isTextLike) return null;

  const text = await file.text();
  const MAX = 80_000;
  return text.length > MAX ? text.slice(0, MAX) + "\n\n[TRUNCATED]" : text;
}

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

async function getImageDescriptionFromServer(downloadUrl) {
  try {
    const res = await withTimeout(
      fetch("/api/image-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: downloadUrl,
          imageUrl: downloadUrl,
          max_tokens: 40,
          maxTokens: 40,
        }),
      }),
      20000,
      "Image caption request"
    );

    const data = await res.json().catch(() => ({}));

    console.log("IMAGE CAPTION STATUS:", res.status);
    console.log("IMAGE CAPTION DATA:", data);

    if (!res.ok) {
      console.warn("Image caption failed:", data?.error || res.statusText);
      return null;
    }

    return (
      data?.description ||
      data?.caption ||
      data?.text ||
      data?.result ||
      null
    );
  } catch (err) {
    console.warn("Image caption error:", err);
    return null;
  }
}

async function getImageOcrFromServer(downloadUrl) {
  try {
    const res = await withTimeout(
      fetch("/api/image-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: downloadUrl,
          imageUrl: downloadUrl,
          url: downloadUrl,
        }),
      }),
      180000,
      "Image OCR request"
    );

    const data = await res.json().catch(() => ({}));

    console.log("IMAGE OCR STATUS:", res.status);
    console.log("IMAGE OCR DATA:", data);

    if (!res.ok) {
      console.warn("Image OCR failed:", data?.error || res.statusText);
      return { text: null, confidence: null, error: data?.error || res.statusText };
    }

    return {
      text: data?.text || null,
      confidence: data?.confidence ?? null,
      error: null,
    };
  } catch (err) {
    console.warn("Image OCR error:", err);
    return { text: null, confidence: null, error: err?.message || "OCR failed" };
  }
}

function looksDocumentLike(fileName = "", ocrText = "") {
  const lower = String(fileName).toLowerCase();
  const fileNameHint =
    lower.includes("letter") ||
    lower.includes("document") ||
    lower.includes("notice") ||
    lower.includes("invoice") ||
    lower.includes("form") ||
    lower.includes("receipt") ||
    lower.includes("screenshot") ||
    lower.includes("email");

  const cleaned = String(ocrText || "").trim();
  const textHeavy = cleaned.length >= 40;

  return fileNameHint || textHeavy;
}

function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function buildDocumentDescription(fileName, ocrText) {
  const lower = String(fileName || "").toLowerCase();

  if (lower.includes("letter")) return "image containing a letter/document";
  if (lower.includes("invoice")) return "image containing an invoice/document";
  if (lower.includes("receipt")) return "image containing a receipt/document";
  if (lower.includes("form")) return "image containing a form/document";
  if (lower.includes("screenshot"))
    return "image containing a screenshot with visible text";
  if (ocrText && ocrText.trim().length >= 40)
    return "image containing visible text or a document";

  return "image uploaded by user";
}

export default function FileUploader({
  hiveID,
  honeycombID,
  userId,
  onUploaded,
  onUploadStateChange,
}) {
  const inputRef = useRef(null);
  const uploadTaskRef = useRef(null);
  const stallTimerRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");

  const clearStallTimer = () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  };

  const armStallTimer = (file) => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      if (uploadTaskRef.current) {
        try {
          uploadTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
      setErr(
        `Upload stalled before progress started. Try a smaller file than ${formatBytes(
          file?.size || 0
        )}, then retry.`
      );
      setBusyState({ busy: false, phase: "idle", progress: 0 });
      if (inputRef.current) inputRef.current.value = "";
    }, MAX_STALL_MS);
  };

  const setBusyState = ({ busy, phase: nextPhase, progress = 0 }) => {
    setUploading(Boolean(busy));
    setPhase(nextPhase || (busy ? "uploading" : "idle"));
    setPct(progress);
    onUploadStateChange?.({
      busy: Boolean(busy),
      phase: nextPhase || (busy ? "uploading" : "idle"),
      progress,
    });
  };

  useEffect(() => {
    return () => {
      clearStallTimer();
    };
  }, []);

  const pick = () => {
    if (!uploading) inputRef.current?.click();
  };

  const onChange = async (e) => {
    setErr("");
    const file = e.target.files?.[0];
    if (!file) return;

    if (!hiveID || !honeycombID || !userId) {
      setErr("Missing hiveID/honeycombID/userId");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setErr(
        `File too large for reliable demo upload. Please use a file under ${formatBytes(
          MAX_UPLOAD_BYTES
        )}.`
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusyState({ busy: true, phase: "uploading", progress: 0 });
    armStallTimer(file);

    try {
      const fileName = `${Date.now()}_${safeName(file.name)}`;
      const storagePath = `Hive/${hiveID}/${honeycombID}/${userId}/${fileName}`;
      const storageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type || "application/octet-stream",
      });
      uploadTaskRef.current = uploadTask;

      uploadTask.on(
        "state_changed",
        (snap) => {
          clearStallTimer();
          const progress = (snap.bytesTransferred / snap.totalBytes) * 100;
          setBusyState({
            busy: true,
            phase: "uploading",
            progress: Math.round(progress),
          });
        },
        (error) => {
          console.error(error);
          setErr(getFriendlyUploadError(error, file));
          clearStallTimer();
          uploadTaskRef.current = null;
          setBusyState({ busy: false, phase: "idle", progress: 0 });
          if (inputRef.current) inputRef.current.value = "";
        },
        async () => {
          try {
            clearStallTimer();
            setBusyState({ busy: true, phase: "processing", progress: 100 });
            const url = await getDownloadURL(uploadTask.snapshot.ref);

            const lowerName = file.name.toLowerCase();
            const isPdf =
              file.type === "application/pdf" || lowerName.endsWith(".pdf");
            const isImage =
              file.type.startsWith("image/") && !lowerName.endsWith(".svg");

            let extractedText = null;
            let imageDescription = null;
            let rawCaption = null;
            let captionRisk = null;
            let captionNotes = [];
            let extractionMethod = null;
            let isDocumentLike = false;
            let ocrConfidence = null;
            let extractionStatus = "not_attempted";
            let extractionError = null;

            if (isPdf) {
              extractedText = await extractPdfTextFromServer(url);
              extractionMethod = "pdf";
              extractionStatus = extractedText ? "success" : "failed";
              extractionError = extractedText ? null : "No text could be extracted from this PDF.";
            } else if (isImage) {
              let ocrResult = { text: null, confidence: null };
              const lowerFileName = String(file.name || "").toLowerCase();
              const fileNameSuggestsDocument =
                lowerFileName.includes("invoice") ||
                lowerFileName.includes("receipt") ||
                lowerFileName.includes("letter") ||
                lowerFileName.includes("form") ||
                lowerFileName.includes("notice") ||
                lowerFileName.includes("statement") ||
                lowerFileName.includes("bill") ||
                lowerFileName.includes("screenshot");

              try {
                rawCaption = await getImageDescriptionFromServer(url);
              } catch (err) {
                console.warn("Caption stage skipped:", err);
              }

              try {
                ocrResult = await getImageOcrFromServer(url);
              } catch (err) {
                console.warn("OCR stage skipped:", err);
              }

              extractedText = ocrResult?.text || null;
              ocrConfidence = ocrResult?.confidence ?? null;
              isDocumentLike = looksDocumentLike(file.name, extractedText);
              extractionStatus = extractedText ? "success" : "failed";
              extractionError = extractedText
                ? null
                : ocrResult?.error || "OCR did not find readable text in this image.";

              if (rawCaption) {
                const sanitized = sanitizeImageCaption(rawCaption, {
                  contentType: file.type,
                  fileName: file.name,
                });

                if (extractedText) {
                  imageDescription = buildDocumentDescription(file.name, extractedText);
                } else if (fileNameSuggestsDocument || isDocumentLike) {
                  imageDescription = "document-like image; OCR text unavailable";
                } else {
                  imageDescription =
                    sanitized.refinedCaption ||
                    buildDocumentDescription(file.name, extractedText) ||
                    "image uploaded by user";
                }
                rawCaption = sanitized.rawCaption || null;
                captionRisk = sanitized.captionRisk || "low";
                captionNotes = Array.isArray(sanitized.captionNotes)
                  ? sanitized.captionNotes
                  : [];
                extractionMethod = extractedText ? "ocr+caption" : "caption";
              } else {
                imageDescription = extractedText
                  ? buildDocumentDescription(file.name, extractedText)
                  : fileNameSuggestsDocument || isDocumentLike
                    ? "document-like image; OCR text unavailable"
                    : buildDocumentDescription(file.name, extractedText);
                rawCaption = null;
                captionRisk = "unknown";
                captionNotes = [
                  extractedText
                    ? "caption service unavailable; OCR extracted text instead"
                    : "caption service unavailable",
                ];
                extractionMethod = extractedText ? "ocr" : "fallback";
              }              
            } else {
              extractedText = await maybeReadText(file);
              extractionMethod = "text";
            }

            const meta = {
              name: file.name,
              size: file.size,
              contentType: file.type || "application/octet-stream",
              url,
              storagePath,
              uploadedAt: Date.now(),

              text: extractedText,
              extractedText: isImage ? extractedText : null,
              imageDescription,

              rawCaption,
              captionRisk,
              captionNotes,

              extractionMethod,
              extractionStatus,
              extractionError,
              isDocumentLike,
              ocrConfidence,
            };

            console.log("UPLOAD META", meta);
            onUploaded?.(meta);
          } catch (doneErr) {
            console.error(doneErr);
            setErr(doneErr?.message || "Upload finalize error");
          } finally {
            clearStallTimer();
            uploadTaskRef.current = null;
            setBusyState({ busy: false, phase: "idle", progress: 0 });
            if (inputRef.current) inputRef.current.value = "";
          }
        }
      );
    } catch (e2) {
      console.error(e2);
      setErr(getFriendlyUploadError(e2, file));
      clearStallTimer();
      uploadTaskRef.current = null;
      setBusyState({ busy: false, phase: "idle", progress: 0 });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={onChange}
        disabled={uploading}
      />

      <button
        type="button"
        onClick={pick}
        disabled={uploading}
        className="rounded-xl border border-amber-200/30 bg-amber-200 px-4 py-2 font-semibold text-slate-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        title={
          phase === "processing"
            ? "Processing attachment..."
            : uploading
            ? "Uploading..."
            : "Upload file"
        }
      >
        {phase === "processing"
          ? "Processing..."
          : uploading
          ? `Uploading ${pct}%`
          : "Upload"}
      </button>

      {err ? <span className="text-xs text-rose-300">{err}</span> : null}
    </div>
  );
}
