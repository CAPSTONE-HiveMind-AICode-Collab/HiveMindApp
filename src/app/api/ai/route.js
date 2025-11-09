import { NextResponse } from "next/server";
import { model } from "@/lib/firebase/config"; // server-only

// src/pages/api/ai.js (or src/app/api/ai/route.js for App Router)
export async function POST(req) {
  try {
    const { message } = await req.json();
    if (!message) throw new Error("No message provided");

    // Use generateContent and extract text
    const result = await model.generateContent(message);
    const response = await result.response;
    const aiReply = response.text() || "AI did not respond.";

    return NextResponse.json({ reply: aiReply });
  } catch (error) {
    console.error("AI API error:", error); // <-- THIS IS THE ERROR WE NEED!
    return NextResponse.json(
      { reply: "Error generating AI response." },
      { status: 500 }
    );
  }
}
