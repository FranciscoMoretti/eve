import { beforeEach, expect, it, vi } from "vitest";
import { handleSandboxIdentityRead } from "#execution/sandbox-identity-read.js";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("#execution/read-session-sandbox-identity.js", () => ({
  readSessionSandboxIdentity: mocks.read,
}));
beforeEach(() => {
  mocks.read.mockReset();
});
it("returns only validated birth evidence without caching", async () => {
  const local = {
    version: 1,
    appRoot: "/worker",
    backendName: "microsandbox",
    sessionId: "session",
  };
  mocks.read.mockResolvedValue(local);
  const response = await handleSandboxIdentityRead(new Request("http://eve/identity"), "session");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    version: 1,
    snapshotVersion: 2,
    sessionId: "session",
    local,
  });
  expect(mocks.read).toHaveBeenCalledWith("session");
});
it("rejects unexpected query input before reading", async () => {
  const response = await handleSandboxIdentityRead(
    new Request("http://eve/identity?sessionId=other"),
    "session",
  );
  expect(response.status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("does not disclose corruption details and never certifies a failed lookup", async () => {
  mocks.read.mockRejectedValue(new Error("private details"));
  const response = await handleSandboxIdentityRead(new Request("http://eve/identity"), "session");
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "Sandbox identity evidence is unavailable." });
});
