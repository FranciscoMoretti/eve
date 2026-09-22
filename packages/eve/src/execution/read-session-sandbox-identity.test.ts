import { afterEach, expect, it, vi } from "vitest";
import { readSessionSandboxIdentity } from "#execution/read-session-sandbox-identity.js";

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));
vi.mock("#internal/workflow/runtime.js", () => mocks);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const local = { version: 1, sessionId: "source", appRoot: "/worker", backendName: "microsandbox" };
const receipt = { version: 1, snapshotVersion: 2, sessionId: "source", local };
function install(values: unknown[], tail = values.length - 1) {
  const cancel = vi.fn();
  let index = 0;
  const stream = Object.assign(
    new ReadableStream<unknown>({
      pull(controller) {
        if (index < values.length) controller.enqueue(values[index++]);
      },
      cancel,
    }),
    { getTailIndex: async () => tail },
  );
  const getReadable = vi.fn(() => stream);
  mocks.getRun.mockReturnValue({ getReadable });
  return { stream, cancel, getReadable };
}

it("reads identical retries without waiting for stream closure", async () => {
  const { stream, cancel, getReadable } = install([receipt, structuredClone(receipt)]);
  await expect(readSessionSandboxIdentity("source")).resolves.toEqual(local);
  expect(mocks.getRun).toHaveBeenCalledWith("source");
  expect(getReadable).toHaveBeenCalledWith({ namespace: "eve.sandbox-identity" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});
it.each([
  null,
  [],
  {},
  { ...receipt, version: 2 },
  { ...receipt, snapshotVersion: 1 },
  { ...receipt, sessionId: "foreign" },
  { ...receipt, local: null },
  { ...receipt, local: { ...local, sessionId: "foreign" } },
  { ...receipt, local: { ...local, appRoot: "relative" } },
  { ...receipt, local: { ...local, appRoot: "/bad\0root" } },
  { ...receipt, local: { ...local, backendName: "" } },
])("rejects uncertified receipt %#", async (invalid) => {
  install([receipt, invalid]);
  await expect(readSessionSandboxIdentity("source")).rejects.toThrow();
});
it.each(["appRoot", "backendName"])(
  "rejects conflicting %s across creation attempts",
  async (field) => {
    install([receipt, { ...receipt, local: { ...local, [field]: "/different" } }]);
    await expect(readSessionSandboxIdentity("source")).rejects.toThrow("Conflicting");
  },
);
it.each([-2, 0.5, NaN, Infinity, 100])("rejects invalid or excessive tail %s", async (tail) => {
  const { cancel } = install([], tail);
  await expect(readSessionSandboxIdentity("source")).rejects.toThrow("scan limit");
  expect(cancel).toHaveBeenCalledOnce();
});
it("rejects missing evidence", async () => {
  install([]);
  await expect(readSessionSandboxIdentity("source")).rejects.toThrow("not found");
});
it("rejects a truncated prefix", async () => {
  const stream = Object.assign(
    new ReadableStream({
      start(c) {
        c.close();
      },
    }),
    { getTailIndex: async () => 0 },
  );
  mocks.getRun.mockReturnValue({ getReadable: () => stream });
  await expect(readSessionSandboxIdentity("source")).rejects.toThrow("ended unexpectedly");
  expect(stream.locked).toBe(false);
});
it.each(["tail", "read"])(
  "bounds stalled %s even if cancellation never resolves",
  async (stall) => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = Object.assign(new ReadableStream<unknown>({ cancel }), {
      getTailIndex: () => (stall === "tail" ? new Promise<number>(() => {}) : Promise.resolve(0)),
    });
    mocks.getRun.mockReturnValue({ getReadable: () => stream });
    const result = expect(readSessionSandboxIdentity("source")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  },
);
