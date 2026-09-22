import { expect, it } from "vitest";
import { assertSessionCreationSnapshotVersion } from "./session-sandbox-identity-contract.js";

it.each([
  { version: 1, snapshot: { version: 1 } },
  { version: 2, snapshot: { version: 1 } },
  { version: 1, snapshot: { version: 2 } },
  { version: 2 },
  { version: 3, snapshot: { version: 3 } },
])("rejects an uncertified creation result before the driver starts a turn: %j", (state) => {
  expect(() => assertSessionCreationSnapshotVersion(state)).toThrow(
    "unsupported snapshot contract",
  );
});
it("accepts the matching driver and snapshot contract", () => {
  expect(() =>
    assertSessionCreationSnapshotVersion({ version: 2, snapshot: { version: 2 } }),
  ).not.toThrow();
});
