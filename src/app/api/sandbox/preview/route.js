import { NextResponse } from "next/server";
import {
  authenticateSandboxRequest,
  hasSandboxRole,
  loadSandboxRoomConfig,
} from "@/lib/server/sandbox/auth";
import { createSandboxSession } from "@/lib/server/sandbox/sessionStore";
import { getSandboxPreviewCommand, normalizeSandboxConfig } from "@/lib/sandbox/config";
import { startSandboxPreview } from "@/lib/server/sandbox/runner";

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
        { error: "You do not have permission to start live preview in this room." },
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

    const session = createSandboxSession({
      hiveID,
      honeycombID,
      sourceMessageID: String(payload?.sourceMessageID || ""),
      runtime: config.runtime,
      kind: "preview",
      uid: authResult.auth.uid,
    });

    const preview = await startSandboxPreview(session.id, {
      config,
      draftCode,
    });

    return NextResponse.json({
      sessionId: session.id,
      command: preview.command || getSandboxPreviewCommand(config, config.previewPort),
      previewPort: preview.previewPort,
      previewUrl: preview.previewUrl,
    });
  } catch (error) {
    console.error("Sandbox preview route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not start live preview.") },
      { status: 500 }
    );
  }
}
