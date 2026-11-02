import type { RuntimeIdentity } from "#protocol/session-events/families/session.js";
import type { SessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import { publishSessionEvents, type SessionStepState } from "#execution/publish-session-events.js";

/** Called only after the fresh owner wins continuation arbitration. */
export async function emitSessionTranscriptSeedStep(
  input: SessionStepState & {
    readonly seed: SessionTranscriptSeed;
    readonly runtime: RuntimeIdentity;
  },
) {
  "use step";
  return await publishSessionEvents(input, [
    { type: "session.started", data: { transcriptSeed: input.seed, runtime: input.runtime } },
  ]);
}
