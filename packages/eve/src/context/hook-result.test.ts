import { expect, it } from "vitest";
import { createHookResultEvent } from "#context/hook-result.js";

it("retains every attempt while stripping provider secrets and invalid usage", () => {
  const event = createHookResultEvent("suggestions", "turn_2", {
    modelCalls: [
      {
        modelId: "model-a",
        usage: {
          inputTokens: 10,
          outputTokens: -1,
          inputTokenDetails: { cacheReadTokens: 2, cacheWriteTokens: Infinity },
        },
        providerMetadata: {
          gateway: { cost: "0.002", generationId: "generation-1", secret: "hidden" },
          provider: { secret: "hidden" },
        },
      },
      { modelId: "model-b", failed: true },
      { modelId: "model-c", providerMetadata: { gateway: { cost: " " } } },
    ],
  });
  expect(event).toEqual({
    type: "hook.result",
    data: {
      hookId: "suggestions",
      turnId: "turn_2",
      modelCalls: [
        {
          modelId: "model-a",
          usage: { inputTokens: 10, cacheReadTokens: 2, costUsd: 0.002 },
          providerMetadata: { gateway: { generationId: "generation-1" } },
        },
        { modelId: "model-b", failed: true, usage: undefined, providerMetadata: undefined },
        { modelId: "model-c", usage: undefined, providerMetadata: undefined },
      ],
    },
  });
  expect(JSON.stringify(event)).not.toContain("hidden");
});
it("preserves explicit null annotation values and detaches authored objects", () => {
  const value = { suggestions: null };
  const event = createHookResultEvent("a", "turn_0", { responseMetadata: value });
  expect(event?.data.responseMetadata).toEqual(value);
  expect(event?.data.responseMetadata).not.toBe(value);
  expect(createHookResultEvent("a", "turn_0", {})).toBeUndefined();
});
it.each([
  { custom: {} },
  { modelCalls: [{ modelId: "" }] },
  { modelCalls: [{ modelId: "a", failed: "yes" }] },
  { modelCalls: Array.from({ length: 101 }, () => ({ modelId: "a" })) },
])("rejects malformed or oversized authored results", (value) => {
  expect(() => createHookResultEvent("a", "turn_0", value)).toThrow();
});

it.each([[], null, { invalid: Infinity }])(
  "omits invalid display metadata while retaining paid model evidence",
  (responseMetadata) => {
    const modelCalls = [{ modelId: "paid-model", providerMetadata: { gateway: { cost: "0.01" } } }];
    const event = createHookResultEvent("suggestions", "turn_0", { responseMetadata, modelCalls });
    expect(event?.data.responseMetadata).toBeUndefined();
    expect(event?.data.modelCalls?.[0]?.usage?.costUsd).toBe(0.01);
    expect(createHookResultEvent("suggestions", "turn_0", { responseMetadata })).toBeUndefined();
  },
);
