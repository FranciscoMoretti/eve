import { expect, it } from "vitest";
import { decodeSessionInboxPayload } from "#execution/session-inbox/protocol.js";
const request = {
  kind: "checkpoint" as const,
  checkpointId: "00000000-0000-4000-8000-000000000001",
  beforeTurnId: "turn_1",
};
it("preserves immutable checkpoint coordinates and rejects malformed requests", () => {
  expect(decodeSessionInboxPayload(JSON.parse(JSON.stringify(request)))).toEqual(request);
  expect(() => decodeSessionInboxPayload({ ...request, checkpointId: "../bad" })).toThrow(
    "Invalid checkpoint",
  );
});
it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
  "rejects checkpoint commands declared as historic wire %s",
  (version) => {
    expect(() => decodeSessionInboxPayload({ ...request, version })).toThrow();
  },
);
