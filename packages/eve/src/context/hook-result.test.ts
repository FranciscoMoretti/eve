import { expect, it } from "vitest";
import { createHookResultEvent } from "./hook-result.js";

it("retains response metadata for historical display", () => {
  expect(
    createHookResultEvent("suggestions", "turn_0", {
      responseMetadata: { followupSuggestions: ["Next?"] },
    }),
  ).toEqual({
    type: "hook.result",
    data: {
      hookId: "suggestions",
      turnId: "turn_0",
      responseMetadata: { followupSuggestions: ["Next?"] },
    },
  });
});
it.each([{}, { responseMetadata: undefined }, { responseMetadata: "invalid" }])(
  "omits absent or invalid display metadata",
  (value) => {
    expect(createHookResultEvent("suggestions", "turn_0", value)).toBeUndefined();
  },
);
it("rejects removed monetary hook payloads", () => {
  expect(() =>
    createHookResultEvent("suggestions", "turn_0", { modelCalls: [{ modelId: "paid" }] }),
  ).toThrow();
});
