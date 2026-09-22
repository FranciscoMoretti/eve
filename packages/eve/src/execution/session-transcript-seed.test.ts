import { expect, it } from "vitest";
import { prepareSessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import { defaultMessageReducer } from "#client/message-reducer.js";
import { stampMessageStreamEvent } from "#protocol/message.js";

it("derives paired tools and ordered assistant continuations without executable approval identities", () => {
  const prepared = prepareSessionTranscriptSeed({
    messages: [
      { role: "user", parts: [{ type: "text", text: "Calculate" }] },
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Visible reasoning" },
          {
            type: "dynamic-tool",
            toolName: "calculate",
            input: { n: 2 },
            state: "output-available",
            output: { result: 4 },
          },
          { type: "text", text: "Four" },
          { type: "step-start" },
          {
            type: "dynamic-tool",
            toolName: "failed",
            input: {},
            state: "output-error",
            errorText: "Failure",
          },
          {
            type: "dynamic-tool",
            toolName: "denied",
            input: {},
            state: "output-denied",
            reason: "Not allowed",
          },
        ],
      },
    ],
  });
  expect(prepared.history.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
    "assistant",
    "tool",
  ]);
  expect(prepared.history[2]).toEqual({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "seed_tool_0",
        toolName: "calculate",
        output: { type: "json", value: { result: 4 } },
      },
    ],
  });
  expect(prepared.history.at(-1)).toMatchObject({
    role: "tool",
    content: [
      { toolCallId: "seed_tool_1", output: { type: "error-text", value: "Failure" } },
      { toolCallId: "seed_tool_2", output: { type: "error-text", value: "Not allowed" } },
    ],
  });
  expect(prepared.messages[1]?.parts[1]).toMatchObject({
    state: "output-available",
    toolCallId: "seed_tool_0",
  });
  expect(prepared.messages.every((message) => message.metadata === undefined)).toBe(true);
  expect(JSON.stringify(prepared.history)).not.toContain("approval");
});

it.each([
  { type: "authorization", url: "https://private.example/code" },
  {
    type: "dynamic-tool",
    toolName: "pending",
    input: {},
    state: "approval-requested",
    approval: { id: "private" },
  },
  {
    type: "dynamic-tool",
    toolName: "partial",
    input: {},
    state: "output-available",
    output: {},
    partial: true,
  },
  {
    type: "dynamic-tool",
    toolName: "private",
    input: {},
    state: "output-error",
    errorText: "oops",
    toolMetadata: { private: true },
  },
  { type: "text", text: "unfinished", state: "streaming" },
  { type: "file", mediaType: "application/pdf", url: "eve-sandbox://private/file.pdf" },
])("rejects unresolved or capability-bearing seed parts: %j", (part) => {
  expect(() =>
    prepareSessionTranscriptSeed({ messages: [{ role: "assistant", parts: [part] }] }),
  ).toThrow();
});

it("rejects source identities and system instructions instead of importing hidden state", () => {
  for (const message of [
    { role: "system", parts: [{ type: "text", text: "private instructions" }] },
    { id: "source", role: "user", parts: [{ type: "text", text: "Visible" }] },
    {
      role: "assistant",
      turnId: "source",
      parts: [{ type: "text", text: "Visible" }],
    },
    {
      role: "user",
      parts: [
        { type: "dynamic-tool", toolName: "x", input: {}, state: "output-error", errorText: "x" },
      ],
    },
  ])
    expect(() => prepareSessionTranscriptSeed({ messages: [message] })).toThrow();
});

