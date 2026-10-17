import { checkpointReady } from "#harness/session-machine/transitions.js";
import { publishTransition, sessionView } from "#harness/session-machine/commit.js";
import { dispatchCheckpointHooks } from "#context/hook-lifecycle.js";
import {
  CopyCheckpointsKey,
  InitiatorAuthKey,
  ParentSessionKey,
  SandboxKey,
} from "#context/keys.js";
import {
  copyCheckpointPrincipal,
  boundaryCopyCheckpointId,
  readCopyCheckpoint,
  validateCopyCheckpointRequest,
  writeCopyCheckpoint,
  type CopyCheckpointRequest,
  type CopyCheckpointRecord,
} from "#execution/copy-checkpoint.js";
import { isSessionStateIdleForHandoff } from "#execution/session/handoff-steps.js";
import {
  publishFromSessionStep,
  restoreSessionStep,
  type SessionHistoryStepState,
} from "#execution/publish-session-events.js";
import { withSessionStateDelta } from "#execution/session/state-delta.js";
import { streamSessionEvents } from "#execution/session-event-stream.js";
import { storedProjection, turnPosition } from "#harness/session-machine/view.js";
import { readTaskTable, workingTasks } from "#execution/tasks/table.js";
import type { MessageStreamEvent } from "#protocol/message.js";
import {
  seedFileDigests,
  stagePendingSeedAttachments,
  restoreSeedFileDigests,
} from "#harness/seed-attachments.js";
import { createLogger, logError } from "#internal/logging.js";

const log = createLogger("execution.copy-checkpoint");

