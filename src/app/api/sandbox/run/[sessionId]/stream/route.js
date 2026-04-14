import { getSandboxSession } from "@/lib/server/sandbox/sessionStore";
import { authenticateSandboxRequest } from "@/lib/server/sandbox/auth";

export const runtime = "nodejs";

export async function GET(req, { params }) {
  const resolvedParams = await params;
  const sessionId = String(resolvedParams?.sessionId || "");
  const session = getSandboxSession(sessionId, { fresh: true });

  if (!session) {
    return new Response("Sandbox session not found.", { status: 404 });
  }

  const authResult = await authenticateSandboxRequest(req, session.meta?.hiveID || "");
  if (authResult.error) {
    return authResult.error;
  }

  const encoder = new TextEncoder();
  let heartbeat = null;
  let poller = null;
  let lastEventIndex = 0;
  let closed = false;
  let pumping = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName, payload) => {
        controller.enqueue(
          encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      const closeStream = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        if (poller) {
          clearInterval(poller);
        }
        controller.close();
      };

      const pump = async () => {
        if (closed || pumping) {
          return;
        }

        pumping = true;

        try {
          const currentSession = getSandboxSession(sessionId, { fresh: true });
          if (!currentSession) {
            send("done", {
              success: false,
              exitCode: null,
              summary: "Sandbox session could not be found while streaming output.",
              timestamp: Date.now(),
            });
            closeStream();
            return;
          }

          const events = Array.isArray(currentSession.events) ? currentSession.events : [];
          while (lastEventIndex < events.length) {
            const event = events[lastEventIndex];
            send(event.type, event.payload);
            lastEventIndex += 1;
          }

          if (currentSession.finalized) {
            closeStream();
          }
        } catch (error) {
          send("done", {
            success: false,
            exitCode: null,
            summary: String(error?.message || "Sandbox stream failed."),
            timestamp: Date.now(),
          });
          closeStream();
        } finally {
          pumping = false;
        }
      };

      void pump();

      poller = setInterval(() => {
        void pump();
      }, 300);

      heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }
      }, 15000);
    },
    cancel() {
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (poller) {
        clearInterval(poller);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
