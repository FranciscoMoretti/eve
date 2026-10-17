import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readSessionMetadata } from "#execution/sandbox/bindings/microsandbox-metadata.js";
import {
  initializeMicrosandboxResourceMetadata,
  retireMicrosandboxResourceOwner,
  updateMicrosandboxMaterialization,
  withMicrosandboxResourceOperation,
  withMicrosandboxSessionLock,
} from "#execution/sandbox/bindings/microsandbox-resource-metadata.js";

let root: string;
let path: string;
const sessionId = "owned-session";
const materialization = { version: 2 as const, optionsHash: "options", sandboxName: "exact-vm" };
const resource = { kind: "sandbox" as const, name: "exact-vm" };
beforeEach(async () => {
  vi.stubEnv("MSB_BACKEND", "local");
  root = await realpath(await mkdtemp(join(tmpdir(), "eve-resource-metadata-")));
  path = join(root, "sessions", "identity", "metadata.json");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const initialize = () =>
  initializeMicrosandboxResourceMetadata({ path, sessionId, metadata: materialization });

it("retirement before first intent prevents any later allocation registration", async () => {
  await retireMicrosandboxResourceOwner(root, sessionId);
  await expect(initialize()).rejects.toThrow("retired");
  expect(await readSessionMetadata(path)).toBeNull();
});

it("first intent is visible before provider I/O and survives retirement during allocation", async () => {
  await initialize();
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const allocating = withMicrosandboxResourceOperation({
    path,
    sessionId,
    resource,
    operation: "allocate",
    identify: async () => ({ nativeId: "native-vm-id" }),
    run: async () => {
      entered.resolve();
      await finish.promise;
    },
  });
  await entered.promise;
  expect((await readSessionMetadata(path))?.resources?.entries).toEqual([
    { ...resource, phase: "allocating" },
  ]);
  await retireMicrosandboxResourceOwner(root, sessionId);
  finish.resolve();
  await allocating;
  expect((await readSessionMetadata(path))?.resources?.entries).toEqual([
    { ...resource, phase: "live", nativeId: "native-vm-id" },
  ]);
  await expect(updateMicrosandboxMaterialization(path, sessionId, materialization)).rejects.toThrow(
    "retired",
  );
  const remove = vi.fn(async () => {});
  await withMicrosandboxResourceOperation({
    path,
    sessionId,
    resource,
    operation: "remove",
    run: remove,
  });
  expect(remove).toHaveBeenCalledOnce();
  expect((await readSessionMetadata(path))?.resources?.entries).toEqual([
    { ...resource, phase: "removed", nativeId: "native-vm-id" },
  ]);
});

it("an uncertain allocation cannot be retried or claimed removed", async () => {
  await initialize();
  const run = vi.fn(async () => {
    throw new Error("lost allocation response");
  });
  await expect(
    withMicrosandboxResourceOperation({
      path,
      sessionId,
      resource,
      operation: "allocate",
      identify: async () => ({ nativeId: "native-vm-id" }),
      run,
    }),
  ).rejects.toThrow("lost allocation");
  await expect(
    withMicrosandboxResourceOperation({
      path,
      sessionId,
      resource,
      operation: "allocate",
      identify: async () => ({ nativeId: "native-vm-id" }),
      run,
    }),
  ).rejects.toThrow("unknown");
  await expect(
    withMicrosandboxResourceOperation({ path, sessionId, resource, operation: "remove", run }),
  ).rejects.toThrow("unknown");
  expect(run).toHaveBeenCalledOnce();
});

it("failed removal remains retryable and requires the exact recorded owner and resource", async () => {
  await initialize();
  await withMicrosandboxResourceOperation({
    path,
    sessionId,
    resource,
    operation: "allocate",
    identify: async () => ({ nativeId: "native-vm-id" }),
    run: async () => {},
  });
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new Error("remove failed"))
    .mockResolvedValue(undefined);
  await expect(
    withMicrosandboxResourceOperation({
      path,
      sessionId,
      resource,
      operation: "remove",
      run: remove,
    }),
  ).rejects.toThrow("remove failed");
  expect((await readSessionMetadata(path))?.resources?.entries[0]?.phase).toBe("removing");
  await expect(
    withMicrosandboxResourceOperation({
      path,
      sessionId: "foreign",
      resource,
      operation: "remove",
      run: remove,
    }),
  ).rejects.toThrow("ownership");
  await expect(
    withMicrosandboxResourceOperation({
      path,
      sessionId,
      resource: { ...resource, name: "foreign-vm" },
      operation: "remove",
      run: remove,
    }),
  ).rejects.toThrow("not owned");
  await withMicrosandboxResourceOperation({
    path,
    sessionId,
    resource,
    operation: "remove",
    run: remove,
  });
  expect(remove).toHaveBeenCalledTimes(2);
  expect((await readSessionMetadata(path))?.resources?.entries[0]?.phase).toBe("removed");
});

it("never steals a crashed lock or treats a remote backend as locally fenced", async () => {
  const control = join(root, "session-control");
  await mkdir(control);
  const lock = join(control, `${createHash("sha256").update(sessionId).digest("hex")}.lock`);
  await mkdir(lock);
  await expect(withMicrosandboxSessionLock(root, sessionId, async () => {})).rejects.toThrow();
  expect((await stat(lock)).isDirectory()).toBe(true);
  vi.stubEnv("MSB_HOME", "relative-runtime");
  await expect(initialize()).rejects.toThrow("absolute MSB_HOME");
  vi.stubEnv("MSB_BACKEND", "remote");
  await expect(initialize()).rejects.toThrow("MSB_BACKEND=local");
});
