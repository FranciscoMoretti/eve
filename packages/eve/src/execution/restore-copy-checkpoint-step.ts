import { InitiatorAuthKey, ParentSessionKey, SandboxKey } from "#context/keys.js";
import {
  publishFromSessionStep,
  restoreSessionStep,
  type SessionHistoryStepState,
} from "#execution/publish-session-events.js";
import { withSessionStateDelta } from "#execution/session/state-delta.js";
import { copyCheckpointPrincipal, type CopyCheckpointRecord } from "#execution/copy-checkpoint.js";

/** Materializes destination resources before publishing any copied display history. */
export async function restoreCopyCheckpointStep(
  input: SessionHistoryStepState & { readonly checkpoint: CopyCheckpointRecord },
) {
  "use step";
  const checkpoint = input.checkpoint;
  if ("rejected" in checkpoint) throw new Error("Checkpoint is unavailable.");
  return await withSessionStateDelta(input, async () => {
    const restored = await restoreSessionStep(input);
    const principal = restored.ctx.get(InitiatorAuthKey);
    if (
      principal?.principalId !== checkpoint.principalId ||
      copyCheckpointPrincipal(principal) !== checkpoint.principalIdentity ||
      principal.principalType === "anonymous" ||
      restored.ctx.get(ParentSessionKey) !== undefined
    )
      throw new Error("Checkpoint restoration requires its authenticated root owner.");
    const { published } = await publishFromSessionStep(
      { ...restored, history: input.history },
      {
        origin: "own",
        async publish(emit) {
          if (checkpoint.sandbox !== null) {
            const sandbox = await restored.ctx.get(SandboxKey)?.get();
            if (!sandbox) throw new Error("Copied sandbox is unavailable.");
          }
          await emit({
            type: "history.restored",
            data: { beforeTurnId: checkpoint.beforeTurnId, events: checkpoint.events },
          });
        },
      },
    );
    return published;
  });
}
