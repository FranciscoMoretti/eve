import { expect, it } from "vitest";
import { defineMemory } from "#public/memory/index.js";
import { createSessionHistorySeed } from "#public/transcript.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { start } from "#internal/workflow/runtime.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { workflowEntry } from "#execution/session/entry.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";
import { defaultMessageReducer } from "#client/message-reducer.js";
import type { ModelMessage } from "ai";

const context = () => ({
  "eve.auth": null,
  "eve.bundle": { source: createBundledRuntimeCompiledArtifactsSource() },
  "eve.channel": { kind: "http", state: {} },
  "eve.mode": "conversation",
});

it("captures through public memory, then edits/regenerates/branches into fresh runs without checkpoint reads or execution clones", async () => {
  const captures = new Map<string, readonly ModelMessage[]>();
  const fixture = await createTestRuntime({
    modules: [
      {
        logicalPath: "memory/branch-history.ts",
        loadNamespace: async () => ({
          default: defineMemory({
            scope: "branch-history-test",
            namespace: "branch-history-test",
            provider: {
              recall: { "turn.started": () => null },
              capture: {
                "turn.completed": (ctx) => {
                  captures.set(`${ctx.session.id}:${ctx.turn.id}`, structuredClone(ctx.messages));
                },
              },
            },
          }),
        }),
      },
    ],
  });
  await fixture.run(async () => {
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: { message: "remember first question" },
        serializedContext: context(),
      },
    ]);
    const sourceStream = captureTurnEvents(source);
    const stop = async (sessionId: string) => {
      await runtime.dispatchSession({ sessionId, command: { kind: "reset" } });
    };
    try {
      const initialEvents = await sourceStream.nextTurn();
      expect(
        initialEvents.some((event) => event.type === "turn.completed"),
        JSON.stringify(initialEvents),
      ).toBe(true);
      await expect.poll(() => [...captures.keys()]).toContain(`${source.runId}:turn_0`);
      const first = captures.get(`${source.runId}:turn_0`);
      expect(first).toBeDefined();
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "excluded second question" } },
      });
      await sourceStream.nextTurn();
      const whole = captures.get(`${source.runId}:turn_1`);
      expect(whole).toBeDefined();
      const cases = [
        { label: "edit-first", history: [], message: "replacement first question" },
        { label: "regenerate-first", history: [], message: "remember first question" },
        { label: "edit-second", history: first, message: "replacement second question" },
        { label: "regenerate-second", history: first, message: "excluded second question" },
        { label: "branch", history: whole, message: "independent followup" },
      ];
      for (const scenario of cases) {
        const imported = createSessionHistorySeed(scenario.history);
        const child = await start(workflowEntry, [
          {
            kind: "initial",
            ownerDeploymentId: "dpl_inline",
            input: {},
            seed: imported.seed,
            serializedContext: context(),
          },
        ]);
        const stream = captureTurnEvents(child);
        try {
          const idle = await stream.nextTurn();
          expect(
            idle.map((event) => event.type),
            scenario.label,
          ).toEqual(["history.seeded", "session.waiting"]);
          expect(captures.has(`${child.runId}:turn_0`)).toBe(false);
          await runtime.dispatchSession({
            sessionId: child.runId,
            command: { kind: "send", payload: { message: scenario.message } },
          });
          const events = await stream.nextTurn();
          expect(
            events.some((event) => event.type === "turn.completed"),
            scenario.label,
          ).toBe(true);
          const reducer = defaultMessageReducer();
          const projection = [...idle, ...events].reduce(reducer.reduce, reducer.initial());
          expect(
            projection.messages.filter((message) => message.role === "user").at(-1)?.parts,
          ).toContainEqual({ type: "text", text: scenario.message, state: "done" });
          if (scenario.label === "edit-second")
            expect(JSON.stringify(projection.messages)).not.toContain("excluded second question");
          const continued = captures.get(`${child.runId}:turn_0`);
          expect(continued).toBeDefined();
          expect(JSON.stringify(continued)).toContain(scenario.message);
          expect(child.runId).not.toBe(source.runId);
        } finally {
          await stop(child.runId);
          await child.returnValue;
          stream.dispose();
        }
      }
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "parent keeps going" } },
      });
      expect((await sourceStream.nextTurn()).some((event) => event.type === "turn.completed")).toBe(
        true,
      );
      expect(JSON.stringify(captures.get(`${source.runId}:turn_2`))).toContain(
        "excluded second question",
      );
      expect(JSON.stringify(first)).not.toContain("excluded second question");
    } finally {
      await stop(source.runId);
      await source.returnValue;
      sourceStream.dispose();
    }
  });
}, 30_000);
