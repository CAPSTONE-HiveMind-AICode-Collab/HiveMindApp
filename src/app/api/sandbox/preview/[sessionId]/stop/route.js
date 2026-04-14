import { NextResponse } from "next/server";
import { authenticateSandboxRequest } from "@/lib/server/sandbox/auth";
import { getSandboxSession } from "@/lib/server/sandbox/sessionStore";
import { stopSandboxPreview } from "@/lib/server/sandbox/runner";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  try {
    const resolvedParams = await params;
    const sessionId = String(resolvedParams?.sessionId || "");
    const payload = await req.json().catch(() => ({}));
    const session = getSandboxSession(sessionId, { fresh: true });

    if (!session) {
      return NextResponse.json({ error: "Preview session not found." }, { status: 404 });
    }

    const authResult = await authenticateSandboxRequest(
      req,
      String(payload?.hiveID || session.meta?.hiveID || "").trim()
    );
    if (authResult.error) {
      return authResult.error;
    }

    const result = await stopSandboxPreview(sessionId, {
      reason: String(payload?.reason || "Preview stopped.").trim() || "Preview stopped.",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Sandbox preview stop route failed:", error);
    return NextResponse.json(
      { error: String(error?.message || "Could not stop live preview.") },
      { status: 500 }
    );
  }
}
