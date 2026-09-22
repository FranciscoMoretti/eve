import type { RunSessionLimits } from "#channel/types.js";
import {
  createDurableSessionState,
  type DurableSessionState,
} from "#execution/durable-session-store.js";
import { resolveEffectiveAgentRuntimeFromConfig } from "#execution/effective-agent-config.js";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import { readSessionTranscriptPrefix } from "#execution/read-session-transcript-prefix.js";
import { restoreSessionCheckpoint } from "#execution/restore-session-checkpoint.js";
import { restoreSessionHistory } from "#execution/restore-session-history-step.js";
import { resolveInheritedTokenLimit } from "#execution/run-session-limits.js";
import { recordLocalSessionSandboxIdentity } from "#execution/sandbox/local-session-identity.js";
import type { SessionForkReference } from "#execution/session-checkpoint-contract.js";
import type { SessionSandboxIdentityReceipt } from "#execution/session-sandbox-identity-contract.js";
import {
  prepareSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";
import { createSession } from "#execution/session.js";
import { markSeedAttachmentsPending } from "#harness/attachment-staging.js";
import { setHarnessEmissionState } from "#harness/emission-state.js";
import {
  createSessionWaitingEvent,
  encodeMessageStreamEvent,
  stampMessageStreamEvent,
} from "#protocol/message.js";
import { getRuntimeCompiledArtifactsSandboxAppRoot } from "#runtime/compiled-artifacts-source.js";
import {
  type DurableCompiledArtifactsSource,
  resolveDurableCompiledArtifactsSource,
} from "#runtime/durable-compiled-artifacts-source.js";
import { getResolvedRuntimeAgentNode } from "#runtime/graph.js";
import { getCompiledRuntimeAgentBundle } from "#runtime/sessions/compiled-agent-cache.js";
import type { DynamicSubagentAgentConfig } from "#runtime/subagents/dynamic-agent-config.js";
import type { JsonObject } from "#shared/json.js";

/**
 * Result returned by {@link createSessionStep}.
 *
 * Exposes the projected {@link DurableSessionState} the owner needs to
 * drive the turn loop.
 */
export interface CreateSessionStepResult {
  readonly state: DurableSessionState;
}

/**
 * Creates the durable session and returns the initial snapshot-bearing
 * state before the workflow enters its turn loop.
 * `nodeId` targets a subagent node in the compiled graph; omitted for
 * the root agent.
 */
export async function createSessionStep(input: {
  readonly compiledArtifactsSource: DurableCompiledArtifactsSource;
  readonly identityWritable?: WritableStream<SessionSandboxIdentityReceipt>;
  readonly fork?: SessionForkReference;
  readonly seed?: SessionTranscriptSeed;
  readonly continuationToken: string;
  readonly dynamicSubagentAgentConfig?: DynamicSubagentAgentConfig;
  readonly inheritedLimits?: RunSessionLimits;
  readonly outputSchema?: JsonObject;
  readonly nodeId?: string;
  readonly rootSessionId?: string;
  readonly sessionId: string;
  readonly taskId?: string;
}): Promise<CreateSessionStepResult> {
  "use step";

  if (input.seed && (input.fork || input.rootSessionId || input.taskId || input.nodeId))
    throw new Error("Transcript seeds require a fresh root conversation.");
  const transcriptFork = input.fork && "beforeMessageId" in input.fork ? input.fork : undefined;
  if (
    transcriptFork &&
    (input.rootSessionId ||
      input.taskId ||
      input.nodeId ||
      transcriptFork.sessionId === input.sessionId)
  )
    throw new Error("Imported forks require a fresh root conversation.");
  const preparedSeed = input.seed
    ? prepareSessionTranscriptSeed(input.seed)
    : transcriptFork
      ? await readSessionTranscriptPrefix(transcriptFork)
      : undefined;
  const bundle = await getCompiledRuntimeAgentBundle({
    compiledArtifactsSource: resolveDurableCompiledArtifactsSource(input.compiledArtifactsSource),
    nodeId: input.nodeId,
  });
  const effectiveAgent = resolveEffectiveAgentRuntimeFromConfig(
    bundle,
    input.dynamicSubagentAgentConfig,
  );

  // Both token axes resolve tighter-wins against the cap inherited from the
  // delegating parent: a child may narrow what its parent granted, never widen
  // it. Root runs have no inherited limits, so their configured values apply.
  const session = createSession({
    compactionOverrides: {
      thresholdPercent: effectiveAgent.thresholdPercent,
    },
    continuationToken: input.continuationToken,
    limits: {
      // Inherited token limits are the parent's remaining quota share at
      // dispatch time; an authored `false` uncaps only when there is nothing
      // to inherit.
      maxInputTokensPerSession: resolveInheritedTokenLimit({
        configured: effectiveAgent.limits?.maxInputTokensPerSession,
        inherited: input.inheritedLimits?.maxInputTokensPerSession,
      }),
      maxOutputTokensPerSession: resolveInheritedTokenLimit({
        configured: effectiveAgent.limits?.maxOutputTokensPerSession,
        inherited: input.inheritedLimits?.maxOutputTokensPerSession,
      }),
      maxTokenCostUsdPerSession: resolveInheritedTokenLimit({
        configured: effectiveAgent.limits?.maxTokenCostUsdPerSession,
        inherited: input.inheritedLimits?.maxTokenCostUsdPerSession,
      }),
    },
    outputSchema: input.outputSchema,
    rootSessionId: input.rootSessionId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    turnAgent: effectiveAgent.turnAgent,
  });

  const initialSession = preparedSeed
    ? setHarnessEmissionState(
        {
          ...session,
          history: [...(transcriptFork ? [] : session.history), ...preparedSeed.history],
        },
        { sessionStarted: false, sequence: 0, stepIndex: 0, turnId: "" },
      )
    : input.fork && "beforeTurnId" in input.fork
      ? restoreSessionCheckpoint({
          target: { ...session, history: [] },
          checkpoint: await readSessionCheckpoint(input.fork),
        })
      : session;
  const registered = getResolvedRuntimeAgentNode(bundle.graph, input.nodeId).sandboxRegistry
    .sandbox;
  const definition = registered.inheritance?.definition ?? registered.definition;
  const localSandboxIdentity = process.env.VERCEL
    ? undefined
    : await recordLocalSessionSandboxIdentity({
        appRoot:
          getRuntimeCompiledArtifactsSandboxAppRoot(bundle.compiledArtifactsSource) ??
          process.cwd(),
        backendName: definition.backend.name,
        sessionId: input.sessionId,
      });
  if (input.identityWritable) {
    const writer = input.identityWritable.getWriter();
    try {
      await writer.write({
        version: 1,
        snapshotVersion: 2,
        sessionId: input.sessionId,
        local: localSandboxIdentity ?? null,
      });
    } finally {
      writer.releaseLock();
    }
  }
  return {
    state: createDurableSessionState({
      session: {
        ...(input.seed?.attachments === "channel" || transcriptFork
          ? markSeedAttachmentsPending(initialSession)
          : initialSession),
        localSandboxIdentity,
      },
    }),
  };
}

/** Restores the display prefix in a discoverable native workflow step. */
export async function restoreSessionHistoryStep(input: {
  readonly fork: SessionForkReference;
  readonly writable: WritableStream<Uint8Array>;
}): Promise<void> {
  "use step";

  await restoreSessionHistory(input);
}

/** Emits only seeded display and idle lifecycle; never dispatches a model or tool. */
export async function emitSessionTranscriptSeedStep(input: {
  readonly seed: SessionTranscriptSeed;
  readonly continuationToken: string;
  readonly writable: WritableStream<Uint8Array>;
}): Promise<void> {
  "use step";
  const prepared = prepareSessionTranscriptSeed(input.seed);
  const writer = input.writable.getWriter();
  try {
    for (const event of [
      { type: "history.seeded" as const, data: { messages: prepared.messages } },
      createSessionWaitingEvent(input.continuationToken),
    ]) {
      await writer.write(encodeMessageStreamEvent(stampMessageStreamEvent(event)));
    }
  } finally {
    writer.releaseLock();
  }
}
