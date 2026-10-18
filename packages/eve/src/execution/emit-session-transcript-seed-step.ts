import {
  prepareSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";
import { encodeMessageStreamEvent, stampMessageStreamEvent } from "#protocol/message.js";
import { initialSessionProjection } from "#protocol/session-projection.js";
import { seededTranscript } from "#harness/session-machine/transitions.js";
import { publishTransition, sessionView } from "#harness/session-machine/commit.js";

/** Called by the initial owner after alias arbitration, before it can process a turn. */
export async function emitSessionTranscriptSeedStep(input: {
  readonly seed: SessionTranscriptSeed;
  readonly writable: WritableStream<Uint8Array>;
}): Promise<void> {
  "use step";
  const prepared = prepareSessionTranscriptSeed(input.seed);
  const writer = input.writable.getWriter();
  try {
    await publishTransition(
      seededTranscript(sessionView(initialSessionProjection(), undefined), prepared.messages),
      async (event) => {
        await writer.write(encodeMessageStreamEvent(stampMessageStreamEvent(event)));
      },
    );
  } finally {
    writer.releaseLock();
  }
}
