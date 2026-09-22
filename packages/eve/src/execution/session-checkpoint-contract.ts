import type { DurableSessionSnapshot } from "#execution/durable-session-store.js";

export const SESSION_CHECKPOINT_WRITER_KEY = "eve.sessionCheckpointWriter";
export const SESSION_CHECKPOINT_NAMESPACE = "eve.checkpoints";

export interface SessionTurnForkReference {
  readonly sessionId: string;
  readonly beforeTurnId: string;
  readonly checkpointId?: string;
}

export interface SessionTranscriptForkReference {
  readonly sessionId: string;
  readonly beforeMessageId: string;
}

export type SessionForkReference = SessionTurnForkReference | SessionTranscriptForkReference;

export interface SessionCheckpoint extends SessionTurnForkReference {
  readonly version: 1;
  readonly snapshot: DurableSessionSnapshot & { readonly version: 2 };
  readonly rejected?: "source_not_idle" | "source_advanced";
}
