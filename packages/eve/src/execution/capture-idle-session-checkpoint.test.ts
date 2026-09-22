import { beforeEach, expect, it, vi } from "vitest";
import { createSession } from "#execution/session.js";
import { setHarnessEmissionState } from "#harness/emission-state.js";
import { captureIdleSessionCheckpoint } from "#execution/capture-idle-session-checkpoint.js";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";
import { writeSessionCheckpoint } from "#execution/session-checkpoint.js";
const records: SessionCheckpoint[] = [];
vi.mock("#internal/workflow/runtime.js", () => ({
  getRun: () => ({
    getReadable: () =>
      Object.assign(
        new ReadableStream({
          start(controller) {
            for (const row of records) controller.enqueue(row);
            controller.close();
          },
        }),
        { getTailIndex: () => Promise.resolve(records.length - 1) },
      ),
  }),
}));
beforeEach(() => {
  records.length = 0;
});
const request = {
  kind: "checkpoint" as const,
  checkpointId: "00000000-0000-4000-8000-000000000001",
  beforeTurnId: "turn_1",
};
function fixture(turnId = "", sequence = 1) {
  const session = setHarnessEmissionState(
    createSession({
      sessionId: "source",
      continuationToken: "source",
      turnAgent: {
        id: "test",
        instructions: [],
        model: { id: "test" },
        tools: [],
        workspaceSpec: { rootEntries: [] },
      },
    }),
    { sessionStarted: true, sequence, stepIndex: 0, turnId },
  );
  session.history.push(
    { role: "user", kind: "user", content: "Question" },
    { role: "assistant", content: "Completed answer" },
  );
  const target = {
    sessionId: "source",
    writable: new WritableStream<SessionCheckpoint>({
      write(row) {
        records.push(structuredClone(row));
      },
    }),
  };
  return { session, target, request, prepare: vi.fn(() => Promise.resolve()) };
}
it("captures completed idle history with no new message and retries the same immutable checkpoint", async () => {
  const input = fixture();
  await captureIdleSessionCheckpoint(input);
  expect(records).toHaveLength(1);
  expect(records[0]?.snapshot.session.history).toEqual(input.session.history);
  expect(input.prepare).toHaveBeenCalledTimes(1);
  input.session.history.push({ role: "user", kind: "user", content: "Later" });
  await captureIdleSessionCheckpoint({
    ...input,
    session: setHarnessEmissionState(input.session, {
      sessionStarted: true,
      sequence: 2,
      stepIndex: 0,
      turnId: "",
    }),
  });
  expect(records).toHaveLength(1);
  expect(input.prepare).toHaveBeenCalledTimes(1);
  await writeSessionCheckpoint({ ...input, delivery: { message: "Ordinary next turn" } });
  expect(records).toHaveLength(2);
  expect(
    (await readSessionCheckpoint({ sessionId: "source", ...request })).snapshot.session.history,
  ).toHaveLength(2);
  expect(
    (await readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_1" })).snapshot.session
      .history,
  ).toHaveLength(3);
});
it.each([
  ["turn_1", 1, "source_not_idle"],
  ["", 2, "source_advanced"],
])(
  "rejects unsafe boundary %s/%s without running preparation",
  async (turnId, sequence, reason) => {
    const input = fixture(String(turnId), Number(sequence));
    await captureIdleSessionCheckpoint(input);
    expect(input.prepare).not.toHaveBeenCalled();
    expect(records[0]?.rejected).toBe(reason);
    await expect(readSessionCheckpoint({ sessionId: "source", ...request })).rejects.toThrow(
      String(reason),
    );
    await captureIdleSessionCheckpoint(input);
    expect(records).toHaveLength(1);
  },
);
it("does not publish a checkpoint when application snapshot preparation fails", async () => {
  const input = fixture();
  input.prepare.mockRejectedValueOnce(new Error("Document snapshot failed"));
  await expect(captureIdleSessionCheckpoint(input)).rejects.toThrow("Document snapshot failed");
  expect(records).toHaveLength(0);
  await captureIdleSessionCheckpoint(input);
  expect(records).toHaveLength(1);
});
