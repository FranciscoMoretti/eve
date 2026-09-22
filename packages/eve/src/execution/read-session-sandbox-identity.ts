import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getRun } from "#internal/workflow/runtime.js";
import {
  SESSION_SANDBOX_IDENTITY_NAMESPACE,
  SESSION_SANDBOX_IDENTITY_SNAPSHOT_VERSION,
  type SessionSandboxIdentityReceipt,
} from "#execution/session-sandbox-identity-contract.js";

type LocalIdentity = NonNullable<SessionSandboxIdentityReceipt["local"]>;
const MAX_RECEIPTS = 100;
const READ_TIMEOUT_MS = 10_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocalReceipt(value: unknown, sessionId: string): LocalIdentity {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.sessionId !== sessionId ||
    value.snapshotVersion !== SESSION_SANDBOX_IDENTITY_SNAPSHOT_VERSION
  ) {
    throw new Error("Invalid sandbox birth receipt identity or version.");
  }
  const local = value.local;
  if (
    !record(local) ||
    local.version !== 1 ||
    local.sessionId !== sessionId ||
    typeof local.appRoot !== "string" ||
    !isAbsolute(local.appRoot) ||
    local.appRoot.includes("\0") ||
    typeof local.backendName !== "string" ||
    !local.backendName.trim()
  ) {
    throw new Error("Sandbox birth receipt does not certify a local provider.");
  }
  return { version: 1, sessionId, appRoot: local.appRoot, backendName: local.backendName };
}

/**
 * Read a finite native birth-evidence prefix. Authorize the session first and hold
 * native writer fences when using this evidence for deletion. This does not prove
 * filesystem ownership, descendant coverage, or resource retirement on its own.
 */
export async function readSessionSandboxIdentity(sessionId: string): Promise<LocalIdentity> {
  const stream = getRun(sessionId).getReadable<unknown>({
    namespace: SESSION_SANDBOX_IDENTITY_NAMESPACE,
  });
  const reader = stream.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const read = async (): Promise<LocalIdentity> => {
    const tail = await stream.getTailIndex();
    if (!Number.isSafeInteger(tail) || tail < -1 || tail >= MAX_RECEIPTS) {
      throw new Error("Sandbox birth receipt scan limit or index is invalid.");
    }
    let found: LocalIdentity | undefined;
    for (let index = 0; index <= tail; index++) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Sandbox birth receipt stream ended unexpectedly.");
      const local = parseLocalReceipt(value, sessionId);
      if (found && !isDeepStrictEqual(found, local))
        throw new Error("Conflicting sandbox birth receipts.");
      found = local;
    }
    if (!found) throw new Error("Sandbox birth receipt was not found.");
    return found;
  };
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Sandbox birth receipt read timed out.")),
          READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    void reader.cancel().catch(() => {
      /* Cleanup must not block a timed-out read. */
    });
    reader.releaseLock();
  }
}
