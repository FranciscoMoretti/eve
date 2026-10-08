import { describe, expect, it } from "vitest";
import type { RunInput } from "#channel/types.js";
import { createSessionCreationAttributes, creationIntent } from "#execution/creation-envelope.js";
import { sessionInboxHookToken } from "#execution/session-inbox/address.js";

const run: RunInput = {
  adapter: { kind: "http" },
  auth: { authenticator: "test", principalType: "user", principalId: "alice", attributes: {} },
  continuationToken: "operation-1",
  input: { message: "hello" },
  mode: "task",
};
function attributes(overrides: Partial<RunInput> = {}, namespace = "test") {
  return createSessionCreationAttributes({
    run: { ...run, ...overrides },
    agentId: "agent",
    namespace,
  });
}

describe("candidate identity", () => {
  it("records the physical alias hook whose insertion claims ownership", () => {
    expect(attributes()["$eve.creation.claim_token"]).toBe(sessionInboxHookToken("operation-1"));
  });

  it("keeps retries stable while isolating principal and namespace", () => {
    const key = attributes()["$eve.creation.key"];
    expect(attributes({ requestId: "retry-trace" })["$eve.creation.key"]).toBe(key);
    expect(
      attributes({
        auth: { authenticator: "test", principalType: "user", principalId: "bob", attributes: {} },
      })["$eve.creation.key"],
    ).not.toBe(key);
    expect(attributes({}, "other")["$eve.creation.key"]).not.toBe(key);
  });

  it("keeps the operation identity when intent changes so admission can reject it", () => {
    const changed = attributes({ input: { message: "different" } });
    expect(changed["$eve.creation.key"]).toBe(attributes()["$eve.creation.key"]);
    expect(changed["$eve.creation.intent"]).not.toBe(attributes()["$eve.creation.intent"]);
    expect(creationIntent({ b: 2, a: { d: 4, c: 3 } })).toBe(
      creationIntent({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
