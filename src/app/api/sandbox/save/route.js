import { NextResponse } from "next/server";
import {
  authenticateSandboxRequest,
  hasSandboxRole,
  loadSandboxRoomConfig,
} from "@/lib/server/sandbox/auth";
import { normalizeSandboxConfig } from "@/lib/sandbox/config";
import { writeLinkedProjectFile } from "@/lib/server/sandbox/runner";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    const hiveID = String(payload?.hiveID || "").trim();
    const honeycombID = String(payload?.honeycombID || "").trim();
    const requestedConfig = normalizeSandboxConfig(payload?.config || {});
    const draftCode = String(payload?.draftCode || "");

    const authResult = await authenticateSandboxRequest(req, hiveID);
    if (authResult.error) {
      return authResult.error;
    }

    if (!honeycombID) {
      return NextResponse.json({ error: "Honeycomb ID is required." }, { status: 400 });
    }

    if (!hasSandboxRole(authResult.auth.role, "MEMBER")) {
      return NextResponse.json(
        { error: "You do not have permission to save sandbox changes in this room." },
        { status: 403 }
      );
    }

    if (!draftCode.trim()) {
      return NextResponse.json({ error: "Draft code is required." }, { status: 400 });
    }

    const roomSandboxConfig = await loadSandboxRoomConfig(hiveID, honeycombID);
    const config = normalizeSandboxConfig({
      ...roomSandboxConfig,
      targetFilePath:
        requestedConfig.targetFilePath ||
        roomSandboxConfig?.targetFilePath ||
        "",
    });

    const file = await writeLinkedProjectFile({
      config,
      draftCode,
    });

    return NextResponse.json(file);
  } catch (error) {
    console.error("Sandbox save route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not save the linked file.") },
      { status: 500 }
    );
  }
}
