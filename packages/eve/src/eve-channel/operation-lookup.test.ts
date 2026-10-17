import type { Session } from "#channel/session.js";
import { expect, it, vi } from "vitest";
import { eveChannel } from "#public/channels/eve.js";
import { none } from "#public/channels/auth.js";
import type { SessionAuthContext } from "#channel/types.js";
import { mockAgentRouteArgs } from "#internal/testing/mocks/mock-route-args.js";
import { mockChannelContext } from "#internal/testing/mocks/mock-channel-operations.js";
import { deriveOperationContinuationToken } from "#eve-channel/request.js";

it("looks up only the authenticated operation without creating or dispatching", async () => {
  const owner: SessionAuthContext = {
    attributes: {},
    authenticator: "fixture",
    principalId: "owner",
    principalType: "user",
  };
  const token = await deriveOperationContinuationToken({ auth: owner, operationId: "operation" });
  const send = vi.fn(() => {
    throw new Error("Lookup must not dispatch");
  });
  const operations = mockChannelContext(send);
  const resolveSession = vi.fn(async (candidate: string) =>
    candidate === token
      ? ({
          id: "existing",
          send,
          respond: send,
          cancel: send,
          compact: send,
          clear: send,
          reset: send,
          getEventStream: send,
          getStreamTailIndex: send,
        } satisfies Session)
      : undefined,
  );
  for (const [auth, status] of [
    [owner, 200],
    [{ ...owner, principalId: "foreign" }, 409],
  ] as const) {
    const channel = eveChannel({ auth: () => auth });
    const route = channel.routes.find(
      (route) => route.method === "GET" && route.path === "/eve/v1/operation/:operationId",
    );
    expect(route, "read-only operation lookup route").toBeDefined();
    if (!route) throw new Error("Missing operation lookup");
    const response = await route.handler(
      new Request("https://example.test/eve/v1/operation/operation"),
      {
        ...mockAgentRouteArgs(),
        ...operations,
        attachSession: send,
        to: send,
        waitUntil: send,
        requestIp: null,
        params: { operationId: "operation" },
        resolveSession,
      },
    );
    if (!(response instanceof Response)) throw new Error("Expected HTTP response");
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject(
      status === 200 ? { sessionId: "existing" } : { code: "eve_operation_unresolved" },
    );
  }
  expect(send).not.toHaveBeenCalled();
});

it("rejects anonymous operation lookup and unsupported query modes before resolution", async () => {
  const resolveSession = vi.fn();
  const send = vi.fn(() => {
    throw new Error("Lookup must not dispatch");
  });
  for (const query of ["", "?kind=seed", "?owner=foreign"]) {
    const channel = eveChannel({
      auth:
        query === ""
          ? none()
          : () => ({
              attributes: {},
              authenticator: "fixture",
              principalId: "owner",
              principalType: "user",
            }),
    });
    const route = channel.routes.find(
      (route) => route.method === "GET" && route.path === "/eve/v1/operation/:operationId",
    );
    expect(route, "read-only operation lookup route").toBeDefined();
    if (!route) throw new Error("Missing operation lookup");
    const response = await route.handler(
      new Request(`https://example.test/eve/v1/operation/operation${query}`),
      {
        ...mockAgentRouteArgs(),
        ...mockChannelContext(send),
        attachSession: send,
        to: send,
        waitUntil: send,
        requestIp: null,
        params: { operationId: "operation" },
        resolveSession,
      },
    );
    if (!(response instanceof Response)) throw new Error("Expected HTTP response");
    expect(response.status).toBe(400);
  }
  expect(resolveSession).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
