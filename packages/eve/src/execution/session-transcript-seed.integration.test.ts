import { expect, it } from "vitest";
import { start } from "#internal/workflow/runtime.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { workflowEntry } from "#execution/session/entry.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import { defaultMessageReducer } from "#client/message-reducer.js";
import { getHarnessEmissionState } from "#harness/emission-state.js";
import {
  prepareSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";

function context() {
  return {
    "eve.auth": null,
    "eve.bundle": { source: createBundledRuntimeCompiledArtifactsSource() },
    "eve.channel": { kind: "http", state: {} },
    "eve.mode": "conversation",
  };
}
const seed: SessionTranscriptSeed = {
  messages: [
    {
      role: "user",
      metadata: { chatjs: { selectedTool: "canvas" } },
      parts: [{ type: "text", text: "Published question" }],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "calculate",
          input: { n: 2 },
          state: "output-available",
          output: { result: 4 },
        },
        { type: "text", text: "Published answer" },
      ],
    },
  ],
};

it("creates idle native history, checkpoints without a turn, and retains the seed through continuation and nested forks", async () => {
  const fixture = await createTestRuntime({ agent: { name: "transcript-seed" } });
  await fixture.run(async () => {
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {},
        seed,
        serializedContext: context(),
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      const events = await stream.nextTurn();
      expect(events.map((event) => event.type)).toEqual(["history.seeded", "session.waiting"]);
      const reducer = defaultMessageReducer();
      expect(events.reduce(reducer.reduce, reducer.initial()).messages).toEqual(
        prepareSessionTranscriptSeed(seed).messages,
      );
      const checkpoint = {
        sessionId: source.runId,
        beforeTurnId: "turn_0",
        checkpointId: crypto.randomUUID(),
      };
      expect(
        await runtime.dispatchSession({
          sessionId: source.runId,
          command: {
            kind: "checkpoint",
            checkpointId: checkpoint.checkpointId,
            beforeTurnId: checkpoint.beforeTurnId,
          },
        }),
      ).toMatchObject({ status: "accepted" });
      const idle = await stream.nextTurn();
      expect(
        idle.some((event) => event.type === "turn.started" || event.type === "actions.requested"),
      ).toBe(false);
      expect(idle.at(-1)?.type).toBe("session.waiting");
      await expect
        .poll(async () => {
          try {
            return (await readSessionCheckpoint(checkpoint)).checkpointId;
          } catch {
            return undefined;
          }
        })
        .toBe(checkpoint.checkpointId);
      const saved = await readSessionCheckpoint(checkpoint);
      expect(saved.snapshot.session.history).toEqual(prepareSessionTranscriptSeed(seed).history);
      expect(saved.snapshot.session.sessionId).toBe(source.runId);
      expect(saved.snapshot.session.rootSessionId).toBeUndefined();
      expect(getHarnessEmissionState(saved.snapshot.session.state)).toEqual({
        sessionStarted: false,
        sequence: 0,
        stepIndex: 0,
        turnId: "",
      });
      const branch = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: { message: "Follow up on my copy", messageMetadata: { selectedTool: "canvas" } },
          fork: checkpoint,
          serializedContext: context(),
        },
      ]);
      const branchStream = captureTurnEvents(branch);
      try {
        const branchEvents = await branchStream.nextTurn();
        expect(branchEvents.filter((event) => event.type === "session.started")).toHaveLength(1);
        expect(branchEvents.filter((event) => event.type === "turn.started")).toHaveLength(1);
        const projection = branchEvents.reduce(reducer.reduce, reducer.initial());
        expect(
          projection.messages.find(
            (message) => message.metadata?.turnId === "turn_0" && message.role === "user",
          )?.metadata?.custom,
        ).toEqual({ selectedTool: "canvas" });
        expect(projection.messages.slice(0, 2)).toEqual(
          prepareSessionTranscriptSeed(seed).messages,
        );
        const second = await start(workflowEntry, [
          {
            kind: "initial",
            ownerDeploymentId: "dpl_inline",
            input: { message: "Another follow up" },
            fork: { sessionId: branch.runId, beforeTurnId: "turn_0" },
            serializedContext: context(),
          },
        ]);
        const secondStream = captureTurnEvents(second);
        try {
          const replay = await secondStream.nextTurn();
          expect(replay.reduce(reducer.reduce, reducer.initial()).messages.slice(0, 2)).toEqual(
            prepareSessionTranscriptSeed(seed).messages,
          );
        } finally {
          await runtime.dispatchSession({ sessionId: second.runId, command: { kind: "reset" } });
          await second.returnValue;
          secondStream.dispose();
        }
      } finally {
        await runtime.dispatchSession({ sessionId: branch.runId, command: { kind: "reset" } });
        await branch.returnValue;
        branchStream.dispose();
      }
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: {
          kind: "send",
          payload: { message: "Continue here", messageMetadata: { selectedTool: null } },
        },
      });
      const continued = await stream.nextTurn();
      expect(continued.find((event) => event.type === "message.received")).toMatchObject({
        data: { metadata: { selectedTool: null } },
      });
      expect(continued.filter((event) => event.type === "session.started")).toHaveLength(1);
      expect(continued.find((event) => event.type === "turn.started")).toMatchObject({
        data: { turnId: "turn_0" },
      });
      const firstTurn = await readSessionCheckpoint({
        sessionId: source.runId,
        beforeTurnId: "turn_0",
      });
      expect(firstTurn.snapshot.session.history).toEqual(
        prepareSessionTranscriptSeed(seed).history,
      );
      expect((await readSessionCheckpoint(checkpoint)).snapshot).toEqual(saved.snapshot);
    } finally {
      await runtime.dispatchSession({ sessionId: source.runId, command: { kind: "reset" } });
      await source.returnValue;
      stream.dispose();
    }
  });
});

