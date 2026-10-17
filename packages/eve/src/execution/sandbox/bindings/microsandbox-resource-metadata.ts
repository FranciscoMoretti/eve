import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import {
  readSessionMetadata,
  writeSessionMetadata,
  type MicrosandboxResourceFact,
  type MicrosandboxResourceMetadata,
  type MicrosandboxSessionMetadata,
} from "#execution/sandbox/bindings/microsandbox-metadata.js";

const MAX_RESOURCE_FACTS = 4_096;

/** These locks fence one local cache only. They are never expired or stolen. */
export async function withMicrosandboxSessionLock<T>(
  providerRoot: string,
  sessionId: string,
  action: (authority: string, retired: boolean) => Promise<T>,
): Promise<T> {
  if (process.env.MSB_BACKEND !== "local") {
    throw new Error("Microsandbox resource accounting requires explicit MSB_BACKEND=local.");
  }
  await mkdir(providerRoot, { recursive: true });
  const authority = await realpath(providerRoot);
  const msbHome = process.env.MSB_HOME;
  if (msbHome !== undefined && !isAbsolute(msbHome)) {
    throw new Error("Microsandbox resource accounting requires an absolute MSB_HOME.");
  }
  const backendAuthority = JSON.stringify({
    authority,
    home: await realpath(homedir()),
    msbHome: msbHome === undefined ? null : await realpath(msbHome),
  });
  const binding = join(authority, "resource-authority.json");
  await writeFile(binding, backendAuthority, { flag: "wx", mode: 0o600 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  if ((await readFile(binding, "utf8")) !== backendAuthority)
    throw new Error("Microsandbox local backend authority changed.");
  const key = createHash("sha256").update(sessionId).digest("hex");
  const control = join(authority, "session-control");
  await mkdir(control, { recursive: true });
  const lock = join(control, `${key}.lock`);
  // A crash leaves the lock for explicit review. Absence of an SDK resource
  // cannot prove that an interrupted allocation will never complete later.
  await mkdir(lock);
  try {
    const marker = await readFile(join(control, `${key}.retired`), "utf8").catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (marker !== undefined && marker !== JSON.stringify({ authority, sessionId })) {
      throw new Error("Microsandbox retirement authority mismatch.");
    }
    return await action(authority, marker !== undefined);
  } finally {
    await rm(lock, { recursive: true });
  }
}

export async function retireMicrosandboxResourceOwner(
  providerRoot: string,
  sessionId: string,
): Promise<void> {
  await withMicrosandboxSessionLock(providerRoot, sessionId, async (authority) => {
    const key = createHash("sha256").update(sessionId).digest("hex");
    await writeFile(
      join(authority, "session-control", `${key}.retired`),
      JSON.stringify({ authority, sessionId }),
      { mode: 0o600 },
    );
  });
}

function providerRootForMetadata(path: string): string {
  return dirname(dirname(dirname(path)));
}

function requireResources(
  metadata: MicrosandboxSessionMetadata | null,
  authority: string,
  sessionId: string,
): MicrosandboxResourceMetadata {
  const resources = metadata?.resources;
  if (
    resources === undefined ||
    resources.authority !== authority ||
    resources.sessionId !== sessionId
  ) {
    throw new Error("Microsandbox resource ownership is unavailable for this cache.");
  }
  return resources;
}

export async function initializeMicrosandboxResourceMetadata(input: {
  readonly path: string;
  readonly sessionId: string;
  readonly metadata: MicrosandboxSessionMetadata;
  readonly borrowedForkSnapshot?: string;
}): Promise<void> {
  await withMicrosandboxSessionLock(
    providerRootForMetadata(input.path),
    input.sessionId,
    async (authority, retired) => {
      if (retired) throw new Error("Microsandbox session resources are retired.");
      const existing = await readSessionMetadata(input.path);
      if (existing !== null) {
        const resources = requireResources(existing, authority, input.sessionId);
        if (resources.borrowedForkSnapshot !== input.borrowedForkSnapshot) {
          throw new Error("Microsandbox retained artifact changed.");
        }
        return;
      }
      const occupied = await stat(input.path).then(
        () => true,
        (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        },
      );
      if (occupied) throw new Error("Unrecognized microsandbox session metadata.");
      await writeSessionMetadata(input.path, {
        ...input.metadata,
        resources: {
          version: 1,
          authority,
          sessionId: input.sessionId,
          borrowedForkSnapshot: input.borrowedForkSnapshot,
          entries: [],
        },
      });
    },
  );
}

export async function updateMicrosandboxMaterialization(
  path: string,
  sessionId: string,
  materialization: MicrosandboxSessionMetadata,
): Promise<void> {
  await withMicrosandboxSessionLock(
    providerRootForMetadata(path),
    sessionId,
    async (authority, retired) => {
      if (retired) throw new Error("Microsandbox session resources are retired.");
      const resources = requireResources(await readSessionMetadata(path), authority, sessionId);
      await writeSessionMetadata(path, { ...materialization, resources });
    },
  );
}

/** Registers the exact native name before I/O; only successful I/O advances the fact. */
export async function withMicrosandboxResourceOperation<T>(input: {
  readonly path: string;
  readonly sessionId: string;
  readonly resource: Readonly<Pick<MicrosandboxResourceFact, "kind" | "name">>;
  readonly operation: "allocate" | "remove";
  readonly run: (previouslyLive: boolean) => Promise<T>;
}): Promise<T> {
  const pending = input.operation === "allocate" ? "allocating" : "removing";
  const matches = (entry: MicrosandboxResourceFact) =>
    entry.kind === input.resource.kind && entry.name === input.resource.name;
  const previouslyLive = await withMicrosandboxSessionLock(
    providerRootForMetadata(input.path),
    input.sessionId,
    async (authority, retired) => {
      if (retired && input.operation === "allocate")
        throw new Error("Microsandbox session resources are retired.");
      const metadata = await readSessionMetadata(input.path);
      const resources = requireResources(metadata, authority, input.sessionId);
      const existing = resources.entries.find(matches);
      if (existing?.phase === "allocating")
        throw new Error("Microsandbox allocation remains unknown.");
      if (input.operation === "remove" && existing === undefined)
        throw new Error("Microsandbox resource is not owned.");
      if (input.operation === "allocate" && existing !== undefined && existing.phase !== "live")
        throw new Error("Microsandbox resource cannot be allocated again.");
      if (resources.entries.length >= MAX_RESOURCE_FACTS && existing === undefined)
        throw new Error("Microsandbox resource inventory limit exceeded.");
      if (metadata === null) throw new Error("Microsandbox metadata disappeared.");
      await writeSessionMetadata(input.path, {
        ...metadata,
        resources: {
          ...resources,
          entries: [
            ...resources.entries.filter((entry) => !matches(entry)),
            { ...input.resource, phase: pending },
          ],
        },
      });
      return existing?.phase === "live";
    },
  );
  const result = await input.run(previouslyLive);
  await withMicrosandboxSessionLock(
    providerRootForMetadata(input.path),
    input.sessionId,
    async (authority) => {
      const metadata = await readSessionMetadata(input.path);
      const resources = requireResources(metadata, authority, input.sessionId);
      if (metadata === null || resources.entries.find(matches)?.phase !== pending)
        throw new Error("Microsandbox operation identity changed.");
      await writeSessionMetadata(input.path, {
        ...metadata,
        resources: {
          ...resources,
          entries: resources.entries.map((entry) =>
            matches(entry)
              ? { ...entry, phase: input.operation === "allocate" ? "live" : "removed" }
              : entry,
          ),
        },
      });
    },
  );
  return result;
}
