import { InitiatorAuthKey } from "#context/keys.js";
import {
  restoreSessionStep,
  type SessionHistoryStepState,
} from "#execution/publish-session-events.js";
import {
  COPY_SEED_NAMESPACE,
  copyCheckpointPrincipal,
  readCopyCheckpoint,
  writeCopyCheckpoint,
} from "#execution/copy-checkpoint.js";
import {
  parseSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";

/** Retains trusted input after owner arbitration; imported forks never decode display history. */
export async function retainSessionTranscriptSeedStep(
  input: SessionHistoryStepState & { readonly seed: SessionTranscriptSeed },
): Promise<void> {
  "use step";
  const restored = await restoreSessionStep(input);
  const principal = restored.ctx.get(InitiatorAuthKey);
  const sessionId = input.sessionState.sessionId;
  if (!principal || principal.principalType === "anonymous") return;
  if (await readCopyCheckpoint(sessionId, "seed", COPY_SEED_NAMESPACE)) return;
  await writeCopyCheckpoint(
    {
      version: 1,
      sessionId,
      checkpointId: "seed",
      beforeTurnId: "turn_0",
      principalId: principal.principalId,
      principalIdentity: copyCheckpointPrincipal(principal),
      history: [],
      events: [],
      sandbox: null,
      seed: parseSessionTranscriptSeed(input.seed),
    },
    COPY_SEED_NAMESPACE,
  );
}
