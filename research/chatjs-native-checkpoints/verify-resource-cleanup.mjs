import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, realpath, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const base = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../packages/eve/package.json", import.meta.url));
const sdkRoot = dirname(dirname(require.resolve("microsandbox")));
if (process.env.MSB_BACKEND !== "local") throw Error("Disposable proof requires MSB_BACKEND=local");
const sdk = await import(sdkRoot + "/dist/index.js");
const { createMicrosandboxSandboxProvider } = await import(
  base + "/packages/eve/dist/src/execution/sandbox/bindings/microsandbox.js"
);
const { manageLocalMicrosandboxResources: manage } = await import(
  base + "/packages/eve/dist/src/execution/sandbox/bindings/microsandbox-resource-cleanup.js"
);
const { attachLocalSandboxAppRoot } = await import(
  base + "/packages/eve/dist/src/internal/nitro/routes/channel-route-context.js"
);
const appRoot = await realpath(await mkdtemp("/tmp/eve080-resource-actual-"));
await mkdir(join(appRoot, "node_modules"));
await symlink(sdkRoot, join(appRoot, "node_modules/microsandbox"));
const storagePath = join(appRoot, ".eve/sandbox-cache");
const route = {};
attachLocalSandboxAppRoot(route, appRoot);
const id = "resource-" + randomUUID();
console.log(JSON.stringify({ appRoot, id, status: "started" }));
const host = { resolveProjectPath: (p) => join(appRoot, p), loadOptionalPackage: async () => sdk };
const context = (sessionId) => ({
  host,
  storagePath,
  session: {
    id: sessionId,
    auth: { current: null, initiator: null },
    turn: { id: "turn_0", sequence: 0 },
  },
});
const control = (sessionId, action, releaseForkSnapshots = false) =>
  manage(route, { sessionId, expectedAppRoot: appRoot, action, releaseForkSnapshots });
