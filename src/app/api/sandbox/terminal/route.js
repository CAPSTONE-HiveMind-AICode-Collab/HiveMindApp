import { NextResponse } from "next/server";
import {
  authenticateSandboxRequest,
  hasSandboxRole,
  loadSandboxRoomConfig,
} from "@/lib/server/sandbox/auth";
import { createSandboxSession } from "@/lib/server/sandbox/sessionStore";
import { startSandboxTerminalSession } from "@/lib/server/sandbox/terminal";
import { normalizeSandboxConfig } from "@/lib/sandbox/config";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    const hiveID = String(payload?.hiveID || "").trim();
    const honeycombID = String(payload?.honeycombID || "").trim();
    const requestedConfig = normalizeSandboxConfig(payload?.config || {});
    const draftCode = String(payload?.draftCode || "");
    const applyDraft = Boolean(payload?.applyDraft);

    const authResult = await authenticateSandboxRequest(req, hiveID);
    if (authResult.error) {
      return authResult.error;
    }

    if (!honeycombID) {
      return NextResponse.json({ error: "Honeycomb ID is required." }, { status: 400 });
    }

    if (!hasSandboxRole(authResult.auth.role, "MEMBER")) {
      return NextResponse.json(
        { error: "You do not have permission to start a sandbox terminal in this room." },
        { status: 403 }
      );
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
      kind: "terminal",
      uid: authResult.auth.uid,
    });

    const terminal = await startSandboxTerminalSession(session.id, {
      config,
      draftCode,
      applyDraft,
      cols: payload?.cols,
      rows: payload?.rows,
    });

    return NextResponse.json({
      sessionId: session.id,
      shellLabel: terminal.shellLabel,
      workingDirectory: terminal.workingDirectory,
      cols: terminal.cols,
      rows: terminal.rows,
    });
  } catch (error) {
    console.error("Sandbox terminal route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not start the sandbox terminal.") },
      { status: 500 }
    );
  }
}
