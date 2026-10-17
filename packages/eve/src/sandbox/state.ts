import type { SandboxSession } from "#public/definitions/sandbox.js";
import type { SandboxEnvironmentIdentity } from "#shared/sandbox-environment.js";
import type { SandboxDeleteOptions, SandboxPreparedArtifact } from "#shared/sandbox-provider.js";

export type SandboxSessionEndReason = "completed" | "expired" | "failed";

export interface SandboxSessionState {
  readonly providerName: string;
  readonly state: SandboxPreparedArtifact;
  readonly stateProtocolVersion: number;
}

export interface SandboxState {
  readonly session: SandboxSessionState | null;
  readonly fork?: SandboxForkSnapshot;
}

export interface SandboxForkSnapshot {
  readonly providerName: string;
  readonly stateProtocolVersion: number;
  readonly artifact: SandboxPreparedArtifact;
}

export interface SandboxAccess {
  readonly environment?: SandboxEnvironmentIdentity;
  captureState(): Promise<SandboxState>;
  captureFork?(checkpointKey: string): Promise<SandboxForkSnapshot | null>;
  delete?(options?: SandboxDeleteOptions): Promise<void>;
  get(): Promise<SandboxSession | null>;
  stop(): Promise<void>;
}
