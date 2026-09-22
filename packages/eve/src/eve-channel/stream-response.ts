import type { Session } from "#channel/session.js";
import {
  EVE_MESSAGE_STREAM_CONTENT_TYPE,
  EVE_MESSAGE_STREAM_FORMAT,
  EVE_MESSAGE_STREAM_VERSION,
  EVE_SESSION_ID_HEADER,
  EVE_STREAM_CONTROL_VERSION,
  EVE_STREAM_CONTROL_VERSION_QUERY,
  EVE_STREAM_FORMAT_HEADER,
  EVE_STREAM_LEASE_ENDED_CONTROL,
  EVE_STREAM_TAIL_INDEX_HEADER,
  EVE_STREAM_VERSION_HEADER,
} from "#protocol/message.js";

const SESSION_STREAM_HEARTBEAT_MS = 10_000;
const SESSION_STREAM_LEASE_MS = 60_000;
export async function createSessionStreamResponse(
  request: Request,
  session: Session,
): Promise<Response> {
  const startIndex = parseStartIndex(request);
  if (startIndex instanceof Response) return startIndex;
  const includeTailIndex = parseIncludeTailIndex(request);

  try {
    const tailIndex = includeTailIndex ? await session.getStreamTailIndex() : undefined;
    const events = await session.getEventStream({ startIndex });
    const controlVersion =
      new URL(request.url).searchParams.get(EVE_STREAM_CONTROL_VERSION_QUERY) ===
      EVE_STREAM_CONTROL_VERSION
        ? EVE_STREAM_CONTROL_VERSION
        : undefined;
    const headers = new Headers({
      "cache-control": "no-store, no-transform",
      "content-type": EVE_MESSAGE_STREAM_CONTENT_TYPE,
      "x-accel-buffering": "no",
      [EVE_SESSION_ID_HEADER]: session.id,
      [EVE_STREAM_FORMAT_HEADER]: EVE_MESSAGE_STREAM_FORMAT,
      [EVE_STREAM_VERSION_HEADER]: EVE_MESSAGE_STREAM_VERSION,
    });
    if (tailIndex !== undefined) {
      headers.set(EVE_STREAM_TAIL_INDEX_HEADER, String(tailIndex));
    }
    return new Response(
      serializeAsNdjson(
        events,
        request.signal,
        streamEventLimit(startIndex, tailIndex),
        controlVersion !== undefined,
      ),
      { headers },
    );
  } catch {
    return Response.json({ error: "Session not found.", ok: false }, { status: 404 });
  }
}

export function parseIncludeTailIndex(request: Request): boolean {
  const raw = new URL(request.url).searchParams.get("includeTailIndex");
  return raw === "1" || raw === "true";
}

export function parseStartIndex(request: Request): number | undefined | Response {
  const raw = new URL(request.url).searchParams.get("startIndex");
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(parsed)) {
    return Response.json(
      { error: "Expected startIndex to be an integer.", ok: false },
      { status: 400 },
    );
  }
  return parsed;
}

function streamEventLimit(
  startIndex: number | undefined,
  tailIndex: number | undefined,
): number | undefined {
  if (tailIndex === undefined) return undefined;
  const resolvedStartIndex =
    startIndex === undefined
      ? 0
      : startIndex < 0
        ? Math.max(0, tailIndex + 1 + startIndex)
        : startIndex;
  return Math.max(0, tailIndex - resolvedStartIndex + 1);
}

function serializeAsNdjson(
  events: ReadableStream<unknown>,
  signal: AbortSignal,
  eventLimit?: number,
  leased = false,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let eventCount = 0;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let lease: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    clearTimeout(heartbeat);
    clearTimeout(lease);
    heartbeat = undefined;
    lease = undefined;
  };
  const scheduleHeartbeat = (controller: TransformStreamDefaultController<Uint8Array>) => {
    clearTimeout(heartbeat);
    heartbeat = setTimeout(() => {
      try {
        controller.enqueue(encoder.encode("\n"));
        scheduleHeartbeat(controller);
      } catch {
        clearTimers();
      }
    }, SESSION_STREAM_HEARTBEAT_MS);
  };
  const startLease = (controller: TransformStreamDefaultController<Uint8Array>) => {
    scheduleHeartbeat(controller);
    lease = setTimeout(() => {
      clearTimers();
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(EVE_STREAM_LEASE_ENDED_CONTROL)}\n`));
        controller.terminate();
      } catch {
        // The response was cancelled while the lease callback was already queued.
      }
    }, SESSION_STREAM_LEASE_MS);
  };

  const transform = new TransformStream<unknown, Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("\n"));
      if (eventLimit === 0) {
        controller.terminate();
      } else if (leased) {
        startLease(controller);
      }
    },
    transform(event, controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      eventCount += 1;
      if (eventCount === eventLimit) {
        clearTimers();
        controller.terminate();
      } else if (leased) {
        scheduleHeartbeat(controller);
      }
    },
    flush() {
      clearTimers();
    },
  });
  void events
    .pipeTo(transform.writable, { signal })
    .catch(() => {})
    .finally(clearTimers);
  return transform.readable;
}
