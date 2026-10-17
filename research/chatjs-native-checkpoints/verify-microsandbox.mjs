import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createMicrosandboxSandboxProvider } from "../../packages/eve/dist/src/execution/sandbox/bindings/microsandbox.js";
const require = createRequire(new URL("../../packages/eve/package.json", import.meta.url));
const { Snapshot } = await import(require.resolve("microsandbox"));
if (process.env.MSB_BACKEND !== "local")
  throw new Error("This verification requires MSB_BACKEND=local.");
const storagePath = await mkdtemp(join(tmpdir(), "eve-native-fork-"));
const host = {
  resolveProjectPath: (p) => p,
  loadOptionalPackage: async (input) => await input.importModule(),
};
const provider = createMicrosandboxSandboxProvider({
  image: "debian:bookworm-slim",
  memoryMiB: 256,
  setup: { autoInstall: false },
});
const context = (id) => ({
  host,
  storagePath,
  session: { id, auth: { current: null, initiator: null }, turn: { id: "turn_0", sequence: 0 } },
});
const id = "eve-fork-probe-" + Date.now();
let source, target, artifact, snapshot;
try {
  artifact = await provider.prepare({
    host,
    storagePath,
    sourceRevision: id,
    resources: { source: { kind: "none" } },
    files: {
      list: async () => [],
      read: async () => {
        throw Object.assign(Error("File not found"), { code: "ENOENT" });
      },
      readText: async () => {
        throw Object.assign(Error("File not found"), { code: "ENOENT" });
      },
    },
    log: console.log,
  });
  source = await provider.start(context(id + "-source"), undefined, artifact);
  await source.handle.sandbox.writeTextFile({ path: "copy.txt", content: "original" });
  snapshot = await provider.fork.capture(source.handle, "boundary-1");
  assert.deepEqual(await provider.fork.capture(source.handle, "boundary-1"), snapshot);
  await source.handle.sandbox.writeTextFile({ path: "copy.txt", content: "source changed" });
  target = await provider.fork.restore(context(id + "-target"), undefined, artifact, snapshot);
  assert.notEqual(target.state.sessionIdentity, source.state.sessionIdentity);
  assert.equal(await target.handle.sandbox.readTextFile({ path: "copy.txt" }), "original");
  await target.handle.onSandboxStop();
  target = {
    ...target,
    handle: await provider.resume(context(id + "-target"), artifact, target.state),
  };
  assert.equal(await target.handle.sandbox.readTextFile({ path: "copy.txt" }), "original");
  await target.handle.sandbox.writeTextFile({ path: "copy.txt", content: "destination changed" });
  assert.equal(await source.handle.sandbox.readTextFile({ path: "copy.txt" }), "source changed");
  await source.handle.onSandboxDelete();
  source = undefined;
  assert.equal(
    await target.handle.sandbox.readTextFile({ path: "copy.txt" }),
    "destination changed",
  );
  await target.handle.onSandboxDelete();
  target = undefined;
  assert.ok(await Snapshot.get(snapshot.snapshotName));
  target = await provider.fork.restore(
    context(id + "-after-cleanup"),
    undefined,
    artifact,
    snapshot,
  );
  assert.equal(await target.handle.sandbox.readTextFile({ path: "copy.txt" }), "original");
  console.log(
    "PASS: native capture, source reconnect, idempotent snapshot, fresh destination, destination resume, source-cleanup isolation, independent snapshot retention",
  );
} finally {
  await source?.handle.onSandboxDelete();
  await target?.handle.onSandboxDelete();
  if (snapshot) await Snapshot.remove(snapshot.snapshotName);
  if (artifact) await Snapshot.remove(artifact.snapshotName);
  await rm(storagePath, { recursive: true, force: true });
}
