import { expect, it } from "vitest";
import { decodeSessionInboxPayload } from "#execution/session-inbox/protocol.js";
it("roundtrips metadata through durable inbox JSON without treating it as authentication", () => {
  const command = {
    kind: "send" as const,
    auth: null,
    payload: {
      message: "hello",
      messageMetadata: { chatjs: { selectedTool: null }, auth: { principalId: "spoof" } },
    },
  };
  const decoded = decodeSessionInboxPayload(JSON.parse(JSON.stringify(command)));
  expect(decoded).toMatchObject({ kind: "deliver", auth: null, payloads: [command.payload] });
});
