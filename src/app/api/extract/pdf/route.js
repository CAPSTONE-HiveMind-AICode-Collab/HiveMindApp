// src/app/api/extract/pdf/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // use Node runtime, not edge

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_TEXT_CHARS = 80_000;

/**
 * Minimal polyfills so pdfjs / pdf-parse don't explode in Node.
 * We don't need real graphics, just enough to stop DOMMatrix / Path2D errors.
 */
function ensurePdfPolyfills() {
  const g = globalThis;

  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      constructor(init) {
        this._init = init;
      }
      multiply() { return this; }
      inverse() { return this; }
    };
  }

  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {
      constructor(path) {
        this._path = path;
      }
    };
  }

  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {
      constructor() {
        // no-op stub
      }
    };
  }
}

export async function POST(req) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Missing 'url'." },
        { status: 400 }
      );
    }

    // 1) Download the PDF from Firebase Storage
    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch PDF. HTTP ${res.status}` },
        { status: 400 }
      );
    }

    const lenHeader = res.headers.get("content-length");
    const contentLength = lenHeader ? Number(lenHeader) : null;

    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // 2) Size checks – but DO NOT 500, just return empty text
    if ((contentLength && contentLength > MAX_PDF_BYTES) || buf.length > MAX_PDF_BYTES) {
      console.warn("PDF too large for extraction:", contentLength || buf.length);
      return NextResponse.json({
        text: "",
        warning: "PDF too large for extraction",
      });
    }

    // 3) Try pdf-parse – but if it fails, still return 200 with empty text
    try {
      ensurePdfPolyfills();

      const mod = await import("pdf-parse");

      // Try several possible exports and only call if it's actually a function
      const pdfParseFn =
        (typeof mod.default === "function" && mod.default) ||
        (typeof mod === "function" && mod) ||
        (typeof mod.pdf === "function" && mod.pdf) ||
        (typeof mod.parse === "function" && mod.parse) ||
        null;

      if (!pdfParseFn) {
        console.warn(
          "pdf-parse module does not expose a callable parser; skipping extraction."
        );
        return NextResponse.json({
          text: "",
          warning: "pdf-parse not available in this runtime; returned empty text.",
        });
      }

      const parsed = await pdfParseFn(buf);
      let text = (parsed?.text || "").trim();

      if (!text) {
        // Successfully parsed but no text (scanned PDF, images only, etc.)
        return NextResponse.json({ text: "" });
      }

      if (text.length > MAX_TEXT_CHARS) {
        text = text.slice(0, MAX_TEXT_CHARS) + "\n\n[TRUNCATED]";
      }

      return NextResponse.json({ text });
    } catch (innerErr) {
      console.error("pdf-parse failed, falling back to empty text:", innerErr);
      // Important: still 200 so FileUploader sees res.ok
      return NextResponse.json({
        text: "",
        warning: "pdf-parse failed, returned empty text",
      });
    }
  } catch (err) {
    console.error("PDF extraction outer error:", err);
    // Last-resort safety net: still 200, empty text
    return NextResponse.json(
      {
        text: "",
        warning: "Unexpected error in PDF extractor; returned empty text.",
      },
      { status: 200 }
    );
  }
}
