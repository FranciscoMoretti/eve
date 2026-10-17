import { defaultMessageReducer } from "#client/message-reducer.js";
import { conversationProjection } from "#client/conversation-projection.js";
import { stampMessageStreamEvent } from "#protocol/message.js";
import { eveChannel } from "#public/channels/eve.js";
import { attachRouteSessionCreator } from "#internal/nitro/routes/channel-route-context.js";
import { mockAgentRouteArgs } from "#internal/testing/mocks/mock-route-args.js";
import { mockChannelContext } from "#internal/testing/mocks/mock-channel-operations.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { getRun } from "#internal/workflow/runtime.js";
import { z } from "#compiled/zod/index.js";
import { copyCheckpointHandler } from "#eve-channel/copy-checkpoint.js";
import { ROOT_COMPILED_AGENT_NODE_ID } from "#compiler/manifest.js";
import { toInputSchema } from "#tools/schema.js";
import { expect, it, vi } from "vitest";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { startSessionOwner } from "#internal/testing/workflow-test-helpers.js";
import { buildSerializedContext } from "#internal/testing/entry-test-helpers.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { workflowEntry } from "#execution/session/entry.js";
import { resumeSessionInbox } from "#execution/session-inbox/resume.js";
import {
  copyCheckpointPrincipal,
  boundaryCopyCheckpointId,
  readCopyCheckpoint,
} from "#execution/copy-checkpoint.js";

