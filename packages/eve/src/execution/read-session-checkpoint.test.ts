import { afterEach, expect, it, vi } from "vitest";
import { readSessionCheckpoint } from "#execution/read-session-checkpoint.js";
import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));
vi.mock("#internal/workflow/runtime.js", () => mocks);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function checkpoint(): SessionCheckpoint {
  return {
    version: 1,
    sessionId: "source",
    beforeTurnId: "turn_0",
    snapshot: {
      version: 2,
      session: {
        sessionId: "source",
        continuationToken: "",
        history: [],
        agent: { system: "current" },
      },
    },
  };
}
function install(values: unknown[], tail = values.length - 1) {
  const cancel = vi.fn();
  let index = 0;
  const stream = Object.assign(
    new ReadableStream<unknown>({
      pull(controller) {
        const value = values[index++];
        if (value) controller.enqueue(value);
      },
      cancel,
    }),
    { getTailIndex: async () => tail },
  );
  mocks.getRun.mockReturnValue({ getReadable: () => stream });
  return { stream, cancel };
}

it("accepts identical retry records without waiting for the live stream to finish", async () => {
  const value = checkpoint();
  const { stream, cancel } = install([value, value]);
  await expect(
    readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" }),
  ).resolves.toEqual(value);
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it("rejects conflicting retries and foreign session records", async () => {
  const value = checkpoint();
  install([
    value,
    {
      ...value,
      snapshot: {
        ...value.snapshot,
        session: { ...value.snapshot.session, history: [{ role: "user", content: "different" }] },
      },
    },
  ]);
  await expect(
    readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" }),
  ).rejects.toThrow("Conflicting");
  install([{ ...value, sessionId: "other" }]);
  await expect(
    readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" }),
  ).rejects.toThrow("identity");
});

it("bounds oversized and missing checkpoint scans", async () => {
  install([], 1_000);
  await expect(
    readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" }),
  ).rejects.toThrow("scan limit");
  install([]);
  await expect(
    readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" }),
  ).rejects.toThrow("not found");
});

it("times out stalled reads even when stream cancellation never settles", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const stream = Object.assign(new ReadableStream<unknown>({ cancel }), {
    getTailIndex: async () => 0,
  });
  mocks.getRun.mockReturnValue({ getReadable: () => stream });
  const result = expect(
    readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" }),
  ).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});

it("reads historical checkpoints without certifying their optional birth identity", async () => {
  const current = checkpoint();
  const historical = {
    ...current,
    snapshot: {
      ...current.snapshot,
      version: 1,
      session: {
        ...current.snapshot.session,
        localSandboxIdentity: {
          version: 1,
          backendName: "microsandbox",
          appRoot: "/old",
          sessionId: "source",
        },
      },
    },
  };
  install([historical]);
  const restored = await readSessionCheckpoint({ sessionId: "source", beforeTurnId: "turn_0" });
  expect(restored.snapshot.version).toBe(2);
  expect(restored.snapshot.session.localSandboxIdentity).toBeUndefined();
  expect(restored.snapshot.session.history).toEqual(historical.snapshot.session.history);
});
