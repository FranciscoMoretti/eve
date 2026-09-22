import { createJustBashSandboxBackend } from "./just-bash.js";
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureLocalForkCheckpoint, restoreLocalForkCheckpoint } from "./local-fork-checkpoint.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "eve-fork-files-"));
  roots.push(root);
  const filesystemRoot = join(root, "source", "fs");
  await mkdir(join(filesystemRoot, "workspace", "attachments"), { recursive: true });
  return {
    root,
    filesystemRoot,
    checkpointsRoot: join(root, "checkpoints"),
    sessionKey: "source",
    checkpointKey: "turn_2",
  };
}

it("captures immutable binary files and restores independent sessions without source environment", async () => {
  const input = await setup();
  const file = join(input.filesystemRoot, "workspace", "attachments", "sample.pdf");
  await writeFile(file, new Uint8Array([0, 255, 10, 128]));
  await writeFile(join(input.root, "source", "metadata.json"), '{"env":{"SECRET":"source-only"}}');
  const checkpoint = await captureLocalForkCheckpoint(input);
  if (!checkpoint) throw new Error("Missing checkpoint");
  await writeFile(file, "changed later");
  expect(await captureLocalForkCheckpoint(input)).toEqual(checkpoint);
  const targetRoot = join(input.root, "branch");
  await restoreLocalForkCheckpoint({ ...input, targetRoot, checkpoint });
  const restored = join(targetRoot, "fs", "workspace", "attachments", "sample.pdf");
  expect(await readFile(restored)).toEqual(Buffer.from([0, 255, 10, 128]));
  await expect(readFile(join(targetRoot, "metadata.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await writeFile(restored, "branch change");
  await restoreLocalForkCheckpoint({ ...input, targetRoot, checkpoint });
  expect(await readFile(restored, "utf8")).toBe("branch change");
  expect(await readFile(file, "utf8")).toBe("changed later");
  const sibling = join(input.root, "sibling");
  await restoreLocalForkCheckpoint({ ...input, targetRoot: sibling, checkpoint });
  expect(await readFile(join(sibling, "fs", "workspace", "attachments", "sample.pdf"))).toEqual(
    Buffer.from([0, 255, 10, 128]),
  );
  const different = await captureLocalForkCheckpoint({ ...input, checkpointKey: "turn_3" });
  if (!different) throw new Error("Missing checkpoint");
  await expect(
    restoreLocalForkCheckpoint({ ...input, targetRoot, checkpoint: different }),
  ).rejects.toThrow("different fork checkpoint");
});

it("rejects escaping identifiers, filesystem links, and oversized snapshots", async () => {
  const input = await setup();
  await expect(
    restoreLocalForkCheckpoint({
      ...input,
      targetRoot: join(input.root, "target"),
      checkpoint: { version: 1, id: "../source" },
    }),
  ).rejects.toThrow("Invalid local");
  const link = join(input.filesystemRoot, "workspace", "link");
  await symlink(input.root, link);
  expect(await captureLocalForkCheckpoint(input)).toBeUndefined();
  await rm(link);
  const large = join(input.filesystemRoot, "workspace", "large");
  await writeFile(large, "");
  await truncate(large, 128 * 1024 * 1024 + 1);
  expect(await captureLocalForkCheckpoint(input)).toBeUndefined();
});

it("clones the real just-bash backend while keeping file mutations isolated", async () => {
  const input = await setup();
  const backend = createJustBashSandboxBackend();
  const runtimeContext = { appRoot: input.root };
  const source = await backend.create({
    runtimeContext,
    sessionKey: "source-live",
    templateKey: null,
  });
  const branchHandles = [];
  try {
    await source.session.writeTextFile({ path: "original.txt", content: "before edit" });
    const checkpoint = await source.captureForkCheckpoint?.("turn_1");
    if (!checkpoint) throw new Error("Missing fork checkpoint capability");
    await source.session.writeTextFile({ path: "original.txt", content: "after edit" });
    const branch = await backend.create({
      runtimeContext,
      sessionKey: "branch-live",
      templateKey: null,
      forkCheckpoint: checkpoint,
    });
    branchHandles.push(branch);
    expect(await branch.session.readTextFile({ path: "original.txt" })).toBe("before edit");
    await branch.session.writeTextFile({ path: "original.txt", content: "branch edit" });
    expect(await source.session.readTextFile({ path: "original.txt" })).toBe("after edit");
    const saved = await branch.captureState();
    await branch.stop();
    const resumed = await backend.create({
      runtimeContext,
      sessionKey: "branch-live",
      templateKey: null,
      existingMetadata: saved.metadata,
    });
    branchHandles.push(resumed);
    expect(await resumed.session.readTextFile({ path: "original.txt" })).toBe("branch edit");
  } finally {
    await source.shutdown();
    await Promise.all(branchHandles.map((handle) => handle.shutdown()));
  }
});

it("bounds a single wide directory before copying it", async () => {
  const input = await setup();
  for (let start = 0; start < 20_000; start += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, offset) =>
        writeFile(join(input.filesystemRoot, `file-${start + offset}`), ""),
      ),
    );
  }
  expect(await captureLocalForkCheckpoint(input)).toBeUndefined();
}, 30_000);
