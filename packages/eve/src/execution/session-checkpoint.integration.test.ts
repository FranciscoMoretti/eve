import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import { describe, expect, it } from "vitest";
import { start } from "#internal/workflow/runtime.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { sessionCheckpointFixtureWorkflow } from "#internal/testing/durable-session-workflow.js";
import {
  SESSION_CHECKPOINT_NAMESPACE,
  type SessionCheckpoint,
} from "#execution/session-checkpoint-contract.js";

describe("session checkpoint durability", () => {
  it("ferries the writer through context and restores native binary history from its own stream", async () => {
    const runtime = await createTestRuntime({ agent: { name: "checkpoint-fixture" } });
    await runtime.run(async () => {
      const run = await start(sessionCheckpointFixtureWorkflow, []);
      await run.returnValue;
      const restored = await readSessionCheckpoint({
        sessionId: run.runId,
        beforeTurnId: "turn_0",
      });
      expect(restored.snapshot.session.history).toHaveLength(2);
      await expect(
        readSessionCheckpoint({ sessionId: run.runId, beforeTurnId: "turn_99" }),
      ).rejects.toThrow("was not found");
      const reader = run
        .getReadable<SessionCheckpoint>({ namespace: SESSION_CHECKPOINT_NAMESPACE })
        .getReader();
      try {
        const first = await reader.read();
        const second = await reader.read();
        expect(first.value?.sessionId).toBe(run.runId);
        expect(first.value?.beforeTurnId).toBe("turn_0");
        expect(first.value?.snapshot.session.history).toEqual([
          { role: "user", kind: "user", content: "checkpoint message 0" },
          {
            role: "user",
            kind: "user",
            content: [
              { type: "file", mediaType: "application/pdf", data: new Uint8Array([1, 2, 3]) },
            ],
          },
        ]);
        expect(second.value).toEqual(first.value);
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    });
  });
});
