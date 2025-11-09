// src/app/api/ai/route.js
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { message } = await req.json();

    // Example: simple call to Gemini or OpenAI (mock for now)
    // You can replace this with a real API call later.
    const aiReply = `AI Response: I received your message "${message}".`;

    return NextResponse.json({ reply: aiReply });
  } catch (error) {
    console.error("AI API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
