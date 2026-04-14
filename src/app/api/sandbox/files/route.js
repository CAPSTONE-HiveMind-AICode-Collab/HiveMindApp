import { NextResponse } from "next/server";
import {
  authenticateSandboxRequest,
  loadSandboxRoomConfig,
} from "@/lib/server/sandbox/auth";
import { listLinkedProjectFiles } from "@/lib/server/sandbox/runner";
import { normalizeSandboxConfig } from "@/lib/sandbox/config";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    const hiveID = String(payload?.hiveID || "").trim();
    const honeycombID = String(payload?.honeycombID || "").trim();

    const authResult = await authenticateSandboxRequest(req, hiveID);
    if (authResult.error) {
      return authResult.error;
    }

    if (!honeycombID) {
      return NextResponse.json(
        { error: "honeycombID is required." },
        { status: 400 }
      );
    }

    const roomSandboxConfig = await loadSandboxRoomConfig(hiveID, honeycombID);
    const config = normalizeSandboxConfig(roomSandboxConfig);
    const files = await listLinkedProjectFiles({
      linkedProjectPath: config.linkedProjectPath,
      allowedPaths: config.allowedPaths,
    });
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Sandbox files route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not list project files.") },
      { status: 500 }
    );
  }
}
