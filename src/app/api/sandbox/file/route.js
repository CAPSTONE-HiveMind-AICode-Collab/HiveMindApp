import { NextResponse } from "next/server";
import {
  authenticateSandboxRequest,
  loadSandboxRoomConfig,
} from "@/lib/server/sandbox/auth";
import { readLinkedProjectFile } from "@/lib/server/sandbox/runner";
import { normalizeSandboxConfig } from "@/lib/sandbox/config";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    const hiveID = String(payload?.hiveID || "").trim();
    const honeycombID = String(payload?.honeycombID || "").trim();
    const requestedTargetFilePath = String(payload?.targetFilePath || "").trim();

    const authResult = await authenticateSandboxRequest(req, hiveID);
    if (authResult.error) {
      return authResult.error;
    }

    if (!honeycombID || !requestedTargetFilePath) {
      return NextResponse.json(
        { error: "honeycombID and targetFilePath are required." },
        { status: 400 }
      );
    }

    const roomSandboxConfig = await loadSandboxRoomConfig(hiveID, honeycombID);
    const config = normalizeSandboxConfig({
      ...roomSandboxConfig,
      targetFilePath: requestedTargetFilePath,
    });

    const file = await readLinkedProjectFile({
      linkedProjectPath: config.linkedProjectPath,
      targetFilePath: config.targetFilePath,
      allowedPaths: config.allowedPaths,
    });
    return NextResponse.json(file);
  } catch (error) {
    console.error("Sandbox file route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not load the linked file.") },
      { status: 500 }
    );
  }
}
