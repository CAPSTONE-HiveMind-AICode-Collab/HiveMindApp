import { NextResponse } from "next/server";
import Tesseract from "tesseract.js";
import path from "path";

export const runtime = "nodejs";

let workerPromise = null;

async function getOcrWorker() {
  if (!workerPromise) {
    const workerPath = path.join(
      process.cwd(),
      "node_modules",
      "tesseract.js",
      "src",
      "worker-script",
      "node",
      "index.js"
    );

    workerPromise = Tesseract.createWorker("eng", 1, {
      workerPath,
      workerBlobURL: false,
      logger: () => {},
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.AUTO,
          preserve_interword_spaces: "1",
        });
        return worker;
      })
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }

  return workerPromise;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const imageUrl = body?.imageUrl || body?.image_url || body?.url || "";

    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: `Unable to fetch image for OCR: ${imageRes.status}` },
        { status: 502 }
      );
    }

    const imageArrayBuffer = await imageRes.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);

    const worker = await getOcrWorker();
    const result = await worker.recognize(imageBuffer, {}, { text: true });

    const text = String(result?.data?.text || "").trim();
    const confidence = result?.data?.confidence ?? null;

    return NextResponse.json({
      text: text || null,
      confidence,
    });
  } catch (err) {
    console.error("image-ocr route error:", err);
    return NextResponse.json(
      { error: err?.message || "OCR route failed" },
      { status: 500 }
    );
  }
}
