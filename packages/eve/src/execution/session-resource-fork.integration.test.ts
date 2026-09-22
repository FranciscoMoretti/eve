import { expect, it } from "vitest";
import { start } from "#internal/workflow/runtime.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { useTemporaryDirectories } from "#internal/testing/use-temporary-app-roots.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";
import { workflowEntry } from "#execution/session/entry.js";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import { createJustBashSandboxBackend } from "#execution/sandbox/bindings/just-bash.js";
import { decodeSandboxRef } from "#internal/attachments/sandbox-refs.js";

const scratch = useTemporaryDirectories();

it("forks a native attachment checkpoint using its earlier bytes and an independent sandbox", async () => {
  const appRoot = await scratch("eve-resource-fork-");
  const local = createJustBashSandboxBackend();
  const fixture = await createTestRuntime({
    agent: { name: "resource-fork" },
    sandboxBackend: {
      ...local,
      create: (input) => local.create({ ...input, runtimeContext: { appRoot } }),
      prewarm: (input) => local.prewarm({ ...input, runtimeContext: { appRoot } }),
    },
  });
  await fixture.run(async () => {
    const serializedContext = {
      "eve.auth": null,
      "eve.bundle": { source: createBundledRuntimeCompiledArtifactsSource() },
      "eve.channel": { kind: "http", state: {} },
      "eve.mode": "conversation",
    };
    const runtime = createWorkflowRuntime({
      compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
    });
    const source = await start(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {
          message: [
            {
              type: "file",
              filename: "sample.pdf",
              mediaType: "application/pdf",
              data: new Uint8Array([0, 255, 10, 128]),
            },
          ],
        },
        serializedContext,
      },
    ]);
    const sourceEvents = captureTurnEvents(source);
    try {
      expect((await sourceEvents.nextTurn()).at(-1)?.type).toBe("session.waiting");
      await runtime.dispatchSession({
        sessionId: source.runId,
        command: { kind: "send", payload: { message: "original second turn" } },
      });
      expect((await sourceEvents.nextTurn()).at(-1)?.type).toBe("session.waiting");
      const fork = { sessionId: source.runId, beforeTurnId: "turn_1" };
      const checkpoint = await readSessionCheckpoint(fork);
      const state = checkpoint.snapshot.session.sandboxState;
      expect(state?.forkCheckpoint?.backendName).toBe("just-bash");
      if (!state?.session) throw new Error("Missing source sandbox");
      const content = checkpoint.snapshot.session.history.find(
        (message) => message.role === "user",
      )?.content;
      if (!Array.isArray(content)) throw new Error("Missing file message");
      const part = content.find((entry) => entry.type === "file");
      if (!part || part.type !== "file" || !(part.data instanceof URL))
        throw new Error("Missing native sandbox file reference");
      const path = decodeSandboxRef(part.data).path;
      const sourceHandle = await local.create({
        runtimeContext: { appRoot },
        sessionKey: state.session.sessionKey,
        existingMetadata: state.session.metadata,
        templateKey: null,
      });
      await sourceHandle.session.writeTextFile({ path, content: "source changed later" });
      const branch = await start(workflowEntry, [
        {
          kind: "initial",
          ownerDeploymentId: "dpl_inline",
          input: { message: "replacement second turn" },
          fork,
          serializedContext,
        },
      ]);
      const branchEvents = captureTurnEvents(branch);
      try {
        expect((await branchEvents.nextTurn()).at(-1)?.type).toBe("session.waiting");
        await runtime.dispatchSession({
          sessionId: branch.runId,
          command: { kind: "send", payload: { message: "check branch state" } },
        });
        expect((await branchEvents.nextTurn()).at(-1)?.type).toBe("session.waiting");
        const restored = await readSessionCheckpoint({
          sessionId: branch.runId,
          beforeTurnId: "turn_2",
        });
        const branchState = restored.snapshot.session.sandboxState?.session;
        if (!branchState) throw new Error("Missing branch sandbox");
        expect(branchState.sessionKey).not.toBe(state.session.sessionKey);
        const branchHandle = await local.create({
          runtimeContext: { appRoot },
          sessionKey: branchState.sessionKey,
          existingMetadata: branchState.metadata,
          templateKey: null,
        });
        try {
          expect(await branchHandle.session.readBinaryFile({ path })).toEqual(
            Buffer.from([0, 255, 10, 128]),
          );
          await branchHandle.session.writeTextFile({ path, content: "branch change" });
          expect(await sourceHandle.session.readTextFile({ path })).toBe("source changed later");
        } finally {
          await branchHandle.shutdown();
        }
      } finally {
        await branchEvents.dispose();
        await branch.cancel();
        await sourceHandle.shutdown();
      }
    } finally {
      await sourceEvents.dispose();
      await source.cancel();
    }
  });
});
