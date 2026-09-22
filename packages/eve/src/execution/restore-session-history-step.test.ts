import { afterEach, expect, it, vi } from "vitest";
import { restoreSessionHistory } from "#execution/restore-session-history-step.js";
import {
  createMessageReceivedEvent,
  createSessionWaitingEvent,
  createStepCompletedEvent,
  createTurnStartedEvent,
  encodeMessageStreamEvent,
  stampMessageStreamEvent,
  type UnstampedMessageStreamEvent,
} from "#protocol/message.js";

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));
vi.mock("#internal/workflow/runtime.js", () => mocks);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const fork = { sessionId: "source", beforeTurnId: "turn_1" };
function setup(events: UnstampedMessageStreamEvent[], close = true) {
  const cancel = vi.fn();
  mocks.getRun.mockReturnValue({
    getReadable: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events)
            controller.enqueue(encodeMessageStreamEvent(stampMessageStreamEvent(event)));
          if (close) controller.close();
        },
        cancel,
      }),
  });
  const output: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      output.push(chunk);
    },
  });
  return { cancel, writable, output };
}

it("copies only the display prefix without billing events or continuation capabilities", async () => {
  const { writable, output } = setup([
    createMessageReceivedEvent({ message: "inherited", sequence: 0, turnId: "turn_0" }),
    createStepCompletedEvent({
      finishReason: "stop",
      sequence: 0,
      stepIndex: 0,
      turnId: "turn_0",
      usage: { costUsd: 5 },
    }),
    createSessionWaitingEvent("private-continuation"),
    createTurnStartedEvent({ sequence: 1, turnId: "turn_1" }),
    createMessageReceivedEvent({ message: "excluded", sequence: 1, turnId: "turn_1" }),
  ]);
  await restoreSessionHistory({ fork, writable });
  const text = output.map((chunk) => new TextDecoder().decode(chunk)).join("");
  expect(text).toContain('"history.restored"');
  expect(text).toContain("inherited");
  expect(text).not.toContain("private-continuation");
  expect(text).not.toContain("step.completed");
  expect(text).not.toContain("costUsd");
  expect(text).not.toContain("excluded");
  expect(writable.locked).toBe(false);
});

it("writes nothing if the requested turn is missing", async () => {
  const { writable, output } = setup([]);
  await expect(restoreSessionHistory({ fork, writable })).rejects.toThrow("boundary was not found");
  expect(output).toEqual([]);
  expect(writable.locked).toBe(false);
});

it("cancels a stalled source at the deadline without leaving a pending writer", async () => {
  vi.useFakeTimers();
  const { writable, output, cancel } = setup([], false);
  const result = expect(restoreSessionHistory({ fork, writable })).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(cancel).toHaveBeenCalledOnce();
  expect(output).toEqual([]);
  expect(writable.locked).toBe(false);
});

it("bounds raw bytes before buffering an unfinished NDJSON event", async () => {
  const { writable, output } = setup([]);
  const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
  mocks.getRun.mockReturnValue({
    getReadable: () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
      }),
  });
  await expect(restoreSessionHistory({ fork, writable })).rejects.toThrow("byte limit");
  expect(output).toEqual([]);
  expect(writable.locked).toBe(false);
});

it("restores an idle prefix at the exact named marker before any future user turn", async () => {
  const checkpointId = crypto.randomUUID();
  const waiting = createSessionWaitingEvent("private-continuation");
  const { writable, output } = setup(
    [
      createMessageReceivedEvent({
        message: "included idle history",
        sequence: 0,
        turnId: "turn_0",
      }),
      {
        ...waiting,
        data: { ...waiting.data, checkpoint: { checkpointId, beforeTurnId: "turn_1" } },
      },
      createMessageReceivedEvent({
        message: "excluded later history",
        sequence: 1,
        turnId: "turn_1",
      }),
    ],
    false,
  );
  await restoreSessionHistory({ fork: { ...fork, checkpointId }, writable });
  const text = output.map((chunk) => new TextDecoder().decode(chunk)).join("");
  expect(text).toContain("included idle history");
  expect(text).not.toContain("excluded later history");
  expect(text).not.toContain("private-continuation");
});
it("never substitutes an ordinary turn boundary for a named checkpoint", async () => {
  const { writable, output } = setup([createTurnStartedEvent({ sequence: 1, turnId: "turn_1" })]);
  await expect(
    restoreSessionHistory({ fork: { ...fork, checkpointId: crypto.randomUUID() }, writable }),
  ).rejects.toThrow("named checkpoint boundary");
  expect(output).toEqual([]);
});

it("inherits hook annotations without copying auxiliary usage evidence", async () => {
  const { writable, output } = setup([
    {
      type: "hook.result",
      data: {
        hookId: "suggestions",
        turnId: "turn_0",
        responseMetadata: { items: ["Next?"] },
        modelCalls: [{ modelId: "billed-model", usage: { costUsd: 1 } }],
      },
    },
    createTurnStartedEvent({ sequence: 1, turnId: "turn_1" }),
  ]);
  await restoreSessionHistory({ fork, writable });
  const text = output.map((chunk) => new TextDecoder().decode(chunk)).join("");
  expect(text).toContain("Next?");
  expect(text).not.toContain("modelCalls");
  expect(text).not.toContain("billed-model");
});