it.each([
  { input: { message: "Do not run this" } },
  { fork: { sessionId: "private-source", beforeTurnId: "turn_0" } },
  { taskId: "delegated-task" },
  { serializedContext: { ...context(), "eve.mode": "task" } },
])(
  "rejects seeded execution or checkpoint modes before emitting copied history: %j",
  async (overrides) => {
    const fixture = await createTestRuntime();
    await fixture.run(async () => {
      const run = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: {},
          seed,
          serializedContext: context(),
          ...overrides,
        },
      ]);
      const stream = captureTurnEvents(run);
      try {
        const events = await stream.nextTurn();
        expect(events.at(-1)?.type).toBe("session.failed");
        expect(
          events.some((event) =>
            ["history.seeded", "turn.started", "actions.requested"].includes(event.type),
          ),
        ).toBe(false);
      } finally {
        await expect(run.returnValue).rejects.toThrow();
        stream.dispose();
      }
    });
  },
);

it("round-trips copied attachment URLs in an idle checkpoint without fetching them", async () => {
  const fixture = await createTestRuntime();
  await fixture.run(async () => {
    const attachments: SessionTranscriptSeed = {
      messages: [
        {
          role: "user",
          parts: [
            {
              type: "file",
              url: "https://copies.example/report.pdf",
              mediaType: "application/pdf",
              filename: "report.pdf",
            },
            {
              type: "file",
              url: "https://copies.example/image.png",
              mediaType: "image/png",
              filename: "image.png",
            },
          ],
        },
      ],
    };
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const run = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {},
        seed: attachments,
        serializedContext: context(),
      },
    ]);
    const stream = captureTurnEvents(run);
    try {
      expect((await stream.nextTurn()).map((event) => event.type)).toEqual([
        "history.seeded",
        "session.waiting",
      ]);
      const ref = {
        sessionId: run.runId,
        beforeTurnId: "turn_0",
        checkpointId: crypto.randomUUID(),
      };
      await runtime.dispatchSession({
        sessionId: run.runId,
        command: {
          kind: "checkpoint",
          checkpointId: ref.checkpointId,
          beforeTurnId: ref.beforeTurnId,
        },
      });
      expect((await stream.nextTurn()).at(-1)?.type).toBe("session.waiting");
      await expect
        .poll(async () => {
          try {
            return (await readSessionCheckpoint(ref)).checkpointId;
          } catch {
            return undefined;
          }
        })
        .toBe(ref.checkpointId);
      expect((await readSessionCheckpoint(ref)).snapshot.session.history).toEqual(
        prepareSessionTranscriptSeed(attachments).history,
      );
    } finally {
      await runtime.dispatchSession({ sessionId: run.runId, command: { kind: "reset" } });
      await run.returnValue;
      stream.dispose();
    }
  });
});