/** The owner awaits this step before admitting any further source work. */
export async function captureCopyCheckpointStep(
  input: SessionHistoryStepState & {
    readonly request?: CopyCheckpointRequest;
    readonly active?: boolean;
  },
) {
  "use step";
  try {
    return await withSessionStateDelta(input, async () => {
      const restored = await restoreSessionStep(input);
      const principal = restored.ctx.get(InitiatorAuthKey);
      const automatic = input.request === undefined;
      if (
        automatic &&
        (restored.ctx.get(CopyCheckpointsKey) !== true ||
          !principal ||
          principal.principalType === "anonymous" ||
          restored.ctx.get(ParentSessionKey) !== undefined)
      )
        return { sessionState: input.sessionState };
      const sessionId = input.sessionState.sessionId;
      const state = input.sessionState.snapshot.session.state;
      const current = `turn_${turnPosition(storedProjection(state)).sequence}`;
      const announce = storedProjection(state).started === true;
      const request = input.request ?? {
        kind: "copy-checkpoint",
        checkpointId: boundaryCopyCheckpointId(sessionId, current),
        beforeTurnId: current,
        principalId: principal?.principalId ?? "",
        principalIdentity: copyCheckpointPrincipal(principal),
      };
      validateCopyCheckpointRequest(request);
      if (automatic && state?.["eve.publishedCopyCheckpoint"] === request.checkpointId)
        return { sessionState: input.sessionState };

      if (
        principal?.principalId !== request.principalId ||
        copyCheckpointPrincipal(principal) !== request.principalIdentity ||
        principal.principalType === "anonymous" ||
        restored.ctx.get(ParentSessionKey) !== undefined
      )
        throw new Error("Copy checkpoint source is not owned by this principal.");
      const previous = await readCopyCheckpoint(sessionId, request.checkpointId);
      if (previous !== undefined) {
        if (
          previous.beforeTurnId !== request.beforeTurnId ||
          previous.principalId !== request.principalId ||
          previous.principalIdentity !== request.principalIdentity
        )
          throw new Error("Copy checkpoint identity conflict.");
        if (
          input.active ||
          !announce ||
          "rejected" in previous ||
          (automatic && state?.["eve.publishedCopyCheckpoint"] === request.checkpointId)
        )
          return { sessionState: input.sessionState };
        const { published } = await publishFromSessionStep(
          { ...restored, history: input.history },
          {
            origin: "own",
            async publish(emit) {
              await publishTransition(
                checkpointReady(sessionView(storedProjection(state), state), {
                  checkpointId: request.checkpointId,
                  beforeTurnId: previous.beforeTurnId,
                }),
                emit,
              );
            },
            updateSession(session) {
              return {
                session: {
                  ...session,
                  state: { ...session.state, "eve.publishedCopyCheckpoint": request.checkpointId },
                },
              };
            },
          },
        );
        return published;
      }
      const identity = {
        version: 1 as const,
        sessionId,
        checkpointId: request.checkpointId,
        beforeTurnId: request.beforeTurnId,
        principalId: request.principalId,
        principalIdentity: request.principalIdentity,
      };
      if (
        input.active ||
        !isSessionStateIdleForHandoff(input) ||
        workingTasks(readTaskTable(state)).length > 0
      ) {
        if (!automatic) await writeCopyCheckpoint({ ...identity, rejected: "source_not_idle" });
        return { sessionState: input.sessionState };
      }
      if (current !== request.beforeTurnId) {
        await writeCopyCheckpoint({ ...identity, rejected: "source_advanced" });
        return { sessionState: input.sessionState };
      }
      const events: MessageStreamEvent[] = [];
      let bytes = 0;
      const signal = AbortSignal.timeout(10_000);
      const deadline = Promise.withResolvers<never>();
      const abort = () => deadline.reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      try {
        await Promise.race([
          (async () => {
            for await (const event of streamSessionEvents(sessionId, { follow: false, signal })) {
              bytes += Buffer.byteLength(JSON.stringify(event));
              if (events.length >= 10_000 || bytes > 8 * 1024 * 1024)
                throw new Error("Copy checkpoint history exceeds its bound.");
              events.push(event);
            }
          })(),
          deadline.promise,
        ]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
      signal.throwIfAborted();
      const { published } = await publishFromSessionStep(
        { ...restored, history: input.history },
        {
          origin: "own",
          async publish(emit, session) {
            const access = restored.ctx.get(SandboxKey);
            let record: CopyCheckpointRecord;
            let staged = session;
            try {
              staged = await stagePendingSeedAttachments(session);
              if (access?.captureFork === undefined && session.sandboxState?.session != null)
                throw new Error("Sandbox cannot capture a copy.");
              const sandbox = (await access?.captureFork?.(request.checkpointId)) ?? null;
              record = {
                ...identity,
                history: staged.history,
                events,
                sandbox,
                seedFileDigests: seedFileDigests(staged),
              };
            } catch (error) {
              logError(log, "immutable sandbox capture failed", error);
              record = { ...identity, rejected: "resource_unavailable" };
            }
            if (!("rejected" in record))
              await dispatchCheckpointHooks(restored.ctx, {
                checkpointId: request.checkpointId,
                beforeTurnId: current,
              });
            // Events publish immediately. Commit the receipt before advertising readiness.
            if (!(automatic && "rejected" in record)) await writeCopyCheckpoint(record);
            if (announce && !("rejected" in record))
              await publishTransition(
                checkpointReady(sessionView(storedProjection(state), state), {
                  checkpointId: request.checkpointId,
                  beforeTurnId: current,
                }),
                emit,
              );
            return { record, staged };
          },
          updateSession(session, { record, staged }) {
            if ("rejected" in record) return { session };
            const copied = restoreSeedFileDigests(
              { ...session, history: staged.history },
              seedFileDigests(staged),
            );
            return {
              session: announce
                ? {
                    ...copied,
                    state: { ...copied.state, "eve.publishedCopyCheckpoint": request.checkpointId },
                  }
                : copied,
            };
          },
        },
      );
      return published;
    });
  } catch (error) {
    // Failure to capture is not a failure of the source conversation. Leave
    // an uncommitted request unresolved; never claim a ready checkpoint.
    logError(log, "copy checkpoint request was not committed", error);
    return { stateDelta: {} };
  }
}
