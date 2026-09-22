import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_FILES = 20_000;
const MAX_BYTES = 128 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;

export class LocalForkUnsupportedError extends Error {}

/** Filesystem-only snapshots: reconnect metadata and process environment are excluded. */
export async function captureLocalForkCheckpoint(input: {
  readonly checkpointsRoot: string;
  readonly filesystemRoot: string;
  readonly sessionKey: string;
  readonly checkpointKey: string;
}): Promise<Record<string, unknown> | undefined> {
  const id = createHash("sha256")
    .update(JSON.stringify([input.sessionKey, input.checkpointKey]))
    .digest("hex");
  const target = join(input.checkpointsRoot, id);
  if (!(await exists(target))) {
    try {
      await validateFilesystem(input.filesystemRoot);
    } catch (error) {
      if (error instanceof LocalForkUnsupportedError) return undefined;
      throw error;
    }
    await copyOnce(input.filesystemRoot, target);
  }
  return { version: 1, id };
}

export async function restoreLocalForkCheckpoint(input: {
  readonly checkpointsRoot: string;
  readonly targetRoot: string;
  readonly checkpoint: Record<string, unknown>;
}): Promise<void> {
  if (
    input.checkpoint.version !== 1 ||
    typeof input.checkpoint.id !== "string" ||
    !DIGEST.test(input.checkpoint.id)
  ) {
    throw new Error("Invalid local sandbox fork checkpoint.");
  }
  const source = join(input.checkpointsRoot, input.checkpoint.id);
  const canonicalRoot = await realpath(input.checkpointsRoot);
  if (dirname(await realpath(source)) !== canonicalRoot)
    throw new Error("Invalid local sandbox checkpoint path.");
  await validateFilesystem(source);
  await publishOnce(input.targetRoot, async (temporary) => {
    await mkdir(temporary, { recursive: true });
    await cp(source, join(temporary, "fs"), { recursive: true, verbatimSymlinks: true });
    await writeFile(join(temporary, "fork-checkpoint.json"), JSON.stringify(input.checkpoint));
  });
  const recorded = JSON.parse(
    await readFile(join(input.targetRoot, "fork-checkpoint.json"), "utf8"),
  );
  if (recorded.version !== 1 || recorded.id !== input.checkpoint.id)
    throw new Error("Sandbox session already has a different fork checkpoint.");
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function validateFilesystem(root: string) {
  const pending = [root];
  let entries = 1;
  let bytes = 0;
  while (pending.length) {
    const path = pending.pop();
    if (path === undefined) break;
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new LocalForkUnsupportedError(
        "Sandbox fork symlinks require backend-specific restoration.",
      );
    }
    if (info.isDirectory()) {
      const directory = await opendir(path);
      for await (const entry of directory) {
        if (++entries > MAX_FILES)
          throw new LocalForkUnsupportedError("Sandbox fork file limit exceeded.");
        pending.push(join(path, entry.name));
      }
    } else if (info.isFile()) {
      bytes += info.size;
      if (bytes > MAX_BYTES)
        throw new LocalForkUnsupportedError("Sandbox fork byte limit exceeded.");
    } else {
      throw new LocalForkUnsupportedError("Sandbox fork contains a non-file resource.");
    }
  }
}

async function copyOnce(source: string, target: string) {
  await publishOnce(target, async (temporary) => {
    await cp(source, temporary, { recursive: true, verbatimSymlinks: true });
  });
}

async function publishOnce(target: string, populate: (temporary: string) => Promise<void>) {
  if (await exists(target)) return;
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await populate(temporary);
    await rename(temporary, target);
  } catch (error) {
    if (!(await exists(target))) throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