it("keeps copied image and PDF references in both display and model history", () => {
  const prepared = prepareSessionTranscriptSeed({
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "file",
            url: "https://copies.example/image.png",
            mediaType: "image/png",
            filename: "image.png",
            size: 12,
          },
          {
            type: "file",
            url: "https://copies.example/report.pdf",
            mediaType: "application/pdf",
            filename: "report.pdf",
          },
        ],
      },
    ],
  });
  expect(prepared.history[0]).toEqual({
    role: "user",
    kind: "user",
    content: [
      { type: "image", image: new URL("https://copies.example/image.png"), mediaType: "image/png" },
      {
        type: "file",
        data: new URL("https://copies.example/report.pdf"),
        mediaType: "application/pdf",
        filename: "report.pdf",
      },
    ],
  });
  expect(prepared.messages[0]?.parts[0]).toMatchObject({
    url: "https://copies.example/image.png",
    size: 12,
  });
});

it("replays a seeded prefix idempotently without replacing real destination turns", () => {
  const prepared = prepareSessionTranscriptSeed({
    messages: [{ role: "user", parts: [{ type: "text", text: "Copied question" }] }],
  });
  const reducer = defaultMessageReducer();
  const event = stampMessageStreamEvent({
    type: "history.seeded",
    data: { messages: prepared.messages },
  });
  const first = reducer.reduce(reducer.initial(), event);
  const next = reducer.reduce(
    first,
    stampMessageStreamEvent({
      type: "message.received",
      data: { message: "New question", sequence: 0, turnId: "turn_0" },
    }),
  );
  expect(next.messages).toHaveLength(2);
  expect(reducer.reduce(next, event)).toEqual(next);
  expect(
    reducer.reduce(
      reducer.initial(),
      stampMessageStreamEvent({
        type: "history.restored",
        data: { sourceSessionId: "destination", beforeTurnId: "turn_0", events: [event] },
      }),
    ),
  ).toEqual(first);
});

it("retains informational model provenance without changing executable history", () => {
  const message = { role: "assistant", parts: [{ type: "text", text: "Answer" }] };
  const plain = prepareSessionTranscriptSeed({ messages: [message] });
  const annotated = prepareSessionTranscriptSeed({
    messages: [{ ...message, modelId: "gateway/google/gemini-2.5-flash-lite" }],
  });
  expect(annotated.history).toEqual(plain.history);
  expect(annotated.messages[0]?.metadata).toEqual({
    modelId: "gateway/google/gemini-2.5-flash-lite",
  });
  for (const modelId of ["", "x".repeat(513), 42]) {
    expect(() => prepareSessionTranscriptSeed({ messages: [{ ...message, modelId }] })).toThrow();
  }
  expect(() =>
    prepareSessionTranscriptSeed({
      messages: [
        {
          role: "user",
          modelId: "gateway/model",
          parts: [{ type: "text", text: "Question" }],
        },
      ],
    }),
  ).toThrow();
});

it("retains custom metadata in imported messages without granting framework fields or polluting model history", () => {
  const metadata = {
    chatjs: { selectedTool: null },
    turnId: "fake",
    status: "fake",
    privateMarker: "never-a-prompt",
  };
  const prepared = prepareSessionTranscriptSeed({
    messages: [
      { role: "user", metadata, parts: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        modelId: "real-model",
        metadata,
        parts: [{ type: "text", text: "answer" }],
      },
    ],
  });
  expect(prepared.messages[0]?.metadata).toEqual({ custom: metadata });
  expect(prepared.messages[1]?.metadata).toEqual({ custom: metadata, modelId: "real-model" });
  expect(JSON.stringify(prepared.history)).not.toContain("never-a-prompt");
});

it("preserves validated per-hook annotations in seed display only", () => {
  const annotations = { suggestions: { items: ["annotation-only-marker"] } };
  const prepared = prepareSessionTranscriptSeed({
    messages: [{ role: "assistant", annotations, parts: [{ type: "text", text: "answer" }] }],
  });
  expect(prepared.messages[0]?.metadata?.annotations).toEqual(annotations);
  expect(JSON.stringify(prepared.history)).not.toContain("annotation-only-marker");
  expect(() =>
    prepareSessionTranscriptSeed({
      messages: [
        {
          role: "assistant",
          annotations: { suggestions: [] },
          parts: [{ type: "text", text: "answer" }],
        },
      ],
    }),
  ).toThrow();
});
