import { beforeEach, expect, it, vi } from "vitest";
import { handleCheckpointReadiness } from "#execution/checkpoint-readiness.js";
import { SessionCheckpointNotFoundError } from "#execution/read-session-checkpoint.js";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("#execution/read-session-checkpoint.js", () => ({
  readSessionCheckpoint: mocks.read,
  SessionCheckpointNotFoundError: class extends Error {},
}));
beforeEach(() => {
  mocks.read.mockReset();
});
const request = (query = "beforeTurnId=turn_0") => new Request(`http://eve/checkpoint?${query}`);
it("keeps the existing before-turn readiness receipt without disclosing checkpoint data", async () => {
  mocks.read.mockResolvedValue({ snapshot: { private: "history" } });
  const response = await handleCheckpointReadiness(request(), "source");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ready: true,
    sessionId: "source",
    beforeTurnId: "turn_0",
  });
  expect(mocks.read).toHaveBeenCalledWith({ sessionId: "source", beforeTurnId: "turn_0" });
});
it.each([
  "",
  "beforeTurnId=turn_01",
  "beforeTurnId=turn_0&beforeTurnId=turn_1",
  "beforeTurnId=turn_0&checkpointId=other",
])("rejects malformed or ambiguous coordinates %s before reading", async (query) => {
  expect((await handleCheckpointReadiness(request(query), "source")).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("distinguishes pending from corrupt snapshots without exposing internal errors", async () => {
  mocks.read.mockRejectedValueOnce(new SessionCheckpointNotFoundError("missing"));
  const pending = await handleCheckpointReadiness(request(), "source");
  expect(pending.status).toBe(404);
  expect(await pending.json()).toEqual({ code: "checkpoint_not_ready" });
  mocks.read.mockRejectedValueOnce(new Error("private corruption detail"));
  const corrupt = await handleCheckpointReadiness(request(), "source");
  expect(corrupt.status).toBe(503);
  expect(await corrupt.json()).toEqual({ error: "Checkpoint lookup is unavailable." });
});