it("captures the serialized owner's exact idle history and keeps named receipts immutable after source advance", async () => {
  const runtime = await createTestRuntime({ agent: { name: "copy-owner" } });
  await runtime.run(async () => {
    const auth = {
      authenticator: "test",
      principalId: "alice",
      principalType: "user",
      attributes: {},
    };
    const source = await startSessionOwner(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_a",
        sessionTimeoutMs: false,
        input: { message: "Alice records her first note." },
        serializedContext: {
          ...buildSerializedContext({ channelKind: "http", auth }),
          "eve.initiatorAuth": auth,
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      await stream.nextUntil((event) => event.type === "turn.completed");
      const request = {
        kind: "copy-checkpoint" as const,
        checkpointId: "first-note",
        beforeTurnId: "turn_1",
        principalId: "alice",
        principalIdentity: copyCheckpointPrincipal(auth),
      };
      const checkpointRoute = copyCheckpointHandler({
        auth: () => auth,
        authorizeFork: () => true,
      });
      const requestUrl = `https://test/eve/v1/session/${source.runId}/checkpoint/first-note?beforeTurnId=turn_1`;
      const routeContext = {
        params: { sessionId: source.runId, checkpointId: "first-note" },
        requestIp: null,
        waitUntil: () => {},
      };
      expect((await checkpointRoute(new Request(requestUrl), routeContext)).status).toBe(404);
      expect(
        (
          await checkpointRoute(
            new Request(`https://test/eve/v1/session/${source.runId}/checkpoint`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ beforeTurnId: "turn_1", checkpointId: "first-note" }),
            }),
            routeContext,
          )
        ).status,
      ).toBe(202);
      await vi.waitFor(async () =>
        expect(await readCopyCheckpoint(source.runId, request.checkpointId)).toBeDefined(),
      );
      const first = await readCopyCheckpoint(source.runId, request.checkpointId);
      const ready = await checkpointRoute(new Request(requestUrl), routeContext);
      expect(await ready.json()).toEqual({
        ready: true,
        sessionId: source.runId,
        beforeTurnId: "turn_1",
        checkpointId: "first-note",
      });
      const denied = copyCheckpointHandler({ auth: () => auth, authorizeFork: () => false });
      expect((await denied(new Request(requestUrl), routeContext)).status).toBe(403);
      expect(
        (await checkpointRoute(new Request(`${requestUrl}&owner=foreign`), routeContext)).status,
      ).toBe(400);
      expect(first).toMatchObject({
        sessionId: source.runId,
        beforeTurnId: "turn_1",
        principalId: "alice",
        sandbox: null,
      });
      expect(first && "history" in first ? JSON.stringify(first.history) : "").toContain(
        "Alice records her first note.",
      );
      await resumeSessionInbox(
        { sessionId: source.runId },
        { kind: "send", payload: { message: "Alice records her second note." }, auth },
      );
      await stream.nextUntil((event) => event.type === "turn.completed");
      await resumeSessionInbox(
        { sessionId: source.runId },
        { ...request, checkpointId: "stale-note" },
      );
      await vi.waitFor(async () =>
        expect(await readCopyCheckpoint(source.runId, "stale-note")).toMatchObject({
          rejected: "source_advanced",
        }),
      );
      await resumeSessionInbox({ sessionId: source.runId }, request);
      expect(await readCopyCheckpoint(source.runId, "first-note")).toEqual(first);
      await resumeSessionInbox({ sessionId: source.runId }, { ...request, beforeTurnId: "turn_2" });
      await resumeSessionInbox(
        { sessionId: source.runId },
        { ...request, checkpointId: "foreign", principalId: "mallory" },
      );
      await resumeSessionInbox(
        { sessionId: source.runId },
        {
          kind: "send",
          payload: { message: "Alice continues after rejected capture requests." },
          auth,
        },
      );
      expect(
        (await stream.nextUntil((event) => event.type === "turn.completed")).some(
          (event) => event.type === "turn.completed",
        ),
      ).toBe(true);
      expect(await readCopyCheckpoint(source.runId, "foreign")).toBeUndefined();
      if (!first || "rejected" in first) throw new Error("Missing source checkpoint.");
      const channel = eveChannel({ auth: () => auth, authorizeFork: () => true });
      const route = channel.routes.find(
        (candidate) => candidate.method === "POST" && candidate.path === "/eve/v1/session",
      );
      if (!route || route.method === "WEBSOCKET") throw new Error("Missing create route.");
      const native = createWorkflowRuntime({
        compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
      });
      const unavailable = () => {
        throw new Error("Unexpected route operation.");
      };
      const args = attachRouteSessionCreator(
        {
          ...mockAgentRouteArgs(),
          ...mockChannelContext(unavailable),
          params: {},
          requestIp: null,
          waitUntil: unavailable,
          attachSession: unavailable,
          to: unavailable,
        },
        async (input) =>
          await native.createSession({ ...input, adapter: { kind: "http" }, channelName: "http" }),
      );
      const response = await route.handler(
        new Request("https://test/eve/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: "Alice continues her copied first note.",
            fork: { sessionId: source.runId, beforeTurnId: "turn_1", checkpointId: "first-note" },
          }),
        }),
        args,
      );
      expect(response.status).toBe(202);
      const destination = getRun(
        z.object({ sessionId: z.string() }).parse(await response.json()).sessionId,
      );
      const destinationStream = captureTurnEvents(destination);
      try {
        const copiedTurn = await destinationStream.nextTurn();
        expect(copiedTurn).toContainEqual(
          expect.objectContaining({ type: "history.restored", data: { events: first.events } }),
        );
        expect(copiedTurn).toContainEqual(
          expect.objectContaining({
            type: "turn.started",
            data: expect.objectContaining({ turnId: "turn_1" }),
          }),
        );
        await resumeSessionInbox(
          { sessionId: destination.runId },
          { ...request, checkpointId: "copied-note", beforeTurnId: "turn_2" },
        );
        await vi.waitFor(async () =>
          expect(await readCopyCheckpoint(destination.runId, "copied-note")).toBeDefined(),
        );
        const copied = await readCopyCheckpoint(destination.runId, "copied-note");
        const history = copied && "history" in copied ? JSON.stringify(copied.history) : "";
        expect(history).toContain("Alice records her first note.");
        expect(history).toContain("Alice continues her copied first note.");
        expect(history).not.toContain("Alice records her second note.");
        expect(destination.runId).not.toBe(source.runId);
      } finally {
        destinationStream.dispose();
        await destination.cancel();
      }

      expect(await readCopyCheckpoint(source.runId, "first-note")).toEqual(first);
    } finally {
      stream.dispose();
      await source.cancel();
    }
  });
});

