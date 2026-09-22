import type { CheckpointSessionHookPayload } from "#channel/types.js";
import type { HarnessSession } from "#harness/types.js";
import type { SandboxAccess } from "#sandbox/state.js";
import { getHarnessEmissionState } from "#harness/emission-state.js";
import { createDurableSessionState } from "#execution/durable-session-store.js";
import {
  readSessionCheckpoint,
  SessionCheckpointNotFoundError,
  SessionCheckpointRejectedError,
} from "#execution/read-session-checkpoint.js";
import { writeSessionCheckpoint } from "#execution/session-checkpoint.js";
import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";

/** Called only by the serialized session driver; never runs a model step. */
export async function captureIdleSessionCheckpoint(input: {
  readonly request: CheckpointSessionHookPayload;
  readonly session: HarnessSession;
  readonly sandbox?: SandboxAccess;
  readonly target:
    | { readonly sessionId: string; readonly writable: WritableStream<SessionCheckpoint> }
    | undefined;
  readonly prepare: () => Promise<void>;
}): Promise<void> {
  if (!input.target || input.target.sessionId !== input.session.sessionId)
    throw new Error("Missing checkpoint writer for source session.");
  const reference = {
    sessionId: input.session.sessionId,
    beforeTurnId: input.request.beforeTurnId,
    checkpointId: input.request.checkpointId,
  };
  try {
    await readSessionCheckpoint(reference);
    return;
  } catch (error) {
    if (error instanceof SessionCheckpointRejectedError) return;
    if (!(error instanceof SessionCheckpointNotFoundError)) throw error;
  }
  const emission = getHarnessEmissionState(input.session.state);
  const rejected =
    emission.turnId !== ""
      ? "source_not_idle"
      : `turn_${emission.sequence}` !== input.request.beforeTurnId
        ? "source_advanced"
        : undefined;
  if (rejected) {
    const snapshot = createDurableSessionState({ session: input.session }).snapshot;
    if (!snapshot) throw new Error("Missing checkpoint snapshot.");
    const writer = input.target.writable.getWriter();
    try {
      await writer.write({
        ...reference,
        version: 1,
        snapshot: { ...snapshot, version: 2 },
        rejected,
      });
    } finally {
      writer.releaseLock();
    }
    return;
  }
  await input.prepare();
  await writeSessionCheckpoint({
    ...input,
    checkpointId: input.request.checkpointId,
    delivery: undefined,
  });
}