it("stages compact seed attachments on the first real workflow turn and reuses them thereafter", async () => {
  const { eveChannel } = await import("#eve-channel/index.js");
  const owner = {
    authenticator: "test",
    principalId: "copy-owner",
    principalType: "user" as const,
    attributes: {},
  };
  let fetches = 0;
  const fixture = await createTestRuntime({
    modules: [
      {
        logicalPath: "channels/eve.ts",
        loadNamespace: async () => ({
          default: eveChannel({
            auth: () => owner,
            fetchFile: async (_url, ctx) => {
              expect(ctx?.session?.auth.current?.principalId).toBe(owner.principalId);
              fetches++;
              return { bytes: Buffer.alloc(1024 * 1024, fetches), mediaType: "image/png" };
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
    const copied: SessionTranscriptSeed = {
      attachments: "channel",
      messages: [
        {
          role: "user",
          parts: Array.from({ length: 6 }, (_, index) => ({
            type: "file",
            url: `https://copy.local/${index}.png`,
            mediaType: "image/png",
          })),
        },
      ],
    };
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {},
        seed: copied,
        serializedContext: {
          ...context(),
          "eve.auth": owner,
          "eve.channel": { kind: "channel:eve", state: {} },
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      expect((await stream.nextTurn()).map((event) => event.type)).toEqual([
        "history.seeded",
        "session.waiting",
      ]);
      expect(fetches).toBe(0);
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "Describe these files", auth: owner } },
      });
      const first = await stream.nextTurn();
      expect(first.some((event) => event.type === "turn.failed")).toBe(false);
      expect(fetches).toBe(6);
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "Continue", auth: owner } },
      });
      await stream.nextTurn();
      expect(fetches).toBe(6);
      const checkpoint = await readSessionCheckpoint({
        sessionId: source.runId,
        beforeTurnId: "turn_1",
      });
      expect(JSON.stringify(checkpoint.snapshot.session.history)).toContain("eve-sandbox:");
      expect(JSON.stringify(checkpoint.snapshot.session.history)).not.toContain(
        "https://copy.local",
      );
    } finally {
      await runtime.dispatchSession({ sessionId: source.runId, command: { kind: "reset" } });
      await source.returnValue;
      stream.dispose();
    }
  });
});

it("preserves the copied transcript and failed input when file storage recovers", async () => {
  const { eveChannel } = await import("#eve-channel/index.js");
  const owner = {
    authenticator: "test",
    principalId: "copy-owner",
    principalType: "user" as const,
    attributes: {},
  };
  let fetches = 0;
  let available = false;
  const fixture = await createTestRuntime({
    modules: [
      {
        logicalPath: "channels/eve.ts",
        loadNamespace: async () => ({
          default: eveChannel({
            auth: () => owner,
            fetchFile: async (_url, ctx) => {
              expect(ctx?.session?.auth.current?.principalId).toBe(owner.principalId);
              if (!available) throw new Error("Storage temporarily unavailable");
              fetches++;
              return { bytes: Buffer.alloc(1024 * 1024, fetches), mediaType: "image/png" };
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
    const copied: SessionTranscriptSeed = {
      attachments: "channel",
      messages: [
        {
          role: "user",
          parts: Array.from({ length: 6 }, (_, index) => ({
            type: "file",
            url: `https://copy.local/${index}.png`,
            mediaType: "image/png",
          })),
        },
      ],
    };
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {},
        seed: copied,
        serializedContext: {
          ...context(),
          "eve.auth": owner,
          "eve.channel": { kind: "channel:eve", state: {} },
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      expect((await stream.nextTurn()).map((event) => event.type)).toEqual([
        "history.seeded",
        "session.waiting",
      ]);
      expect(fetches).toBe(0);
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "Describe these files", auth: owner } },
      });
      const failed = await stream.nextTurn();
      expect(failed.some((event) => event.type === "turn.failed")).toBe(true);
      expect(failed.at(-1)?.type).toBe("session.waiting");
      expect(failed.some((event) => event.type === "session.failed")).toBe(false);
      expect(failed.some((event) => event.type === "message.received")).toBe(true);
      expect(fetches).toBe(0);
      available = true;
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "Retry loading the files", auth: owner } },
      });
      const recovered = await stream.nextTurn();
      expect(
        recovered.some((event) => event.type === "turn.failed" || event.type === "session.failed"),
      ).toBe(false);
      expect(fetches).toBe(6);
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "Continue", auth: owner } },
      });
      await stream.nextTurn();
      expect(fetches).toBe(6);
      const checkpoint = await readSessionCheckpoint({
        sessionId: source.runId,
        beforeTurnId: "turn_2",
      });
      expect(JSON.stringify(checkpoint.snapshot.session.history)).toContain("Describe these files");
      expect(JSON.stringify(checkpoint.snapshot.session.history)).toContain("eve-sandbox:");
      expect(JSON.stringify(checkpoint.snapshot.session.history)).not.toContain(
        "https://copy.local",
      );
    } finally {
      await runtime.dispatchSession({ sessionId: source.runId, command: { kind: "reset" } });
      await source.returnValue;
      stream.dispose();
    }
  });
});

