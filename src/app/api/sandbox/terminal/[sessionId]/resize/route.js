import { NextResponse } from "next/server";
import { authenticateSandboxRequest } from "@/lib/server/sandbox/auth";
import { getSandboxSession } from "@/lib/server/sandbox/sessionStore";
import { resizeSandboxTerminalSession } from "@/lib/server/sandbox/terminal";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  try {
    const resolvedParams = await params;
    const sessionId = String(resolvedParams?.sessionId || "");
    const payload = await req.json().catch(() => ({}));
    const session = getSandboxSession(sessionId, { fresh: true });

    if (!session) {
      return NextResponse.json({ error: "Terminal session not found." }, { status: 404 });
    }

    const authResult = await authenticateSandboxRequest(
      req,
      String(payload?.hiveID || session.meta?.hiveID || "").trim()
    );
    if (authResult.error) {
      return authResult.error;
    }

    if (String(authResult.auth?.uid || "") !== String(session.meta?.uid || "")) {
      return NextResponse.json(
        { error: "This terminal session belongs to another member." },
        { status: 403 }
      );
    }

    const result = await resizeSandboxTerminalSession(sessionId, {
      cols: payload?.cols,
      rows: payload?.rows,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Sandbox terminal resize route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not resize the terminal.") },
      { status: 500 }
    );
  }
}
