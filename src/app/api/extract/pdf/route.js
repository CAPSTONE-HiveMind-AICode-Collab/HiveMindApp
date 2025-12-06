// src/app/api/extract/pdf/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // IMPORTANT: pdf parsing requires node runtime

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15MB cap for extraction
const MAX_TEXT_CHARS = 80_000;          // keep attachment.text reasonable

export async function POST(req) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing 'url'." }, { status: 400 });
    }

    // Download the PDF from Firebase Storage download URL
    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch PDF. HTTP ${res.status}` },
        { status: 400 }
      );
    }

    const contentType = res.headers.get("content-type") || "";
    const lenHeader = res.headers.get("content-length");
    const contentLength = lenHeader ? Number(lenHeader) : null;

    if (contentLength && contentLength > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF too large for extraction (>${MAX_PDF_BYTES} bytes).` },
        { status: 413 }
      );
    }

    // Convert to Buffer
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    if (buf.length > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF too large for extraction (>${MAX_PDF_BYTES} bytes).` },
        { status: 413 }
      );
    }

    // pdf-parse is CommonJS; dynamic import works fine in Node runtime
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = pdfParseModule.default || pdfParseModule;

    const parsed = await pdfParse(buf);
    let text = (parsed?.text || "").trim();

    if (!text) {
      // still return successfully, just indicate no extractable text
      return NextResponse.json({ text: "" });
    }

    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS) + "\n\n[TRUNCATED]";
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("PDF extraction error:", err);
    return NextResponse.json(
      { error: "Failed to extract PDF text." },
      { status: 500 }
    );
  }
}
