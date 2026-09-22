import { BoundaryHookError } from "#shared/boundary-hook-error.js";
import { getAdapterKind } from "#channel/adapter.js";
import { createHookResultEvent } from "#context/hook-result.js";
import type { HookResultStreamEvent, MessageStreamEvent } from "#protocol/message.js";
import type { HookContext } from "#public/definitions/hook.js";
import type { RuntimeHookRegistry } from "#runtime/hooks/registry.js";
import { buildCallbackContext } from "#context/build-callback-context.js";
import type { ContextContainer } from "./container.js";
import { BundleKey, ChannelKey } from "#runtime/sessions/runtime-context-keys.js";
import { ContinuationTokenKey } from "./keys.js";

/**
 * Fans one runtime stream event out to every matching subscriber.
 * Errors propagate — harness error paths convert them into the
 * recoverable `turn.failed` cascade. Caller must hold an active ALS
 * scope so hooks see the same context as the rest of the step.
 */
export async function dispatchStreamEventHooks(input: {
  readonly ctx: ContextContainer;
  readonly registry: RuntimeHookRegistry;
  readonly event: MessageStreamEvent;
  readonly emitResult?: (event: HookResultStreamEvent) => Promise<void>;
}): Promise<void> {
  const typed = input.registry.streamEventsByType.get(input.event.type) ?? [];
  const wildcard = input.registry.streamEventsWildcard;

  if (typed.length === 0 && wildcard.length === 0) {
    return;
  }

  const hookCtx = buildHookContext(input.ctx);
  try {
    for (const entry of [...typed, ...wildcard]) {
      const result = await entry.handler(input.event, hookCtx);
      if (result === undefined) continue;
      if (input.event.type !== "turn.completed") {
        throw new Error(`Hook "${entry.slug}" may return a result only for turn.completed.`);
      }
      const event = createHookResultEvent(entry.slug, input.event.data.turnId, result);
      if (event === undefined) continue;
      if (input.emitResult === undefined)
        throw new Error("Hook results require a durable event emitter.");
      await input.emitResult(event);
    }
  } catch (error) {
    if (input.event.type === "turn.started" || input.event.type === "step.started") {
      throw new BoundaryHookError(error);
    }
    throw error;
  }
}

/** Builds the {@link HookContext} surfaced to one handler. */
function buildHookContext(ctx: ContextContainer): HookContext {
  const bundle = ctx.require(BundleKey);
  const channelAdapter = ctx.get(ChannelKey);
  const continuationToken = ctx.get(ContinuationTokenKey);
  const kind = channelAdapter !== undefined ? getAdapterKind(channelAdapter) : undefined;
  const callbackCtx = buildCallbackContext();

  return {
    ...callbackCtx,
    agent: {
      name: bundle.turnAgent.id,
      nodeId: bundle.nodeId,
    },
    channel: {
      kind,
      continuationToken,
    },
  };
}
