import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";
import {
  hasPendingSeedAttachments,
  markSeedAttachmentsPending,
} from "#harness/attachment-staging.js";
import { getHarnessEmissionState, setHarnessEmissionState } from "#harness/emission-state.js";
import type { HarnessSession } from "#harness/types.js";

/** Seeds a fresh session; source execution identities and capabilities are never restored. */
export function restoreSessionCheckpoint(input: {
  readonly target: HarnessSession;
  readonly checkpoint: SessionCheckpoint;
}): HarnessSession {
  const { target, checkpoint } = input;
  const source = checkpoint.snapshot.session;
  const emission = getHarnessEmissionState(source.state);
  if (
    checkpoint.version !== 1 ||
    checkpoint.snapshot.version !== 2 ||
    source.sessionId !== checkpoint.sessionId ||
    target.sessionId === source.sessionId ||
    checkpoint.beforeTurnId !== `turn_${emission.sequence}` ||
    emission.turnId !== ""
  ) {
    throw new Error("Invalid session fork checkpoint.");
  }
  if (target.history.length || getHarnessEmissionState(target.state).sessionStarted) {
    throw new Error("Session checkpoint restoration requires a fresh target.");
  }
  const forkCheckpoint = source.sandboxState?.forkCheckpoint;
  if (
    (source.sandboxState?.initialized || source.sandboxState?.session != null) &&
    !forkCheckpoint
  ) {
    throw new Error("Forking sandbox state requires resource copying.");
  }
  const pendingTools = new Set<string>();
  for (const message of source.history) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        !forkCheckpoint &&
        part.type === "file" &&
        (part.data instanceof URL
          ? part.data.protocol === "eve-sandbox:"
          : typeof part.data === "string" && part.data.startsWith("eve-sandbox:"))
      ) {
        throw new Error("Forking sandbox attachments requires resource copying.");
      }
      if (part.type === "tool-call" && !part.providerExecuted) pendingTools.add(part.toolCallId);
      if (part.type === "tool-result") pendingTools.delete(part.toolCallId);
    }
  }
  if (pendingTools.size) throw new Error("Cannot fork a checkpoint with unresolved tool calls.");
  return setHarnessEmissionState(
    {
      ...(hasPendingSeedAttachments(source) ? markSeedAttachmentsPending(target) : target),
      history: [...source.history],
      ...(forkCheckpoint
        ? { sandboxState: { initialized: false, session: null, forkCheckpoint } }
        : {}),
    },
    {
      sessionStarted: false,
      sequence: emission.sequence,
      stepIndex: 0,
      turnId: "",
    },
  );
}
