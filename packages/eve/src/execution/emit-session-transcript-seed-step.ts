import {
  prepareSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";
import {
  createSessionWaitingEvent,
  encodeMessageStreamEvent,
  stampMessageStreamEvent,
} from "#protocol/message.js";

/** Called by the initial owner after alias arbitration, before it can process a turn. */
export async function emitSessionTranscriptSeedStep(input: {
  readonly seed: SessionTranscriptSeed;
  readonly writable: WritableStream<Uint8Array>;
}): Promise<void> {
  "use step";
  const prepared = prepareSessionTranscriptSeed(input.seed);
  const writer = input.writable.getWriter();
  try {
    await writer.write(
      encodeMessageStreamEvent(
        stampMessageStreamEvent({ type: "history.seeded", data: { messages: prepared.messages } }),
      ),
    );
    await writer.write(
      encodeMessageStreamEvent(stampMessageStreamEvent(createSessionWaitingEvent(undefined))),
    );
  } finally {
    writer.releaseLock();
  }
}
