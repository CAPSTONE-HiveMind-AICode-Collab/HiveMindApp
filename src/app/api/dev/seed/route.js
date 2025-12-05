// src/app/api/dev/seed/route.js
// DEV ONLY: creates sample Hive/Honeycomb/messages for quick local demos
// Only runs if NEXT_PUBLIC_DEV_SEED=1 or DEV_SEED=1

import { NextResponse } from "next/server";
import { db } from "@/lib/firebase/config";
import { collection, doc, setDoc, addDoc, serverTimestamp } from "firebase/firestore";

export async function POST(req) {
  const seedEnabled = process.env.NEXT_PUBLIC_DEV_SEED === "1" || process.env.DEV_SEED === "1";
  if (!seedEnabled) {
    return NextResponse.json(
      { error: "Dev seed disabled. Set NEXT_PUBLIC_DEV_SEED=1 or DEV_SEED=1 to enable." },
      { status: 403 }
    );
  }

  try {
    console.info("🌱 Seeding dev data...");

    // Create a sample hive
    const hiveID = "demo-hive";
    const hiveRef = doc(db, "Hive", hiveID);
    await setDoc(hiveRef, {
      name: "Demo Hive",
      createdAt: serverTimestamp(),
      description: "Sample hive for local dev/demo",
    });
    console.info(`✅ Created Hive: ${hiveID}`);

    // Create a sample honeycomb
    const honeycombID = "general";
    const honeycombRef = doc(db, "Hive", hiveID, "Honeycomb", honeycombID);
    await setDoc(honeycombRef, {
      name: "General Discussion",
      createdAt: serverTimestamp(),
      ownerId: "demo-user",
    });
    console.info(`✅ Created Honeycomb: ${honeycombID}`);

    // Create sample messages
    const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
    const msg1 = await addDoc(messagesRef, {
      text: "Hello! This is a demo message. Click 'Start Thread' to begin a discussion.",
      sender: "Demo User",
      senderId: "demo-user",
      timestamp: serverTimestamp(),
    });
    console.info(`✅ Created message 1: ${msg1.id}`);

    const msg2 = await addDoc(messagesRef, {
      text: "Try clicking 'Ask AI' on the first message to see demo AI replies.",
      sender: "Demo User",
      senderId: "demo-user",
      timestamp: serverTimestamp(),
    });
    console.info(`✅ Created message 2: ${msg2.id}`);

    // Create a sample thread and summary
    const threadRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", msg1.id, "Threads");
    const threadMsg = await addDoc(threadRef, {
      text: "Great idea! Let's explore this.",
      sender: "Demo User",
      senderId: "demo-user",
      timestamp: serverTimestamp(),
      status: "closed",
    });
    console.info(`✅ Created thread: ${threadMsg.id}`);

    // Create a sample summary
    const summariesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "threadSummaries");
    await setDoc(doc(summariesRef, threadMsg.id), {
      parentMessageID: msg1.id,
      threadID: threadMsg.id,
      summaryText: `Title: Demo Discussion Summary\n\nSummary:\n- Discussed an interesting idea\n- Agreed on next steps\n- Marked complete\n\nFollow-ups:\n- Schedule follow-up meeting\n- Document findings`,
      generatedAt: serverTimestamp(),
      closedByUserId: "demo-user",
      closedByUserName: "Demo User",
    });
    console.info(`✅ Created summary for thread: ${threadMsg.id}`);

    return NextResponse.json({
      success: true,
      message: "✅ Dev data seeded successfully!",
      hiveID,
      honeycombID,
      instructions: `Navigate to /hive/${hiveID}/honeycomb/${honeycombID} to see the demo.`,
    });
  } catch (error) {
    console.error("❌ Seed failed:", error);
    return NextResponse.json(
      { error: String(error?.message || error), stack: error?.stack },
      { status: 500 }
    );
  }
}
