import { getRun } from "#internal/workflow/runtime.js";
import { readNdjsonStream } from "#client/ndjson.js";
import type { EveMessage, EveMessagePart } from "#client/message-reducer-types.js";
import { EVE_MESSAGE_STREAM_VERSION } from "#protocol/message.js";
import { prepareSessionTranscriptSeed } from "#execution/session-transcript-seed.js";

function seedPart(part: EveMessagePart): unknown {
  switch (part.type) {
    case "text":
    case "reasoning":
      return { type: part.type, text: part.text };
    case "step-start":
      return { type: part.type };
    case "file":
      return {
        type: part.type,
        url: part.url,
        mediaType: part.mediaType,
        filename: part.filename,
        size: part.size,
      };
    case "dynamic-tool": {
      const base = {
        type: part.type,
        toolName: part.toolName,
        input: part.input,
        state: part.state,
      };
      if (part.state === "output-available")
        return { ...base, output: part.output, outputType: part.outputType };
      if (part.state === "output-error") return { ...base, errorText: part.errorText };
      if (part.state === "output-denied") return { ...base, reason: part.approval?.reason };
      break;
    }
  }
  throw new Error("Imported history contains unfinished or unsupported content.");
}

export function prepareSessionTranscriptPrefix(
  messages: readonly EveMessage[],
  beforeMessageId: string,
) {
  if (!/^seed_message_(0|[1-9][0-9]{0,3})$/.test(beforeMessageId))
    throw new Error("Invalid imported message boundary.");
  const index = messages.findIndex((message) => message.id === beforeMessageId);
  if (index < 0 || messages[index]?.role !== "user")
    throw new Error("Imported user message boundary was not found.");
  if (messages.some((message, index) => message.id !== `seed_message_${index}`))
    throw new Error("Invalid imported message identities.");
  if (index === 0) return { history: [], messages: [] };
  return prepareSessionTranscriptSeed({
    attachments: "channel",
    messages: messages.slice(0, index).map((message) => {
      const seed: Record<string, unknown> = {
        role: message.role,
        parts: message.parts.map(seedPart),
      };
      if (message.metadata?.custom !== undefined) seed.metadata = message.metadata.custom;
      if (message.metadata?.annotations !== undefined)
        seed.annotations = message.metadata.annotations;
      if (message.role === "assistant" && message.metadata?.modelId !== undefined)
        seed.modelId = message.metadata.modelId;
      return seed;
    }),
  });
}

/** Caller must authorize the source. Only immutable imported history can be selected. */
export async function readSessionTranscriptPrefix(input: {
  readonly sessionId: string;
  readonly beforeMessageId: string;
}) {
  const abort = new AbortController();
  let bytes = 0;
  const stream = getRun(input.sessionId)
    .getReadable<Uint8Array>()
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > 8 * 1024 * 1024) throw new Error("Imported history byte limit exceeded.");
          controller.enqueue(chunk);
        },
      }),
      { signal: abort.signal },
    );
  const timeout = setTimeout(
    () => abort.abort(new Error("Imported history read timed out.")),
    10_000,
  );
  let scanned = 0;
  try {
    for await (const event of readNdjsonStream(stream, {
      streamVersion: EVE_MESSAGE_STREAM_VERSION,
    })) {
      if (++scanned > 50_000) throw new Error("Imported history event limit exceeded.");
      const candidates = event.type === "history.restored" ? event.data.events : [event];
      for (const candidate of candidates) {
        if (candidate.type === "history.seeded")
          return prepareSessionTranscriptPrefix(candidate.data.messages, input.beforeMessageId);
      }
      // A live turn before any seeded history cannot later acquire imported history.
      if (event.type === "turn.started") break;
    }
    throw new Error("Imported history was not found.");
  } finally {
    clearTimeout(timeout);
    abort.abort();
  }
}
