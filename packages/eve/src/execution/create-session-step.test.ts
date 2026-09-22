import { describe, expect, it, vi } from "vitest";

import { getCompiledRuntimeAgentBundle } from "#runtime/sessions/compiled-agent-cache.js";
import { DEFAULT_ROOT_MAX_INPUT_TOKENS_PER_SESSION } from "#execution/session.js";
import { createSessionStep } from "#execution/create-session-step.js";
import type { RuntimeTurnAgent } from "#runtime/agent/bootstrap.js";

vi.mock("#runtime/sessions/compiled-agent-cache.js", () => ({
  getCompiledRuntimeAgentBundle: vi.fn(),
}));

vi.mock("#runtime/graph.js", () => ({
  getResolvedRuntimeAgentNode: () => ({
    sandboxRegistry: { sandbox: { definition: { backend: { name: "test" } } } },
  }),
}));
vi.mock("#execution/sandbox/local-session-identity.js", () => ({
  recordLocalSessionSandboxIdentity: vi.fn(async (identity) => ({ version: 1, ...identity })),
}));

const TestTurnAgent: RuntimeTurnAgent = {
  id: "test-agent",
  instructions: ["You are a test assistant."],
  model: { id: "test-model" },
  tools: [],
  workspaceSpec: { rootEntries: [] },
};

describe("createSessionStep", () => {
  it("preserves task ownership without injecting progress-reporting instructions", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {},
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      sessionId: "sess-child",
      taskId: "task-1",
    });

    expect(state.snapshot.session.agent.system).not.toContain("Background task updates");
    expect(state.snapshot.session.agent.system).not.toContain("task_update");
    expect(state.snapshot.session.taskId).toBe("task-1");
    expect(state.snapshot.session.state).toBeUndefined();
  });

  it("defaults root sessions to the root input token budget", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {},
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "http:test",
      sessionId: "sess-root",
    });

    expect(state.snapshot.session.limits?.maxInputTokensPerSession).toBe(
      DEFAULT_ROOT_MAX_INPUT_TOKENS_PER_SESSION,
    );
  });

  it("limits delegated subagent sessions to the inherited token budget", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {},
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      inheritedLimits: { maxInputTokensPerSession: 3_000_000, maxOutputTokensPerSession: false },
      rootSessionId: "sess-root",
      sessionId: "sess-child",
    });

    expect(state.snapshot.session.limits).toEqual({
      maxInputTokensPerSession: 3_000_000,
    });
  });

  it("leaves delegated subagent sessions uncapped with uncapped inherited axes", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {},
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      inheritedLimits: { maxInputTokensPerSession: false, maxOutputTokensPerSession: false },
      rootSessionId: "sess-root",
      sessionId: "sess-child",
    });

    expect(state.snapshot.session.limits).toEqual({});
  });

  it("caps configured child token limits at the inherited token budget", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {
          limits: { maxInputTokensPerSession: 10_000_000 },
        },
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      inheritedLimits: { maxInputTokensPerSession: 2_000_000, maxOutputTokensPerSession: false },
      rootSessionId: "sess-root",
      sessionId: "sess-child",
    });

    expect(state.snapshot.session.limits?.maxInputTokensPerSession).toBe(2_000_000);
  });

  it("caps a configured child token-cost limit at the inherited budget", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: { limits: { maxTokenCostUsdPerSession: 2 } },
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      inheritedLimits: { maxTokenCostUsdPerSession: 0.75 },
      rootSessionId: "sess-root",
      sessionId: "sess-child",
    });

    expect(state.snapshot.session.limits?.maxTokenCostUsdPerSession).toBe(0.75);
  });

  it("keeps tighter configured child token limits under inherited token budget", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {
          limits: { maxInputTokensPerSession: 1_000_000 },
        },
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      inheritedLimits: { maxInputTokensPerSession: 2_000_000, maxOutputTokensPerSession: false },
      rootSessionId: "sess-root",
      sessionId: "sess-child",
    });

    expect(state.snapshot.session.limits?.maxInputTokensPerSession).toBe(1_000_000);
  });

  it("still applies inherited token budget when configured child limit is false", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {
          limits: { maxInputTokensPerSession: false },
        },
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "subagent:test",
      inheritedLimits: { maxInputTokensPerSession: 500_000, maxOutputTokensPerSession: false },
      rootSessionId: "sess-root",
      sessionId: "sess-child",
    });

    expect(state.snapshot.session.limits?.maxInputTokensPerSession).toBe(500_000);
  });

  it("seeds session token limits from resolved agent config", async () => {
    vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
      compiledArtifactsSource: { kind: "bundled" },
      resolvedAgent: {
        config: {
          limits: {
            maxInputTokensPerSession: 200_000,
            maxOutputTokensPerSession: 20_000,
            maxTokenCostUsdPerSession: 1.5,
          },
        },
      },
      turnAgent: TestTurnAgent,
    } as never);

    const { state } = await createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "http:test",
      sessionId: "sess-root",
    });

    expect(state.snapshot.session.limits).toMatchObject({
      maxInputTokensPerSession: 200_000,
      maxOutputTokensPerSession: 20_000,
      maxTokenCostUsdPerSession: 1.5,
    });
  });
});

it("does not complete creation when publishing its native birth receipt fails", async () => {
  vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
    compiledArtifactsSource: { kind: "bundled" },
    resolvedAgent: { config: {} },
    turnAgent: TestTurnAgent,
  } as never);
  const identityWritable = new WritableStream({
    write() {
      throw new Error("identity receipt unavailable");
    },
  });
  await expect(
    createSessionStep({
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "fixture",
      sessionId: "receipt-failure",
      identityWritable,
    }),
  ).rejects.toThrow("identity receipt unavailable");
  expect(identityWritable.locked).toBe(false);
});

it("seeds only published history while retaining fresh instructions, limits and sandbox identity", async () => {
  vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
    compiledArtifactsSource: { kind: "bundled" },
    resolvedAgent: { config: {} },
    turnAgent: TestTurnAgent,
  } as never);
  const { state } = await createSessionStep({
    compiledArtifactsSource: { kind: "bundled" },
    continuationToken: "viewer-continuation",
    sessionId: "viewer-copy",
    seed: { messages: [{ role: "user", parts: [{ type: "text", text: "Published question" }] }] },
  });
  expect(state.snapshot?.session.history).toEqual([
    { role: "user", kind: "user", content: [{ type: "text", text: "Published question" }] },
  ]);
  expect(state.snapshot?.session.agent.system).toContain("You are a test assistant.");
  expect(state.snapshot?.session.sandboxState).toBeUndefined();
  expect(state.snapshot?.session.localSandboxIdentity).toMatchObject({ sessionId: "viewer-copy" });
  expect(state.snapshot?.session.continuationToken).toBe("viewer-continuation");
  expect(state.snapshot?.session.rootSessionId).toBeUndefined();
});