it("rejects a capture during active tool work without interrupting that work", async () => {
  const started = Promise.withResolvers<void>();
  const completion = Promise.withResolvers<string>();
  const tool = {
    name: "checkpoint_work",
    description: "Complete the current work.",
    execute: async () => {
      started.resolve();
      return completion.promise;
    },
    inputSchema: toInputSchema({ type: "object", properties: {}, additionalProperties: false }),
    logicalPath: "tools/checkpoint_work.ts",
    sourceId: "tools/checkpoint_work.ts",
    owner: { kind: "application" as const },
    sourceKind: "module" as const,
  };
  const runtime = await createTestRuntime({ agent: { name: "copy-active" }, tools: [tool] });
  const manifestTool = runtime.manifest.tools.find((candidate) => candidate.name === tool.name);
  if (manifestTool === undefined) throw new Error("Missing checkpoint work tool.");
  runtime.moduleMap.nodes[ROOT_COMPILED_AGENT_NODE_ID]!.modules[manifestTool.sourceId] = {
    default: { execute: tool.execute },
  };
  await runtime.run(async () => {
    const auth = {
      authenticator: "test",
      principalId: "alice",
      principalType: "user",
      attributes: {},
    };
    const source = await startSessionOwner(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_a",
        sessionTimeoutMs: false,
        input: { message: "Use the checkpoint_work tool." },
        serializedContext: {
          ...buildSerializedContext({ channelKind: "http", auth }),
          "eve.initiatorAuth": auth,
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      await started.promise;
      await resumeSessionInbox(
        { sessionId: source.runId },
        {
          kind: "copy-checkpoint",
          checkpointId: "active",
          beforeTurnId: "turn_0",
          principalId: "alice",
          principalIdentity: copyCheckpointPrincipal(auth),
        },
      );
      completion.resolve("Work completed.");
      await stream.nextUntil((event) => event.type === "turn.completed");
      await vi.waitFor(async () =>
        expect(await readCopyCheckpoint(source.runId, "active")).toMatchObject({
          rejected: "source_not_idle",
        }),
      );
      await resumeSessionInbox(
        { sessionId: source.runId },
        {
          kind: "copy-checkpoint",
          checkpointId: "finished-work",
          beforeTurnId: "turn_1",
          principalId: "alice",
          principalIdentity: copyCheckpointPrincipal(auth),
        },
      );
      await vi.waitFor(async () =>
        expect(await readCopyCheckpoint(source.runId, "finished-work")).toBeDefined(),
      );
      const finished = await readCopyCheckpoint(source.runId, "finished-work");
      if (!finished || "rejected" in finished)
        throw new Error("Missing completed tool checkpoint.");
      const reducer = defaultMessageReducer();
      const display = reducer.reduce(
        reducer.initial(),
        stampMessageStreamEvent({ type: "history.restored", data: { events: finished.events } }),
      );
      const parts = display.messages.flatMap((message) => message.parts);
      expect(parts).toContainEqual(
        expect.objectContaining({
          type: "dynamic-tool",
          toolName: "checkpoint_work",
          state: "output-available",
        }),
      );
      expect(conversationProjection(display).calls).toEqual({});
      expect(conversationProjection(display).tasks).toEqual({});
      await resumeSessionInbox(
        { sessionId: source.runId },
        { kind: "send", payload: { message: "Alice continues after her work." }, auth },
      );
      expect(
        (await stream.nextUntil((event) => event.type === "turn.completed")).some(
          (event) => event.type === "turn.completed",
        ),
      ).toBe(true);
    } finally {
      completion.resolve("Work completed.");
      stream.dispose();
      await source.cancel();
    }
  });
});

it("automatically retains exact boundaries and announces ready checkpoints only after capture", async () => {
  const runtime = await createTestRuntime({ agent: { name: "copy-boundaries" } });
  await runtime.run(async () => {
    const auth = {
      authenticator: "test",
      principalId: "alice",
      principalType: "user",
      attributes: {},
    };
    const source = await startSessionOwner(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_a",
        sessionTimeoutMs: false,
        input: { message: "Alice records a boundary note." },
        serializedContext: {
          ...buildSerializedContext({ channelKind: "http", auth }),
          "eve.initiatorAuth": auth,
          "eve.copyCheckpoints": true,
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      const events = await stream.nextUntil(
        (event) =>
          event.type === "session.waiting" && event.data.checkpoint?.beforeTurnId === "turn_1",
      );
      await vi.waitFor(async () =>
        expect(
          await readCopyCheckpoint(source.runId, boundaryCopyCheckpointId(source.runId, "turn_1")),
        ).toBeDefined(),
      );
      const ready = await readCopyCheckpoint(
        source.runId,
        boundaryCopyCheckpointId(source.runId, "turn_1"),
      );
      expect(ready).toMatchObject({ beforeTurnId: "turn_1", sandbox: null });
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
      const initial = await readCopyCheckpoint(
        source.runId,
        boundaryCopyCheckpointId(source.runId, "turn_0"),
      );
      expect(initial && "history" in initial ? JSON.stringify(initial.history) : "").not.toContain(
        "Alice records a boundary note.",
      );
      expect(initial).toMatchObject({ beforeTurnId: "turn_0", sandbox: null });
    } finally {
      stream.dispose();
      await source.cancel();
    }
  });
});

it("requires checkpoint persistence, retries a lost receipt, and keeps ordinary hooks best-effort", async () => {
  const persisted = new Set<string>();
  let attempts = 0;
  let failPersistence = true;
  let failReceipt = true;
  const runtime = await createTestRuntime({
    agent: { name: "required-checkpoint" },
    modules: [
      {
        logicalPath: "hooks/documents.ts",
        loadNamespace: async () => ({
          default: {
            checkpoint: async (checkpoint: { checkpointId: string }) => {
              if (checkpoint.checkpointId !== "required") return;
              attempts++;
              if (failPersistence) throw new Error("Document store unavailable.");
              persisted.add(checkpoint.checkpointId);
              if (failReceipt) {
                failReceipt = false;
                throw new Error(
                  "Injected failure after application commit, before native receipt write.",
                );
              }
            },
            events: {
              "session.waiting": async () => {
                throw new Error("Best-effort observer unavailable.");
              },
            },
          },
        }),
      },
    ],
  });
  await runtime.run(async () => {
    const auth = {
      authenticator: "test",
      principalId: "alice",
      principalType: "user",
      attributes: {},
    };
    const source = await startSessionOwner(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_a",
        sessionTimeoutMs: false,
        input: { message: "Alice records her note." },
        serializedContext: {
          ...buildSerializedContext({ channelKind: "http", auth }),
          "eve.initiatorAuth": auth,
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    const request = {
      kind: "copy-checkpoint" as const,
      checkpointId: "required",
      beforeTurnId: "turn_1",
      principalId: "alice",
      principalIdentity: copyCheckpointPrincipal(auth),
    };
    // A following command confirms the failed capture has returned to the owner loop.
    const barrier = async (checkpointId: string) => {
      await resumeSessionInbox({ sessionId: source.runId }, { ...request, checkpointId });
      await vi.waitFor(async () =>
        expect(await readCopyCheckpoint(source.runId, checkpointId)).toBeDefined(),
      );
    };
    try {
      await stream.nextUntil((event) => event.type === "turn.completed");
      await resumeSessionInbox({ sessionId: source.runId }, request);
      await barrier("after-persistence-failure");
      expect(attempts).toBe(1);
      expect(persisted.size).toBe(0);
      expect(await readCopyCheckpoint(source.runId, "required")).toBeUndefined();
      failPersistence = false;
      await resumeSessionInbox({ sessionId: source.runId }, request);
      await barrier("after-receipt-failure");
      expect(attempts).toBe(2);
      expect(persisted.size).toBe(1);
      expect(await readCopyCheckpoint(source.runId, "required")).toBeUndefined();
      await resumeSessionInbox({ sessionId: source.runId }, request);
      await barrier("after-retry");
      const ready = await readCopyCheckpoint(source.runId, "required");
      expect(ready).toMatchObject({ beforeTurnId: "turn_1", sandbox: null });
      expect(attempts).toBe(3);
      expect(persisted.size).toBe(1);
      await resumeSessionInbox({ sessionId: source.runId }, request);
      await barrier("after-repeat");
      expect(attempts).toBe(3);
      expect(await readCopyCheckpoint(source.runId, "required")).toEqual(ready);
      await resumeSessionInbox(
        { sessionId: source.runId },
        { kind: "send", payload: { message: "Alice continues after the storage failures." }, auth },
      );
      expect(
        (await stream.nextUntil((event) => event.type === "turn.completed")).some(
          (event) => event.type === "turn.completed",
        ),
      ).toBe(true);
    } finally {
      stream.dispose();
      await source.cancel();
    }
  });
});

it("forks exact imported user boundaries from retained trusted input without replaying tools", async () => {
  const runtime = await createTestRuntime({ agent: { name: "imported-boundaries" } });
  await runtime.run(async () => {
    const auth = {
      authenticator: "test",
      principalId: "alice",
      principalType: "user",
      attributes: {},
    };
    const source = await startSessionOwner(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_a",
        sessionTimeoutMs: false,
        seed: {
          attachments: "channel",
          messages: [
            { role: "user", parts: [{ type: "text", text: "First imported note" }] },
            {
              role: "assistant",
              parts: [
                {
                  type: "dynamic-tool",
                  toolName: "never_execute",
                  input: {},
                  state: "output-available",
                  output: "Historical tool result",
                },
              ],
            },
            { role: "user", parts: [{ type: "text", text: "Excluded imported note" }] },
          ],
        },
        input: {},
        serializedContext: {
          ...buildSerializedContext({ channelKind: "http", auth }),
          "eve.initiatorAuth": auth,
        },
      },
    ]);
    const stream = captureTurnEvents(source);
    try {
      await stream.nextUntil((event) => event.type === "history.seeded");
      const channel = eveChannel({ auth: () => auth, authorizeFork: () => true });
      const route = channel.routes.find(
        (candidate) => candidate.method === "POST" && candidate.path === "/eve/v1/session",
      );
      if (!route || route.method === "WEBSOCKET") throw new Error("Missing create route.");
      const native = createWorkflowRuntime({
        compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
      });
      const unavailable = () => {
        throw new Error("Unexpected route operation.");
      };
      const args = attachRouteSessionCreator(
        {
          ...mockAgentRouteArgs(),
          ...mockChannelContext(unavailable),
          params: {},
          requestIp: null,
          waitUntil: unavailable,
          attachSession: unavailable,
          to: unavailable,
        },
        async (input) =>
          await native.createSession({ ...input, adapter: { kind: "http" }, channelName: "http" }),
      );
      const create = async (sessionId: string, beforeMessageId: string) =>
        await route.handler(
          new Request("https://test/eve/v1/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: "Alice continues her selected prefix.",
              fork: { sessionId, beforeMessageId },
            }),
          }),
          args,
        );
      expect((await create(source.runId, "seed_message_1")).status).toBe(409);
      expect((await create(source.runId, "seed_message_3")).status).toBe(409);
      const response = await create(source.runId, "seed_message_2");
      expect(response.status).toBe(202);
      const destination = getRun(
        z.object({ sessionId: z.string() }).parse(await response.json()).sessionId,
      );
      const destinationStream = captureTurnEvents(destination);
      try {
        const events = await destinationStream.nextUntil(
          (event) => event.type === "turn.completed",
        );
        const display = events.reduce(
          defaultMessageReducer().reduce,
          defaultMessageReducer().initial(),
        );
        expect(display.messages.slice(0, 2).map((message) => message.id)).toEqual([
          "seed_message_0",
          "seed_message_1",
        ]);
        expect(JSON.stringify(display.messages)).toContain("Historical tool result");
        expect(JSON.stringify(display.messages)).not.toContain("Excluded imported note");
        expect(events.some((event) => event.type === "actions.requested")).toBe(false);
        const request = {
          kind: "copy-checkpoint" as const,
          checkpointId: "prefix",
          beforeTurnId: "turn_1",
          principalId: "alice",
          principalIdentity: copyCheckpointPrincipal(auth),
        };
        await resumeSessionInbox({ sessionId: destination.runId }, request);
        await vi.waitFor(async () =>
          expect(await readCopyCheckpoint(destination.runId, "prefix")).toBeDefined(),
        );
        const checkpoint = await readCopyCheckpoint(destination.runId, "prefix");
        expect(
          checkpoint && "history" in checkpoint ? JSON.stringify(checkpoint.history) : "",
        ).toContain("Historical tool result");
        expect(
          checkpoint && "history" in checkpoint ? JSON.stringify(checkpoint.history) : "",
        ).not.toContain("Excluded imported note");
        // A descendant owns only its retained prefix, not the source's later seed messages.
        expect((await create(destination.runId, "seed_message_2")).status).toBe(409);
      } finally {
        destinationStream.dispose();
        await destination.cancel();
      }
    } finally {
      stream.dispose();
      await source.cancel();
    }
  });
});
