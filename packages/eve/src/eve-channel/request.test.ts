import { describe, expect, it } from "vitest";

import { parseCreateBody, parseSessionMessageBody } from "#eve-channel/request.js";

describe("parseCreateBody", () => {
  it("accepts a conversation session without a message", () => {
    expect(parseCreateBody({})).toEqual({
      activityObserver: undefined,
      callback: undefined,
      capabilities: undefined,
      context: undefined,
      mode: undefined,
      outputSchema: undefined,
    });
  });

  it("rejects an explicitly empty message", async () => {
    const response = parseCreateBody({ message: "" });
    expect(response).toBeInstanceOf(Response);
    await expect((response as Response).json()).resolves.toMatchObject({
      error: "Expected 'message' to be non-empty when provided.",
    });
  });

  it("rejects turn-only fields without a message", async () => {
    const response = parseCreateBody({ clientContext: "page context" });
    expect(response).toBeInstanceOf(Response);
    await expect((response as Response).json()).resolves.toMatchObject({
      error: expect.stringContaining("does not accept"),
    });
  });

  it("requires a message for task mode", async () => {
    const response = parseCreateBody({ mode: "task" });
    expect(response).toBeInstanceOf(Response);
    await expect((response as Response).json()).resolves.toMatchObject({
      error: "Task sessions require a non-empty 'message'.",
    });
  });
});

it("accepts a named fork while preserving its exact coordinates", () => {
  const fork = { sessionId: "source", beforeTurnId: "turn_1", checkpointId: crypto.randomUUID() };
  const result = parseCreateBody({ message: "follow-up", fork });
  expect(result).not.toBeInstanceOf(Response);
  expect(result).toMatchObject({ fork });
});
it.each([{ checkpointId: "../invalid" }, { extra: true }])(
  "rejects malformed named forks or unknown fields %j",
  (extra) => {
    const result = parseCreateBody({
      message: "follow-up",
      fork: { sessionId: "source", beforeTurnId: "turn_1", ...extra },
    });
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("Expected rejection");
    expect(result.status).toBe(400);
  },
);

it("accepts only an opaque operation for a server-authorized idle seed", () => {
  expect(parseCreateBody({ seed: true, operationId: "copy-1" })).toEqual({
    seed: true,
    operationId: "copy-1",
    mode: "conversation",
  });
});
it.each([
  { seed: false, operationId: "copy-1", message: "ordinary" },
  { seed: { messages: [] }, operationId: "copy-1" },
  { seed: true },
  { seed: true, operationId: "" },
  { seed: true, operationId: "x".repeat(257) },
  ...[
    "message",
    "messages",
    "fork",
    "callback",
    "mode",
    "capabilities",
    "clientContext",
    "outputSchema",
    "activityObserver",
    "sourceSessionId",
    "forwardedPrincipal",
  ].map((field) => ({ seed: true, operationId: "copy-1", [field]: {} })),
])("rejects seed payload data or execution options: %j", (payload) => {
  const result = parseCreateBody(payload);
  expect(result).toBeInstanceOf(Response);
  if (!(result instanceof Response)) throw new Error("Expected rejection");
  expect(result.status).toBe(400);
});
it("accepts an imported boundary without mixing execution checkpoint coordinates", () => {
  const fork = { sessionId: "owned-source", beforeMessageId: "seed_message_2" };
  expect(parseCreateBody({ message: "replacement", fork })).toMatchObject({ fork });
  for (const extra of [
    { beforeTurnId: "turn_0" },
    { checkpointId: crypto.randomUUID() },
    { beforeMessageId: "seed_message_01" },
    { beforeMessageId: "seed_message_10000" },
  ]) {
    const result = parseCreateBody({ message: "replacement", fork: { ...fork, ...extra } });
    expect(result).toBeInstanceOf(Response);
  }
});

it("preserves detached JSON message metadata on creation and subsequent messages", () => {
  const metadata = { chatjs: { selectedTool: null }, turnId: "untrusted", status: "spoofed" };
  for (const parse of [parseCreateBody, parseSessionMessageBody]) {
    const parsed = parse({ message: "hello", messageMetadata: metadata });
    expect(parsed).not.toBeInstanceOf(Response);
    expect(parsed).toMatchObject({ messageMetadata: metadata });
    if (parsed instanceof Response) throw new Error("Unexpected rejection");
    expect(parsed.messageMetadata).not.toBe(metadata);
  }
});
it.each([null, [], "canvas", 42, { invalid: Number.NaN }])(
  "rejects invalid message metadata: %j",
  (messageMetadata) => {
    for (const parse of [parseCreateBody, parseSessionMessageBody]) {
      expect(parse({ message: "hello", messageMetadata })).toBeInstanceOf(Response);
    }
  },
);
it("rejects message metadata on control-only input responses", () => {
  expect(
    parseSessionMessageBody({
      inputResponses: [{ requestId: "approval", optionId: "yes" }],
      messageMetadata: {},
    }),
  ).toBeInstanceOf(Response);
});
