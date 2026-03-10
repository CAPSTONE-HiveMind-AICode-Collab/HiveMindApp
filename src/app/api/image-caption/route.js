// src/app/api/image-caption/route.js
import { NextResponse } from "next/server";

const CAPTION_API_BASE =
  process.env.NEXT_PUBLIC_CAPTION_API_BASE ||
  process.env.CAPTION_API_BASE ||
  "http://127.0.0.1:8000"; 

export async function POST(req) {
  try {
    const body = await req.json();

    // accept both shapes from the client
    const imageUrl =
      body.image_url || body.imageUrl || body.url || body.downloadUrl;
    const maxTokens = body.max_tokens || body.maxTokens || 40;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "image_url is required" },
        { status: 400 }
      );
    }

    const fastApiUrl = `${CAPTION_API_BASE}/caption/url`;

    const upstreamRes = await fetch(fastApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        max_tokens: maxTokens,
      }),
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      console.error("Caption server failed:", upstreamRes.status, text);
      return NextResponse.json(
        {
          error: "Caption server error",
          status: upstreamRes.status,
          detail: text,
        },
        { status: 500 }
      );
    }

    const data = await upstreamRes.json();
    // FastAPI returns { description: "...", source: "..." }
    return NextResponse.json(data);
  } catch (err) {
    console.error("image-caption route error:", err);
    return NextResponse.json(
      {
        error: "Internal error in /api/image-caption",
        detail: String(err),
      },
      { status: 500 }
    );
  }
}
