import { createHash } from "node:crypto";
import type { RunInput } from "#channel/types.js";
import { sessionInboxHookToken } from "#execution/session-inbox/address.js";

/** Stable intent excludes transport traces and authenticated credential metadata. */
export function creationIntent(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
  return createHash("sha256")
    .update(serialized ?? "null")
    .digest("hex");
}

/** This envelope is built from server-resolved identity, never request attributes. */
export function createSessionCreationAttributes(input: {
  run: RunInput;
  agentId: string;
  namespace: string;
}): Record<string, string> {
  const { run } = input;
  if (!run.continuationToken) throw new Error("A candidate requires a continuation identity.");
  const principal = run.auth;
  const key = creationIntent([
    "eve:creation:v1",
    input.namespace,
    input.agentId,
    run.channelName ?? null,
    principal?.authenticator ?? null,
    principal?.issuer ?? null,
    principal?.principalType ?? "anonymous",
    principal?.principalId ?? null,
    run.continuationToken,
  ]);
  const intent =
    run.creationIntent ??
    creationIntent({
      input: run.input,
      seed: run.seed,
      fork: run.fork,
      mode: run.mode,
      capabilities: run.capabilities,
      callback: run.callback,
      taskId: run.taskId,
    });
  const attributes: Record<string, string> = {
    "$eve.creation.key": `eve:v1:${key}`,
    "$eve.creation.intent": intent,
    "$eve.creation.role": "session",
    "$eve.creation.claim_token": sessionInboxHookToken(run.continuationToken),
  };
  if (run.fork) attributes["$eve.creation.source_run"] = run.fork.sessionId;
  return attributes;
}
