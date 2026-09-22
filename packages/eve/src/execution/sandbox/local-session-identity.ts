import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessSession } from "#harness/types.js";

type Identity = NonNullable<HarnessSession["localSandboxIdentity"]>;

/** Local evidence is written at session birth, never inferred from a first-use cache. */
export async function recordLocalSessionSandboxIdentity(input: {
  appRoot: string;
  backendName: string;
  sessionId: string;
}): Promise<Identity> {
  const identity: Identity = { version: 1, ...input, appRoot: await realpath(input.appRoot) };
  const directory = join(identity.appRoot, ".eve", "sandbox-identities");
  await mkdir(directory, { recursive: true });
  const path = join(
    directory,
    `${createHash("sha256").update(input.sessionId).digest("hex")}.json`,
  );
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    try {
      await link(temporary, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const saved = JSON.parse(await readFile(path, "utf8"));
      if (
        saved.version !== 1 ||
        saved.sessionId !== identity.sessionId ||
        saved.backendName !== identity.backendName ||
        saved.appRoot !== identity.appRoot
      ) {
        throw new Error(
          "Local sandbox session identity changed. Reconcile its resources before continuing.",
        );
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return identity;
}

/** Check before provider work, including template waits that may initiate prewarming. */
export async function assertLocalSessionSandboxIdentity(
  identity: Identity | undefined,
  current: { appRoot: string; backendName: string },
): Promise<void> {
  if (identity === undefined) return;
  if (
    identity.version !== 1 ||
    identity.backendName !== current.backendName ||
    identity.appRoot !== (await realpath(current.appRoot))
  ) {
    throw new Error(
      "Local sandbox provider or worker root changed. Reconcile its resources before continuing.",
    );
  }
}
