import type { HarnessSession } from "#harness/types.js";

export const SESSION_SANDBOX_IDENTITY_SNAPSHOT_VERSION = 2;

export const SESSION_SANDBOX_IDENTITY_NAMESPACE = "eve.sandbox-identity";

/** Emitted by session creation, including hosted attempts, before any session tool work. */
export interface SessionSandboxIdentityReceipt {
  readonly version: 1;
  readonly sessionId: string;
  readonly snapshotVersion: 2;
  readonly local: HarnessSession["localSandboxIdentity"] | null;
}

/** New drivers cannot accept a creation result from a pre-identity worker. */
export function assertSessionCreationSnapshotVersion(state: {
  version: number;
  snapshot?: { version: number };
}): void {
  if (
    state.version !== SESSION_SANDBOX_IDENTITY_SNAPSHOT_VERSION ||
    state.snapshot?.version !== SESSION_SANDBOX_IDENTITY_SNAPSHOT_VERSION
  ) {
    throw new Error(
      "Session creation used an unsupported snapshot contract. Upgrade the worker before continuing.",
    );
  }
}
