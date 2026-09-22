import { readSessionSandboxIdentity } from "#execution/read-session-sandbox-identity.js";
import { defaultMessageReducer } from "#client/message-reducer.js";
import { expect, it } from "vitest";
import { start } from "#internal/workflow/runtime.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { workflowEntry } from "#execution/session/entry.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";

function context() {
  return {
    "eve.auth": null,
    "eve.bundle": { source: createBundledRuntimeCompiledArtifactsSource() },
    "eve.channel": { kind: "http", state: {} },
    "eve.mode": "conversation",
  };
}

it("forks the native history before a user turn without modifying its source", async () => {
  const fixture = await createTestRuntime({ agent: { name: "fork-fixture" } });
  await fixture.run(async () => {
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: { message: "first message" },
        serializedContext: context(),
      },
    ]);
    const sourceStream = captureTurnEvents(source);
    try {
      const first = await sourceStream.nextTurn();
      expect(first.at(-1)?.type).toBe("session.waiting");
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "old second message" } },
      });
      const second = await sourceStream.nextTurn();
      const boundary = second.find((event) => event.type === "message.received");
      if (!boundary || boundary.type !== "message.received") throw new Error("Missing second turn");
      const ref = { sessionId: source.runId, beforeTurnId: boundary.data.turnId };
      const checkpoint = await readSessionCheckpoint(ref);
      expect(
        checkpoint.snapshot.session.history.some(
          (message) => message.role === "user" && message.content === "first message",
        ),
      ).toBe(true);
      const branch = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: { message: "replacement second message" },
          fork: ref,
          serializedContext: context(),
        },
      ]);
      const branchStream = captureTurnEvents(branch);
      try {
        const events = await branchStream.nextTurn();
        expect(events.at(-1)?.type).toBe("session.waiting");
        expect(
          events.some(
            (event) =>
              event.type === "message.received" &&
              event.data.message === "replacement second message",
          ),
        ).toBe(true);
        const reducer = defaultMessageReducer();
        const messages = events.reduce(reducer.reduce, reducer.initial());
        expect(
          messages.messages
            .filter((message) => message.role === "user")
            .map((message) => message.parts),
        ).toEqual([
          [{ type: "text", text: "first message", state: "done" }],
          [{ type: "text", text: "replacement second message", state: "done" }],
        ]);
        const history = events.find((event) => event.type === "history.restored");
        if (!history || history.type !== "history.restored")
          throw new Error("Missing inherited history");
        expect(history.data.events.some((event) => event.type === "message.completed")).toBe(true);
        expect(reducer.reduce(messages, history)).toEqual(messages);
        expect(events.filter((event) => event.type === "session.started")).toHaveLength(1);
        expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
        const restored = await readSessionCheckpoint({
          sessionId: branch.runId,
          beforeTurnId: ref.beforeTurnId,
        });
        expect(restored.snapshot.session.history).toEqual(checkpoint.snapshot.session.history);
        expect(restored.snapshot.session.sessionId).toBe(branch.runId);
        expect(restored.snapshot.version).toBe(2);
        for (const sessionId of [source.runId, branch.runId]) {
          const birth = await readSessionSandboxIdentity(sessionId);
          expect(birth).toMatchObject({ version: 1, sessionId });
        }
        expect(checkpoint.snapshot.session.localSandboxIdentity?.sessionId).toBe(source.runId);
        expect(restored.snapshot.session.localSandboxIdentity?.sessionId).toBe(branch.runId);
        expect(restored.snapshot.session.localSandboxIdentity?.backendName).toBe(
          checkpoint.snapshot.session.localSandboxIdentity?.backendName,
        );
        expect(restored.snapshot.session.continuationToken).toBe("");
        expect((await readSessionCheckpoint(ref)).snapshot).toEqual(checkpoint.snapshot);
        const grandchild = await start(workflowEntry, [
          {
            kind: "initial",
            ownerDeploymentId: "dpl_inline",
            input: { message: "replacement from branch" },
            fork: { sessionId: branch.runId, beforeTurnId: ref.beforeTurnId },
            serializedContext: context(),
          },
        ]);
        const grandchildStream = captureTurnEvents(grandchild);
        try {
          const replay = await grandchildStream.nextTurn();
          expect(replay.at(-1)?.type).toBe("session.waiting");
          const projection = replay.reduce(reducer.reduce, reducer.initial());
          expect(
            projection.messages
              .filter((message) => message.role === "user")
              .flatMap((message) =>
                message.parts.filter((part) => part.type === "text").map((part) => part.text),
              ),
          ).toEqual(["first message", "replacement from branch"]);
          expect(replay.filter((event) => event.type === "turn.started")).toHaveLength(1);
        } finally {
          grandchildStream.dispose();
          await grandchild.cancel();
        }
      } finally {
        branchStream.dispose();
        await branch.cancel();
      }
    } finally {
      sourceStream.dispose();
      await source.cancel();
    }
  });
});

it("captures an idle checkpoint through the session inbox without another model turn", async () => {
  const fixture = await createTestRuntime({ agent: { name: "idle-fork-fixture" } });
  await fixture.run(async () => {
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: { message: "Completed source question" },
        serializedContext: context(),
      },
    ]);
    const sourceStream = captureTurnEvents(source);
    try {
      await sourceStream.nextTurn();
      const ref = {
        sessionId: source.runId,
        beforeTurnId: "turn_1",
        checkpointId: crypto.randomUUID(),
      };
      const receipt = await runtime.dispatchSession({
        sessionId: source.runId,
        command: {
          kind: "checkpoint",
          checkpointId: ref.checkpointId,
          beforeTurnId: ref.beforeTurnId,
        },
      });
      expect(receipt.status).toBe("accepted");
      const capture = await sourceStream.nextTurn();
      expect(
        capture.some((event) => event.type === "turn.started" || event.type === "message.received"),
      ).toBe(false);
      await expect
        .poll(async () => {
          try {
            return (await readSessionCheckpoint(ref)).checkpointId;
          } catch {
            return undefined;
          }
        })
        .toBe(ref.checkpointId);
      const snapshot = await readSessionCheckpoint(ref);
      expect(
        snapshot.snapshot.session.history.some((message) => message.role === "assistant"),
      ).toBe(true);
      const branch = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: { message: "Follow up on the completed answer" },
          fork: ref,
          serializedContext: context(),
        },
      ]);
      const branchStream = captureTurnEvents(branch);
      try {
        const events = await branchStream.nextTurn();
        const reducer = defaultMessageReducer();
        const state = events.reduce(reducer.reduce, reducer.initial());
        expect(
          state.messages
            .filter((message) => message.role === "user")
            .flatMap((message) =>
              message.parts.filter((part) => part.type === "text").map((part) => part.text),
            ),
        ).toEqual(["Completed source question", "Follow up on the completed answer"]);
        expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
        expect((await readSessionCheckpoint(ref)).snapshot).toEqual(snapshot.snapshot);
      } finally {
        branchStream.dispose();
        await branch.cancel();
      }
    } finally {
      sourceStream.dispose();
      await source.cancel();
    }
  });
});
