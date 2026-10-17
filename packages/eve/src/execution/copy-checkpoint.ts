import type { SessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import type { SessionAuthContext } from "#channel/types.js";
import { createHash } from "node:crypto";
import { getRun } from "#internal/workflow/runtime.js";
import type { HarnessModelMessage } from "#harness/messages.js";
import type { MessageStreamEvent } from "#protocol/message.js";
import type { SandboxForkSnapshot } from "#sandbox/state.js";

export const COPY_CHECKPOINT_NAMESPACE = "eve.copy-checkpoints.v1";
export const COPY_SEED_NAMESPACE = "eve.copy-seed.v1";
const MAX_CHECKPOINT_RECORDS = 1_000;
const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;

export function copyCheckpointPrincipal(auth: SessionAuthContext | null | undefined): string {
  return auth == null
    ? ""
    : JSON.stringify([
        auth.authenticator,
        auth.issuer ?? null,
        auth.principalType,
        auth.principalId,
      ]);
}

/** Stable UUID for the exact source boundary, independent of its workflow owner. */
export function boundaryCopyCheckpointId(sessionId: string, beforeTurnId: string): string {
  const hex = createHash("sha256")
    .update(JSON.stringify(["eve.copy-boundary.v1", sessionId, beforeTurnId]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Private owner command. HTTP callers cannot supply history or provider state. */
export interface CopyCheckpointRequest {
  readonly kind: "copy-checkpoint";
  readonly checkpointId: string;
  readonly beforeTurnId: string;
  readonly principalId: string;
  readonly principalIdentity: string;
}

export type CopyCheckpointRecord = {
  readonly version: 1;
  readonly sessionId: string;
  readonly checkpointId: string;
  readonly beforeTurnId: string;
  readonly principalId: string;
  readonly principalIdentity: string;
} & (
  | { readonly rejected: "source_not_idle" | "source_advanced" | "resource_unavailable" }
  | {
      readonly history: HarnessModelMessage[];
      readonly events: MessageStreamEvent[];
      readonly sandbox: SandboxForkSnapshot | null;
      readonly seedFileDigests?: Record<string, string>;
      readonly seed?: SessionTranscriptSeed;
    }
);

export function validateCopyCheckpointRequest(value: CopyCheckpointRequest): void {
  if (
    typeof value.principalIdentity !== "string" ||
    value.principalIdentity.length === 0 ||
    value.principalIdentity.length > 4_000 ||
    !/^[a-zA-Z0-9_-]{1,200}$/u.test(value.checkpointId) ||
    !/^turn_(0|[1-9][0-9]{0,8})$/u.test(value.beforeTurnId) ||
    typeof value.principalId !== "string" ||
    value.principalId.length === 0 ||
    value.principalId.length > 1_000
  ) {
    throw new Error("Invalid copy checkpoint identity.");
  }
}

/** Reads only this generation's private records, bounded at the observed tail. */
export async function readCopyCheckpoint(
  sessionId: string,
  checkpointId: string,
  namespace:
    | typeof COPY_CHECKPOINT_NAMESPACE
    | typeof COPY_SEED_NAMESPACE = COPY_CHECKPOINT_NAMESPACE,
): Promise<CopyCheckpointRecord | undefined> {
  const stream = getRun(sessionId).getReadable<CopyCheckpointRecord>({
    namespace,
  });
  const signal = AbortSignal.timeout(10_000);
  const reader = stream.getReader();
  const deadline = Promise.withResolvers<never>();
  const cancel = () => {
    deadline.reject(signal.reason);
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const tail = await Promise.race([stream.getTailIndex(), deadline.promise]);
    if (tail >= MAX_CHECKPOINT_RECORDS) throw new Error("Copy checkpoint record limit exceeded.");
    let bytes = 0;
    let found: CopyCheckpointRecord | undefined;
    for (let index = 0; index <= tail; index++) {
      signal.throwIfAborted();
      const item = await Promise.race([reader.read(), deadline.promise]);
      if (item.done) throw new Error("Copy checkpoint history is incomplete.");
      const record = item.value;
      bytes += Buffer.byteLength(JSON.stringify(record));
      if (bytes > MAX_CHECKPOINT_BYTES || record.version !== 1 || record.sessionId !== sessionId)
        throw new Error("Invalid copy checkpoint record.");
      if (record.checkpointId !== checkpointId) continue;
      if (found !== undefined && JSON.stringify(found) !== JSON.stringify(record))
        throw new Error("Conflicting copy checkpoint records.");
      found = record;
    }
    return found;
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function writeCopyCheckpoint(
  record: CopyCheckpointRecord,
  namespace:
    | typeof COPY_CHECKPOINT_NAMESPACE
    | typeof COPY_SEED_NAMESPACE = COPY_CHECKPOINT_NAMESPACE,
): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(record)) > 8 * 1024 * 1024)
    throw new Error("Copy checkpoint is too large.");
  const writer = getRun(record.sessionId)
    .getWritable<CopyCheckpointRecord>({ namespace })
    .getWriter();
  try {
    await writer.write(record);
  } finally {
    writer.releaseLock();
  }
}