it("forks an imported user boundary and can fork that imported prefix again", async () => {
  const fixture = await createTestRuntime({ agent: { name: "imported-boundary" } });
  await fixture.run(async () => {
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const imported: SessionTranscriptSeed = {
      messages: [
        { role: "user", parts: [{ type: "text", text: "Retained imported question" }] },
        {
          role: "assistant",
          modelId: "gateway/google/gemini-2.5-flash-lite",
          parts: [{ type: "text", text: "Retained imported answer" }],
        },
        { role: "user", parts: [{ type: "text", text: "Excluded imported question" }] },
        { role: "assistant", parts: [{ type: "text", text: "Excluded imported answer" }] },
      ],
    };
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {},
        seed: imported,
        serializedContext: context(),
      },
    ]);
    const sourceStream = captureTurnEvents(source);
    try {
      await sourceStream.nextTurn();
      const branch = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: { message: "Replacement question" },
          fork: { sessionId: source.runId, beforeMessageId: "seed_message_2" },
          serializedContext: context(),
        },
      ]);
      const branchStream = captureTurnEvents(branch);
      try {
        const events = await branchStream.nextTurn();
        expect(events.at(-1)?.type).toBe("session.waiting");
        const reducer = defaultMessageReducer();
        const messages = events.reduce(reducer.reduce, reducer.initial()).messages;
        expect(messages.slice(0, 2)).toEqual(
          prepareSessionTranscriptSeed(imported).messages.slice(0, 2),
        );
        expect(JSON.stringify(messages)).not.toContain("Excluded imported");
        expect(JSON.stringify(messages)).toContain("Replacement question");
        const saved = await readSessionCheckpoint({
          sessionId: branch.runId,
          beforeTurnId: "turn_0",
        });
        expect(saved.snapshot.session.history).toEqual(
          prepareSessionTranscriptSeed({ messages: imported.messages.slice(0, 2) }).history,
        );
        expect(saved.snapshot.session.sandboxState?.forkCheckpoint).toBeUndefined();
        const nested = await start(workflowEntry, [
          {
            kind: "initial",
            ownerDeploymentId: "dpl_inline",
            input: { message: "Replace first imported question" },
            fork: { sessionId: branch.runId, beforeMessageId: "seed_message_0" },
            serializedContext: context(),
          },
        ]);
        const nestedStream = captureTurnEvents(nested);
        try {
          const nestedEvents = await nestedStream.nextTurn();
          expect(nestedEvents.at(-1)?.type).toBe("session.waiting");
          const nestedCheckpoint = await readSessionCheckpoint({
            sessionId: nested.runId,
            beforeTurnId: "turn_0",
          });
          expect(nestedCheckpoint.snapshot.session.history).toEqual([]);
          expect(
            JSON.stringify(nestedEvents.reduce(reducer.reduce, reducer.initial()).messages),
          ).not.toContain("Retained imported");
        } finally {
          await runtime.dispatchSession({ sessionId: nested.runId, command: { kind: "reset" } });
          await nested.returnValue;
          nestedStream.dispose();
        }
      } finally {
        await runtime.dispatchSession({ sessionId: branch.runId, command: { kind: "reset" } });
        await branch.returnValue;
        branchStream.dispose();
      }
    } finally {
      await runtime.dispatchSession({ sessionId: source.runId, command: { kind: "reset" } });
      await source.returnValue;
      sourceStream.dispose();
    }
  });
});
