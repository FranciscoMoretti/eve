import { mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  recordLocalSessionSandboxIdentity,
  assertLocalSessionSandboxIdentity,
} from "./local-session-identity.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "eve-birth-"));
  roots.push(path);
  return path;
}

it("publishes one complete immutable identity across concurrent creation and retries", async () => {
  const appRoot = await root();
  const input = { appRoot, backendName: "microsandbox", sessionId: "session-original" };
  const records = await Promise.all(
    Array.from({ length: 12 }, () => recordLocalSessionSandboxIdentity(input)),
  );
  expect(records.every((record) => JSON.stringify(record) === JSON.stringify(records[0]))).toBe(
    true,
  );
  const directory = join(appRoot, ".eve", "sandbox-identities");
  const files = await readdir(directory);
  expect(files).toHaveLength(1);
  expect(JSON.parse(await readFile(join(directory, files[0]!), "utf8"))).toEqual(records[0]);
  await expect(
    recordLocalSessionSandboxIdentity({ ...input, backendName: "vercel" }),
  ).rejects.toThrow("identity changed");
  expect(JSON.parse(await readFile(join(directory, files[0]!), "utf8"))).toEqual(records[0]);
});

it("canonicalizes aliases and rejects root/provider drift while leaving legacy identity absent", async () => {
  const appRoot = await root();
  const other = await root();
  const alias = join(other, "alias");
  await symlink(appRoot, alias);
  const identity = await recordLocalSessionSandboxIdentity({
    appRoot: alias,
    backendName: "microsandbox",
    sessionId: "native",
  });
  expect(identity.appRoot).toBe(await realpath(appRoot));
  await expect(
    assertLocalSessionSandboxIdentity(identity, { appRoot: alias, backendName: "microsandbox" }),
  ).resolves.toBeUndefined();
  await expect(
    assertLocalSessionSandboxIdentity(identity, { appRoot: other, backendName: "microsandbox" }),
  ).rejects.toThrow("worker root changed");
  await expect(
    assertLocalSessionSandboxIdentity(identity, { appRoot, backendName: "docker" }),
  ).rejects.toThrow("provider or worker root changed");
  await expect(
    assertLocalSessionSandboxIdentity(undefined, { appRoot, backendName: "docker" }),
  ).resolves.toBeUndefined();
});
