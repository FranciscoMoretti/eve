import type { SandboxAccess } from "#sandbox/state.js";
import type { HarnessSession, StepInput } from "#harness/types.js";
import { getHarnessEmissionState } from "#harness/emission-state.js";
import { createDurableSessionState } from "#execution/durable-session-store.js";

import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";

/** Captures native history before a new user turn; internal continuations do not create checkpoints. */
export async function writeSessionCheckpoint(input: {
  readonly session: HarnessSession;
  readonly checkpointId?: string;
  readonly delivery: StepInput | undefined;
  readonly sandbox?: SandboxAccess;
  readonly target:
    | { readonly sessionId: string; readonly writable: WritableStream<SessionCheckpoint> }
    | undefined;
}): Promise<void> {
  const emission = getHarnessEmissionState(input.session.state);
  if (
    (!input.checkpointId && input.delivery?.message === undefined) ||
    emission.turnId !== "" ||
    input.target?.sessionId !== input.session.sessionId
  )
    return;
  let sandboxState = input.session.sandboxState;
  if (sandboxState?.initialized || sandboxState?.session) {
    // Unsupported resources return no seed. Transient I/O failures propagate before
    // writing, so a retry cannot conflict with a previously written missing seed.
    const forkCheckpoint = await input.sandbox?.captureForkCheckpoint?.(
      input.checkpointId ? `idle_${input.checkpointId}` : `turn_${emission.sequence}`,
    );
    sandboxState = { ...sandboxState, forkCheckpoint };
  }
  const snapshot = createDurableSessionState({
    session: { ...input.session, sandboxState },
  }).snapshot;
  if (snapshot === undefined)
    throw new Error("A session checkpoint requires an embedded snapshot.");
  const writer = input.target.writable.getWriter();
  try {
    await writer.write({
      version: 1,
      checkpointId: input.checkpointId || undefined,
      sessionId: input.session.sessionId,
      beforeTurnId: `turn_${emission.sequence}`,
      snapshot: { ...snapshot, version: 2 },
    });
  } finally {
    writer.releaseLock();
  }
}
