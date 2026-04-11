"use client";

import { useRef, useState } from "react";
import { storage } from "@/lib/firebase/config";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { sanitizeImageCaption } from "@/lib/business/imageCaptionSanitizer";

function safeName(name) {
  return name.replace(/[^\w.\-() ]+/g, "_");
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
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");

  const setBusy = (value) => {
    setUploading(value);
    onUploadStateChange?.(value);
  };

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

    setBusy(true);
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
          setBusy(false);
        },
        async () => {
          try {
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
            setBusy(false);
            setPct(0);
            if (inputRef.current) inputRef.current.value = "";
          }
        }
      );
    } catch (e2) {
      console.error(e2);
      setErr(e2?.message || "Upload error");
      setBusy(false);
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
        className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
        title={uploading ? "Uploading..." : "Upload file"}
      >
        {uploading ? `Uploading ${pct}%` : "Upload"}
      </button>

      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </div>
  );
}
