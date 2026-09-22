import { afterEach, expect, it, vi } from "vitest";
import { prepareSessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import {
  prepareSessionTranscriptPrefix,
  readSessionTranscriptPrefix,
} from "#execution/read-session-transcript-prefix.js";
import {
  encodeMessageStreamEvent,
  stampMessageStreamEvent,
  type UnstampedMessageStreamEvent,
} from "#protocol/message.js";
const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));
vi.mock("#internal/workflow/runtime.js", () => mocks);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const prepared = prepareSessionTranscriptSeed({
  attachments: "channel",
  messages: [
    {
      role: "user",
      parts: [
        { type: "text", text: "keep question" },
        { type: "file", url: "https://owned.test/a.pdf", mediaType: "application/pdf" },
      ],
    },
    {
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "read",
          state: "output-available",
          input: {},
          output: { text: "kept result" },
        },
        { type: "text", text: "keep answer" },
      ],
    },
    { role: "user", parts: [{ type: "text", text: "replace question" }] },
    { role: "assistant", parts: [{ type: "text", text: "exclude answer" }] },
  ],
});
function setup(event: UnstampedMessageStreamEvent, close = true) {
  const cancel = vi.fn();
  mocks.getRun.mockReturnValue({
    getReadable: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encodeMessageStreamEvent(stampMessageStreamEvent(event)));
          if (close) controller.close();
        },
        cancel,
      }),
  });
  return cancel;
}
it("reconstructs only complete imported prefix and keeps attachment staging deferred", () => {
  const result = prepareSessionTranscriptPrefix(prepared.messages, "seed_message_2");
  expect(result.messages).toEqual(prepared.messages.slice(0, 2));
  expect(result.history).toEqual(prepared.history.slice(0, 4));
  expect(JSON.stringify(result)).not.toContain("replace question");
  expect(JSON.stringify(result.history)).toContain("https://owned.test/a.pdf");
  expect(prepareSessionTranscriptPrefix(prepared.messages, "seed_message_0")).toEqual({
    history: [],
    messages: [],
  });
});
it.each(["seed_message_1", "seed_message_99", "turn_0", "seed_message_02"])(
  "rejects non-user or unknown boundary %s",
  (id) => {
    expect(() => prepareSessionTranscriptPrefix(prepared.messages, id)).toThrow();
  },
);
it("reads inherited seed without taking later turns or live source state", async () => {
  setup({
    type: "history.restored",
    data: {
      sourceSessionId: "ancestor",
      beforeTurnId: "turn_0",
      events: [
        stampMessageStreamEvent({ type: "history.seeded", data: { messages: prepared.messages } }),
      ],
    },
  });
  const result = await readSessionTranscriptPrefix({
    sessionId: "source",
    beforeMessageId: "seed_message_2",
  });
  expect(result.messages).toEqual(prepared.messages.slice(0, 2));
});
it("fails closed without seeded history", async () => {
  setup({ type: "history.seeded", data: { messages: [] } });
  await expect(
    readSessionTranscriptPrefix({ sessionId: "source", beforeMessageId: "seed_message_0" }),
  ).rejects.toThrow();
});
it("bounds a stalled source and cancels its reader", async () => {
  vi.useFakeTimers();
  const cancel = setup({ type: "session.started", data: {} }, false);
  const result = readSessionTranscriptPrefix({
    sessionId: "source",
    beforeMessageId: "seed_message_0",
  });
  const rejected = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10_001);
  await rejected;
  expect(cancel).toHaveBeenCalled();
});

it("preserves only model provenance through repeated imported forks", () => {
  const seed = prepareSessionTranscriptSeed({
    messages: [
      { role: "user", parts: [{ type: "text", text: "First" }] },
      {
        role: "assistant",
        modelId: "gateway/google/gemini-2.5-flash-lite",
        parts: [{ type: "text", text: "Answer" }],
      },
      { role: "user", parts: [{ type: "text", text: "Second" }] },
      { role: "assistant", parts: [{ type: "text", text: "Later" }] },
      { role: "user", parts: [{ type: "text", text: "Third" }] },
    ],
  });
  const messages = seed.messages.map((message) =>
    message.role === "assistant"
      ? { ...message, metadata: { ...message.metadata, turnId: "private", result: "private" } }
      : message,
  );
  const first = prepareSessionTranscriptPrefix(messages, "seed_message_4");
  const second = prepareSessionTranscriptPrefix(first.messages, "seed_message_2");
  expect(second.messages[1]?.metadata).toEqual({ modelId: "gateway/google/gemini-2.5-flash-lite" });
  expect(second.messages).toHaveLength(2);
  expect(second.history).toEqual(
    prepareSessionTranscriptSeed({
      messages: [
        { role: "user", parts: [{ type: "text", text: "First" }] },
        { role: "assistant", parts: [{ type: "text", text: "Answer" }] },
      ],
    }).history,
  );
});

it("retains custom metadata when an imported transcript is forked before a later user message", () => {
  const custom = { chatjs: { selectedTool: "canvas" } };
  const prefix = prepareSessionTranscriptPrefix(
    [
      {
        id: "seed_message_0",
        role: "user",
        metadata: { custom },
        parts: [{ type: "text", text: "first" }],
      },
      { id: "seed_message_1", role: "assistant", parts: [{ type: "text", text: "answer" }] },
      { id: "seed_message_2", role: "user", parts: [{ type: "text", text: "edit this" }] },
    ],
    "seed_message_2",
  );
  expect(prefix.messages[0]?.metadata?.custom).toEqual(custom);
  expect(JSON.stringify(prefix.history)).not.toContain("selectedTool");
});

it("preserves hook annotation namespaces in imported-prefix forks", () => {
  const annotations = { suggestions: { items: ["Next?"] } };
  const result = prepareSessionTranscriptPrefix(
    [
      {
        id: "seed_message_0",
        role: "assistant",
        metadata: { annotations },
        parts: [{ type: "text", text: "answer" }],
      },
      { id: "seed_message_1", role: "user", parts: [{ type: "text", text: "edit" }] },
    ],
    "seed_message_1",
  );
  expect(result.messages[0]?.metadata?.annotations).toEqual(annotations);
  expect(JSON.stringify(result.history)).not.toContain("Next?");
});