const provider = createMicrosandboxSandboxProvider({
  image: "debian:bookworm-slim",
  memoryMiB: 256,
  setup: { autoInstall: false },
});
const artifact = await provider.prepare({
  host,
  storagePath,
  sourceRevision: id,
  resources: { source: { kind: "none" } },
  files: {
    list: async () => [],
    read: async () => {
      throw Object.assign(Error("no files"), { code: "ENOENT" });
    },
    readText: async () => {
      throw Object.assign(Error("no files"), { code: "ENOENT" });
    },
  },
});
let source, child, checkpoint, ownedReplacementVm, ownedReplacementSnapshot;
try {
  await assert.rejects(
    manage(route, { sessionId: id + "-wrong", expectedAppRoot: "/tmp/wrong", action: "retire" }),
    /authority mismatch/,
  );
  await control(id + "-early", "retire");
  await assert.rejects(provider.start(context(id + "-early"), undefined, artifact), /retired/);
  console.log("PASS worker authority mismatch and retirement before first allocation");
  source = await provider.start(context(id + "-source"), undefined, artifact);
  await source.handle.sandbox.writeTextFile({ path: "retained.txt", content: "boundary" });
  checkpoint = await provider.fork.capture(source.handle, "checkpoint");
  assert.deepEqual(await provider.fork.capture(source.handle, "checkpoint"), checkpoint);
  child = await provider.fork.restore(context(id + "-child"), undefined, artifact, checkpoint);
  assert.equal(await child.handle.sandbox.readTextFile({ path: "retained.txt" }), "boundary");
  await control(id + "-source", "retire");
  assert.equal((await control(id + "-source", "purge")).remaining, 1);
  source = undefined;
  assert.equal((await control(id + "-source", "purge", true)).remaining, 1);
  assert.equal(await child.handle.sandbox.readTextFile({ path: "retained.txt" }), "boundary");
  await assert.rejects(provider.start(context(id + "-source"), undefined, artifact), /retired/);
  console.log("PASS actual VM removal preserves live child and retained immutable snapshot");
  await control(id + "-child", "retire");
  assert.equal((await control(id + "-child", "purge")).remaining, 0);
  child = undefined;
  const originalRemove = sdk.Snapshot.remove;
  sdk.Snapshot.remove = async () => {
    throw Error("fixture removal transport failure");
  };
  await assert.rejects(control(id + "-source", "purge", true), /fixture removal/);
  sdk.Snapshot.remove = originalRemove;
  assert.ok(await sdk.Snapshot.get(checkpoint.snapshotName));
  const directory = join(storagePath, "microsandbox/sessions");
  const metadata = await Promise.all(
    (await readdir(directory)).map(async (name) =>
      JSON.parse(await readFile(join(directory, name, "metadata.json"), "utf8")),
    ),
  );
  assert.equal(
    metadata
      .find((m) => m.resources.sessionId === id + "-source")
      .resources.entries.find((e) => e.name === checkpoint.snapshotName).phase,
    "removing",
  );
  assert.equal((await control(id + "-source", "purge", true)).remaining, 0);
  assert.ok(!(await sdk.Snapshot.list()).some((s) => s.name === checkpoint.snapshotName));
  checkpoint = undefined;
  console.log("PASS failed actual snapshot removal stays pending; retry confirms provider absence");
  const replacedSession = id + "-replacement";
  const original = await provider.start(context(replacedSession), undefined, artifact);
  await original.handle.sandbox.writeTextFile({ path: "identity.txt", content: "original" });
  const originalCheckpoint = await provider.fork.capture(original.handle, "identity");
  const originalSnapshot = await sdk.Snapshot.get(originalCheckpoint.snapshotName);
  await original.handle.sandbox.writeTextFile({ path: "identity.txt", content: "replacement" });
  await original.handle.onRuntimeShutdown();
  const originalMetadata = JSON.parse(
    await readFile(
      join(storagePath, "microsandbox/sessions", original.state.sessionIdentity, "metadata.json"),
      "utf8",
    ),
  );
  const originalVm = await sdk.Sandbox.get(originalMetadata.sandboxName);
  await originalVm.stopWithTimeout(10000);
  await sdk.Snapshot.remove(originalSnapshot.digest);
  const replacementSnapshot = await sdk.Snapshot.builder(originalCheckpoint.snapshotName)
    .fromSandbox(originalMetadata.sandboxName)
    .create();
  ownedReplacementSnapshot = replacementSnapshot;
  const replacedCopy = id + "-replacement-copy";
  await assert.rejects(
    provider.fork.restore(context(replacedCopy), undefined, artifact, originalCheckpoint),
    /template|snapshot|provisioned/i,
  );
  await control(replacedCopy, "retire");
  assert.notEqual(replacementSnapshot.digest, originalSnapshot.digest);
  await originalVm.remove();
  const replacementVm = await sdk.Sandbox.builder(originalMetadata.sandboxName)
    .fromSnapshot(artifact.snapshotName)
    .memory(256)
    .detached(true)
    .create();
  ownedReplacementVm = replacementVm;
  assert.notEqual(replacementVm.id, originalVm.id);
  await control(replacedSession, "retire");
  await assert.rejects(control(replacedSession, "purge", false), /VM was replaced/);
  assert.equal((await sdk.Sandbox.get(originalMetadata.sandboxName)).id, replacementVm.id);
  await replacementVm.stop();
  await replacementVm.detach();
  const replacementHandle = await sdk.Sandbox.get(originalMetadata.sandboxName);
  await replacementHandle.stopWithTimeout(10000);
  await replacementHandle.remove();
  ownedReplacementVm = undefined;
  try {
    await control(replacedSession, "purge", true);
  } catch (error) {
    assert.match(error.message, /snapshot was replaced/);
  }
  assert.equal(
    (await sdk.Snapshot.get(originalCheckpoint.snapshotName)).digest,
    replacementSnapshot.digest,
  );
  await sdk.Snapshot.remove(replacementSnapshot.digest);
  ownedReplacementSnapshot = undefined;
  assert.equal((await control(replacedSession, "purge", true)).remaining, 0);
  console.log(
    "PASS stable VM ID and snapshot digest protect cleanup and immutable restore from replacements reusing owned names",
  );
  const originalBuilder = sdk.Sandbox.builder;
  const entered = Promise.withResolvers(),
    finish = Promise.withResolvers();
  let allocatedVm;
  sdk.Sandbox.builder = function (name) {
    const builder = originalBuilder.call(this, name);
    const originalCreate = builder.createWithPullProgress.bind(builder);
    builder.createWithPullProgress = async function () {
      entered.resolve();
      await finish.promise;
      const creation = await originalCreate();
      const awaitSandbox = creation.awaitSandbox.bind(creation);
      creation.awaitSandbox = async function () {
        allocatedVm = await awaitSandbox();
        throw Error("fixture lost allocation response");
      };
      return creation;
    };
    return builder;
  };
  const allocation = provider.start(context(id + "-uncertain"), undefined, artifact);
  const rejected = assert.rejects(allocation, /fixture lost allocation response/);
  await entered.promise;
  assert.equal((await control(id + "-uncertain", "retire")).remaining, 1);
  finish.resolve();
  await rejected;
  sdk.Sandbox.builder = originalBuilder;
  await assert.rejects(control(id + "-uncertain", "purge", true), /allocation remains unknown/);
  await assert.rejects(provider.start(context(id + "-uncertain"), undefined, artifact), /retired/);
  assert.ok(allocatedVm);
  await allocatedVm.stop();
  await allocatedVm.detach();
  const exact = (await sdk.Sandbox.list()).sandboxes.find((s) => s.name === allocatedVm.name);
  assert.ok(exact);
  await exact.stopWithTimeout(10000);
  await exact.remove();
  console.log(
    "PASS retirement during actual allocation and lost response retain unknown intent without resend",
  );
  console.log(JSON.stringify({ appRoot, id, status: "passed" }));
} finally {
  if (ownedReplacementVm !== undefined) {
    await ownedReplacementVm.stop();
    await ownedReplacementVm.detach();
    const handle = await sdk.Sandbox.get(ownedReplacementVm.name);
    assert.equal(handle.id, ownedReplacementVm.id);
    await handle.stopWithTimeout(10000);
    await handle.remove();
  }
  if (ownedReplacementSnapshot !== undefined)
    await sdk.Snapshot.remove(ownedReplacementSnapshot.digest);
  await source?.handle.onSandboxDelete();
  await child?.handle.onSandboxDelete();
  if (checkpoint) await sdk.Snapshot.remove(checkpoint.snapshotName, { force: true });
  await sdk.Snapshot.remove(artifact.snapshotName, { force: true });
}
