import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { stopDevelopmentSandboxResources } from "#execution/sandbox/development-cleanup.js";
import {
  readSessionMetadata,
  writeSessionMetadata,
} from "#execution/sandbox/bindings/microsandbox-metadata.js";

const fixture = vi.hoisted(() => ({ path: "", snapshot: vi.fn(), remove: vi.fn() }));
vi.mock("#execution/sandbox/bindings/docker-cli.js", async (original) => {
  const actual = await original<typeof import("#execution/sandbox/bindings/docker-cli.js")>();
  return { ...actual, createDockerCli: () => ({ run: async () => ({ exitCode: 0, stdout: "" }) }) };
});
vi.mock("#execution/sandbox/bindings/microsandbox-runtime.js", async (original) => {
  const actual =
    await original<typeof import("#execution/sandbox/bindings/microsandbox-runtime.js")>();
  return {
    ...actual,
    loadMicrosandboxWithoutInstall: async () => ({
      Sandbox: {
        listWith: async () => ({
          sandboxes: [
            {
              name: "owned-vm",
              status: "running",
              configJson: JSON.stringify({
                labels: {
                  "eve.provider": "microsandbox",
                  devRunId: "dev-owned",
                  "eve.metadataPath": fixture.path,
                },
              }),
            },
          ],
        }),
      },
    }),
    stopAndSnapshotMicrosandboxSandbox: fixture.snapshot,
    removeMicrosandboxResource: fixture.remove,
    removeSnapshotIfExists: fixture.remove,
  };
});
let app = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(app, { recursive: true, force: true });
});

it("retains ownership and immutable fork receipts when development shutdown captures state", async () => {
  vi.stubEnv("MSB_BACKEND", "local");
  app = await realpath(await mkdtemp(join(tmpdir(), "eve-dev-owned-")));
  const authority = join(app, ".eve/sandbox-cache/microsandbox");
  fixture.path = join(authority, "sessions/identity/metadata.json");
  const fork = {
    kind: "fork-snapshot" as const,
    name: "retained-fork",
    phase: "live" as const,
    nativeId: "sha256:fork",
    nativePath: "/fixture/fork",
  };
  await writeSessionMetadata(fixture.path, {
    version: 2,
    optionsHash: "options",
    image: "debian:bookworm-slim",
    sandboxName: "owned-vm",
    stateSnapshotName: "old-state",
    resources: {
      version: 1,
      authority,
      sessionId: "owned",
      borrowedForkSnapshot: "parent-fork",
      entries: [
        { kind: "sandbox", name: "owned-vm", phase: "live", nativeId: "local:42" },
        {
          kind: "state-snapshot",
          name: "old-state",
          phase: "live",
          nativeId: "sha256:old",
          nativePath: "/fixture/old",
        },
        fork,
      ],
    },
  });
  fixture.snapshot.mockResolvedValue({ digest: "sha256:new", path: "/fixture/new" });
  await stopDevelopmentSandboxResources({ appRoot: app, devRunId: "dev-owned" });
  const metadata = await readSessionMetadata(fixture.path);
  expect(metadata?.resources).toMatchObject({
    authority,
    sessionId: "owned",
    borrowedForkSnapshot: "parent-fork",
  });
  expect(metadata?.resources?.entries).toContainEqual(fork);
  expect(metadata?.resources?.entries).toContainEqual({
    kind: "state-snapshot",
    name: metadata?.stateSnapshotName,
    phase: "live",
    nativeId: "sha256:new",
    nativePath: "/fixture/new",
  });
  expect(metadata?.resources?.entries.find((entry) => entry.name === "old-state")?.phase).toBe(
    "removed",
  );
  expect(metadata?.image).toBe("debian:bookworm-slim");
});
