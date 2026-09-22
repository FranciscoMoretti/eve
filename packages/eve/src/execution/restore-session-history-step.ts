import { readSessionTranscriptPrefix } from "#execution/read-session-transcript-prefix.js";
import { getRun } from "#internal/workflow/runtime.js";
import { readNdjsonStream } from "#client/ndjson.js";
import {
  EVE_MESSAGE_STREAM_VERSION,
  encodeMessageStreamEvent,
  stampMessageStreamEvent,
  type HistoryProjectionEvent,
  type MessageStreamEvent,
} from "#protocol/message.js";
import type {
  SessionForkReference,
  SessionTurnForkReference,
} from "#execution/session-checkpoint-contract.js";

const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_EVENTS = 50_000;
const READ_TIMEOUT_MS = 10_000;

/** Writes a display-only prefix after native checkpoint restoration has succeeded. */
export async function restoreSessionHistory(input: {
  readonly fork: SessionForkReference;
  readonly writable: WritableStream<Uint8Array>;
}): Promise<void> {
  if ("beforeMessageId" in input.fork) {
    const prepared = await readSessionTranscriptPrefix(input.fork);
    const writer = input.writable.getWriter();
    try {
      await writer.write(
        encodeMessageStreamEvent(
          stampMessageStreamEvent({
            type: "history.seeded",
            data: { messages: prepared.messages },
          }),
        ),
      );
    } finally {
      writer.releaseLock();
    }
    return;
  }
  const events = await readSessionHistory(input.fork);
  const writer = input.writable.getWriter();
  try {
    await writer.write(
      encodeMessageStreamEvent(
        stampMessageStreamEvent({
          type: "history.restored",
          data: {
            beforeTurnId: input.fork.beforeTurnId,
            sourceSessionId: input.fork.sessionId,
            events,
          },
        }),
      ),
    );
  } finally {
    writer.releaseLock();
  }
}

async function readSessionHistory(
  fork: SessionTurnForkReference,
): Promise<HistoryProjectionEvent[]> {
  const abort = new AbortController();
  const source = getRun(fork.sessionId).getReadable<Uint8Array>();
  let bytes = 0;
  const stream = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > MAX_HISTORY_BYTES) throw new Error("Session history byte limit exceeded.");
        controller.enqueue(chunk);
      },
    }),
    { signal: abort.signal },
  );
  const events: HistoryProjectionEvent[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  const append = (event: HistoryProjectionEvent) => {
    if (seen.has(event.meta.id)) return;
    seen.add(event.meta.id);
    events.push(event);
    if (events.length > MAX_HISTORY_EVENTS)
      throw new Error("Session history event limit exceeded.");
  };
  const timeout = setTimeout(
    () => abort.abort(new Error("Session history read timed out.")),
    READ_TIMEOUT_MS,
  );
  try {
    for await (const event of readNdjsonStream(stream, {
      streamVersion: EVE_MESSAGE_STREAM_VERSION,
    })) {
      if (++scanned > MAX_HISTORY_EVENTS) {
        throw new Error("Session history scan limit exceeded.");
      }
      if (
        fork.checkpointId &&
        event.type === "session.waiting" &&
        event.data.checkpoint?.checkpointId === fork.checkpointId
      ) {
        if (event.data.checkpoint.beforeTurnId !== fork.beforeTurnId)
          throw new Error("Session history checkpoint boundary mismatch.");
        return events;
      }
      if (event.type === "turn.started" && event.data.turnId === fork.beforeTurnId) {
        if (fork.checkpointId)
          throw new Error("Session history named checkpoint boundary was not found.");
        return events;
      }
      if (event.type === "history.restored") {
        for (const historical of event.data.events) append(historical);
      } else if (event.type === "hook.result") {
        if (event.data.responseMetadata !== undefined)
          append({
            ...event,
            data: {
              hookId: event.data.hookId,
              turnId: event.data.turnId,
              responseMetadata: event.data.responseMetadata,
            },
          });
      } else if (isHistoryProjectionEvent(event)) {
        append(event);
      }
    }
    throw new Error("Session history turn boundary was not found.");
  } finally {
    clearTimeout(timeout);
    abort.abort();
  }
}

function isHistoryProjectionEvent(event: MessageStreamEvent): event is HistoryProjectionEvent {
  switch (event.type) {
    case "history.seeded":
    case "message.received":
    case "step.started":
    case "message.appended":
    case "message.completed":
    case "reasoning.appended":
    case "reasoning.completed":
    case "action.input.appended":
    case "actions.requested":
    case "action.partial":
    case "action.result":
    case "input.requested":
    case "input.resolved":
    case "approval.candidate":
    case "approval.settled":
    case "result.completed":
    case "turn.completed":
    case "turn.cancelled":
    case "turn.failed":
      return true;
    default:
      return false;
  }
}
