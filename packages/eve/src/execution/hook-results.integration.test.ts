import { expect, it } from "vitest";
import { start } from "#internal/workflow/runtime.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";
import { workflowEntry } from "#execution/session/entry.js";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import { defaultMessageReducer } from "#client/message-reducer.js";
import { defineHook } from "#public/definitions/hook.js";

it("persists completion annotations before waiting and preserves them through native fork replay without model context", async () => {
  const fixture = await createTestRuntime({
    modules: [
      {
        logicalPath: "hooks/suggestions.ts",
        loadNamespace: async () => ({
          default: defineHook({
            events: {
              "turn.completed": () => ({
                responseMetadata: { items: ["annotation-only-marker"] },
                modelCalls: [
                  {
                    modelId: "auxiliary",
                    providerMetadata: {
                      gateway: { cost: "0.001", generationId: "aux-1", secret: "hidden" },
                    },
                  },
                ],
              }),
            },
          }),
        }),
      },
    ],
  });
  const context = {
    "eve.auth": null,
    "eve.bundle": { source: createBundledRuntimeCompiledArtifactsSource() },
    "eve.channel": { kind: "http", state: {} },
    "eve.mode": "conversation",
  };
  await fixture.run(async () => {
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: { message: "Hello" },
        serializedContext: context,
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      const events = await stream.nextTurn();
      const types = events.map((event) => event.type);
      expect(types.indexOf("hook.result")).toBeGreaterThan(types.indexOf("turn.completed"));
      expect(types.indexOf("session.waiting")).toBeGreaterThan(types.indexOf("hook.result"));
      const reducer = defaultMessageReducer();
      const display = events.reduce(reducer.reduce, reducer.initial());
      expect(
        display.messages.find((message) => message.role === "assistant")?.metadata?.annotations
          ?.suggestions,
      ).toEqual({ items: ["annotation-only-marker"] });
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "Again" } },
      });
      await stream.nextTurn();
      const checkpoint = await readSessionCheckpoint({
        sessionId: source.runId,
        beforeTurnId: "turn_1",
      });
      expect(JSON.stringify(checkpoint.snapshot.session.history)).not.toContain(
        "annotation-only-marker",
      );
      const branch = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: { message: "Replacement" },
          fork: { sessionId: source.runId, beforeTurnId: "turn_1" },
          serializedContext: context,
        },
      ]);
      const branchStream = captureTurnEvents(branch);
      try {
        const inherited = await branchStream.nextTurn();
        const restored = inherited.find((event) => event.type === "history.restored");
        expect(JSON.stringify(restored)).toContain("annotation-only-marker");
        expect(JSON.stringify(restored)).not.toContain("modelCalls");
      } finally {
        await runtime.dispatchSession({ sessionId: branch.runId, command: { kind: "reset" } });
        await branch.returnValue;
        branchStream.dispose();
      }
    } finally {
      await runtime.dispatchSession({ sessionId: source.runId, command: { kind: "reset" } });
      await source.returnValue;
      stream.dispose();
    }
  });
});
