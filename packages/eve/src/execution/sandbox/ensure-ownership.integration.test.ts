import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { mockSandbox } from "#internal/testing/mocks/mock-sandbox.js";
import type {
  SandboxBackend,
  SandboxBackendCreateInput,
} from "#public/definitions/sandbox-backend.js";
import {
  createBundledRuntimeCompiledArtifactsSource,
  createDiskRuntimeCompiledArtifactsSource,
  type RuntimeCompiledArtifactsSource,
} from "#runtime/compiled-artifacts-source.js";
import type { RuntimeSandboxRegistry } from "#runtime/sandbox/registry.js";
import type { ResolvedSandboxDefinition } from "#runtime/types.js";
import { ensureSandboxAccess } from "#execution/sandbox/ensure.js";
import type { SandboxState } from "#sandbox/state.js";

function createTestRegistry(
  definition: Partial<ResolvedSandboxDefinition>,
  backend: SandboxBackend,
): RuntimeSandboxRegistry {
  const resolved: ResolvedSandboxDefinition = {
    backend,
    logicalPath: "agent/sandbox/sandbox.ts",
    sourceHash: "test-source-hash",
    sourceId: "agent/sandbox/sandbox",
    sourceKind: "module",
    ...definition,
  };

  return {
    sandbox: {
      definition: resolved,
      workspaceResourceRoot: { logicalPath: "", rootEntries: [] },
    },
  };
}

function createBackend(options?: { readonly delete?: () => Promise<void> }): SandboxBackend {
  const sandbox = mockSandbox({ id: "sbx_session_auth" });
  const create = vi.fn(async (input: SandboxBackendCreateInput) => {
    return {
      captureState: async () => ({
        backendName: "test",
        metadata: {},
        sessionKey: input.sessionKey,
      }),
      delete: vi.fn(options?.delete ?? (async () => {})),
      stop: vi.fn(async () => {}),
      useSessionFn: async () => sandbox.session,
      shutdown: async () => {},
      session: sandbox.session,
    };
  });

  return { create, name: "test", prewarm: vi.fn() };
}

async function ensure(input: {
  readonly compiledArtifactsSource?: RuntimeCompiledArtifactsSource;
  readonly ownsSandbox?: boolean;
  readonly runOnSession?: (callback: () => Promise<void>) => Promise<void>;
  readonly registry: RuntimeSandboxRegistry;
  readonly state?: SandboxState;
  readonly tags?: Record<string, string>;
}) {
  return await ensureSandboxAccess({
    compiledArtifactsSource:
      input.compiledArtifactsSource ?? createBundledRuntimeCompiledArtifactsSource(),
    nodeId: "__root__",
    ownsSandbox: input.ownsSandbox,
    registry: input.registry,
    runOnSession: input.runOnSession,
    sessionId: "session_1",
    state: input.state ?? null,
    tags: input.tags,
  });
}

it("records native local sandbox ownership before provider creation and rejects reassignment", async () => {
  const appRoot = await mkdtemp(join(tmpdir(), "eve-sandbox-owner-"));
  const fake = createBackend();
  let ownerPath = "";
  let fresh = true;
  const backend = {
    ...fake,
    name: "microsandbox",
    create: vi.fn(async (input: SandboxBackendCreateInput) => {
      ownerPath = join(
        appRoot,
        ".eve",
        "sandbox-cache",
        "microsandbox",
        "sessions",
        input.sessionKey,
        "owner.json",
      );
      expect(JSON.parse(await readFile(ownerPath, "utf8"))).toEqual({
        version: 1,
        backendName: "microsandbox",
        sessionKey: input.sessionKey,
        sessionId: "session_1",
        writeAheadResources: fresh ? true : undefined,
      });
      return await fake.create(input);
    }),
  };
  const input = {
    compiledArtifactsSource: createDiskRuntimeCompiledArtifactsSource(appRoot),
    registry: createTestRegistry({}, backend),
  };
  try {
    await (await ensure(input)).get();
    await (await ensure(input)).get();
    expect(backend.create).toHaveBeenCalledTimes(2);
    // A cache that predates ownership cannot claim complete write-ahead coverage.
    await rm(ownerPath);
    fresh = false;
    await (await ensure(input)).get();
    await (await ensure(input)).get();
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    expect(owner.writeAheadResources).toBeUndefined();
    await writeFile(ownerPath, JSON.stringify({ ...owner, sessionId: "other-session" }));
    await expect((await ensure(input)).get()).rejects.toThrow("different owner");
    expect(backend.create).toHaveBeenCalledTimes(4);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
