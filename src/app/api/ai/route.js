// src/app/api/ai/route.js
import { adminDb } from "@/firebase/firebaseAdmin";
import admin from "firebase-admin";

const credential = admin.credential.cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
});




// POST /api/ai
export async function POST(req) {
  try {
    const { prompt } = await req.json();
    if (!prompt) return new Response("No prompt provided", { status: 400 });

    // Get a Firebase access token from Admin SDK
    const accessTokenObj = await credential.getAccessToken();
const accessToken = accessTokenObj.access_token;

    // Gemini Developer API endpoint
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const modelName = "gemini-flash-lite"; // or gemini-2.5-flash

    const apiUrl = `https://generativelanguage.googleapis.com/v1/projects/${projectId}/locations/us-central1/models/${modelName}:generateText`;

    // Call Gemini API
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/locations/us-central1/models/gemini-flash-lite:generateText`,
        {
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
            prompt,
            maxOutputTokens: 256,
            temperature: 0.7,
            }),
        }
    );

    const data = await response.json();

    // Safe extraction of AI text
    const aiText =
      data.candidates?.[0]?.content ||
      data.outputText || // fallback if the field differs
      "Sorry, I couldn't generate a response.";

    // Save AI response to Firestore
    await adminDb
      .collection("chatrooms")
      .doc("main")
      .collection("messages")
      .add({
        text: aiText.trim(),
        sender: "HiveMind AI",
        senderId: "AI",
        timestamp: new Date(),
      });

    return new Response(JSON.stringify({ text: aiText }), { status: 200 });
  } catch (err) {
    console.error("Error in /api/ai:", err);
    return new Response("AI request failed", { status: 500 });
  }
}
