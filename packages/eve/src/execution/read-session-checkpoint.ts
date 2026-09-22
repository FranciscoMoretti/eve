import { isDeepStrictEqual } from "node:util";
import { getRun } from "#internal/workflow/runtime.js";
import {
  SESSION_CHECKPOINT_NAMESPACE,
  type SessionCheckpoint,
  type SessionTurnForkReference,
} from "#execution/session-checkpoint-contract.js";

export class SessionCheckpointNotFoundError extends Error {}
export class SessionCheckpointRejectedError extends Error {}

const MAX_CHECKPOINTS = 1_000;
const READ_TIMEOUT_MS = 10_000;

/** Reads a finite checkpoint prefix. Callers must authorize the source session before invoking this. */
export async function readSessionCheckpoint(
  input: SessionTurnForkReference,
): Promise<SessionCheckpoint> {
  const stream = getRun(input.sessionId).getReadable<SessionCheckpoint>({
    namespace: SESSION_CHECKPOINT_NAMESPACE,
  });
  const reader = stream.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<SessionCheckpoint> => {
    const tail = await stream.getTailIndex();
    if (tail >= MAX_CHECKPOINTS) throw new Error("Session checkpoint scan limit exceeded.");
    let found: SessionCheckpoint | undefined;
    for (let index = 0; index <= tail; index++) {
      const { value, done } = await reader.read();
      if (done || value === undefined)
        throw new Error("Session checkpoint stream ended unexpectedly.");
      if (value.version !== 1 || value.sessionId !== input.sessionId)
        throw new Error("Invalid session checkpoint identity or version.");
      if (value.checkpointId !== input.checkpointId) continue;
      if (value.beforeTurnId !== input.beforeTurnId) {
        if (input.checkpointId)
          throw new SessionCheckpointRejectedError(
            "Checkpoint identity already has a different source turn.",
          );
        continue;
      }
      if (value.rejected) throw new SessionCheckpointRejectedError(value.rejected);
      // Legacy fork snapshots never certified sandbox birth identity. Keep this
      // migration local to the fork format, independent of Workflow snapshots.
      const raw = value.snapshot as
        | SessionCheckpoint["snapshot"]
        | { version: 1; session: SessionCheckpoint["snapshot"]["session"] };
      const snapshot =
        raw?.version === 1
          ? { version: 2 as const, session: { ...raw.session, localSandboxIdentity: undefined } }
          : raw;
      if (snapshot?.version !== 2) throw new Error("Unsupported fork checkpoint version.");
      if (snapshot.session.sessionId !== input.sessionId)
        throw new Error("Invalid checkpoint snapshot identity.");
      if (found && !isDeepStrictEqual(found.snapshot, snapshot))
        throw new Error("Conflicting session checkpoint retries.");
      found = { ...value, snapshot };
    }
    if (!found) throw new SessionCheckpointNotFoundError("Session checkpoint was not found.");
    return found;
  };
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Session checkpoint read timed out.")),
          READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    void reader.cancel().catch(() => {
      /* Cleanup must not delay the result if the stream stalls or cancellation fails. */
    });
    reader.releaseLock();
  }
}
