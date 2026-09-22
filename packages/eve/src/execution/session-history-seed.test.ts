import { expect, it } from "vitest";
import { createSessionHistorySeed } from "#public/transcript.js";
import { prepareSessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import { prepareSessionTranscriptPrefix } from "#execution/read-session-transcript-prefix.js";

const call = {
  type: "tool-call",
  toolCallId: "original-call",
  toolName: "calculate",
  input: { n: 2 },
};
const result = {
  type: "tool-result",
  toolCallId: "original-call",
  toolName: "calculate",
  output: { type: "json", value: { answer: 4 } },
};
const selected = [
  { role: "user", content: "Calculate" },
  { role: "assistant", content: [call] },
  { role: "tool", content: [result] },
  { role: "assistant", content: "Four" },
];

it("imports selected structured roles with fresh paired identities and deterministic display mapping", () => {
  const imported = createSessionHistorySeed(selected);
  const prepared = prepareSessionTranscriptSeed(imported.seed);
  expect(imported.messageIds).toEqual([
    "seed_message_0",
    "seed_message_1",
    "seed_message_1",
    "seed_message_2",
  ]);
  expect(imported.toolCallIds).toEqual({ "original-call": "seed_tool_0" });
  expect(prepared.history).toEqual([
    { role: "user", kind: "user", content: [{ type: "text", text: "Calculate" }] },
    { role: "assistant", content: [{ ...call, toolCallId: "seed_tool_0" }] },
    { role: "tool", content: [{ ...result, toolCallId: "seed_tool_0" }] },
    { role: "assistant", content: [{ type: "text", text: "Four" }] },
  ]);
  expect(createSessionHistorySeed(selected)).toEqual(imported);
  expect(selected[1]?.content).toEqual([call]);
});

it("permits an empty selected prefix for editing or regenerating the first turn", () => {
  expect(prepareSessionTranscriptSeed(createSessionHistorySeed([]).seed)).toEqual({
    history: [],
    messages: [],
  });
});

it.each(["text", "json", "error-text"])(
  "preserves %s tool outputs including a subsequent imported-prefix fork",
  (type) => {
    const output = { type, value: "plain result" };
    const { seed } = createSessionHistorySeed([
      ...selected.slice(0, 2),
      { role: "tool", content: [{ ...result, output }] },
      { role: "user", content: "replace this" },
    ]);
    const prepared = prepareSessionTranscriptSeed(seed);
    const prefix = prepareSessionTranscriptPrefix(prepared.messages, "seed_message_2");
    expect(prepared.history[2]).toMatchObject({ role: "tool", content: [{ output }] });
    expect(prefix.history[2]).toMatchObject({ role: "tool", content: [{ output }] });
  },
);

it("retains destination-owned file URLs for deferred channel staging, including URL objects", () => {
  const { seed } = createSessionHistorySeed([
    {
      role: "user",
      content: [
        {
          type: "image",
          image: new URL("https://owned.example/image.png"),
          mediaType: "image/png",
        },
        {
          type: "file",
          data: "https://owned.example/report.pdf",
          mediaType: "application/pdf",
          filename: "report.pdf",
        },
      ],
    },
  ]);
  expect(seed.attachments).toBe("channel");
  expect(seed.messages[0]?.parts).toEqual([
    { type: "file", url: "https://owned.example/image.png", mediaType: "image/png" },
    {
      type: "file",
      url: "https://owned.example/report.pdf",
      mediaType: "application/pdf",
      filename: "report.pdf",
    },
  ]);
});

it.each(
  [
    [{ role: "assistant", content: [call] }],
    [{ role: "tool", content: [result] }],
    [
      { role: "assistant", content: [call] },
      { role: "tool", content: [{ ...result, toolCallId: "wrong" }] },
    ],
    [
      { role: "assistant", content: [call] },
      { role: "tool", content: [{ ...result, toolName: "wrong" }] },
    ],
    [...selected, ...selected],
    [{ role: "system", content: "private instructions" }],
    [{ role: "assistant", content: [{ ...call, providerExecuted: true }] }, selected[2]],
    [{ role: "assistant", content: [call, { type: "text", text: "after call" }] }, selected[2]],
    [
      {
        role: "user",
        content: [{ type: "file", data: "file:///private", mediaType: "text/plain" }],
      },
    ],
    [
      {
        role: "user",
        content: [{ type: "file", data: new Uint8Array([1]), mediaType: "text/plain" }],
      },
    ],
    [
      { role: "assistant", content: [call] },
      { role: "tool", content: [{ ...result, output: { type: "content", value: [] } }] },
    ],
  ].map((history) => ({ history })),
)(
  "rejects unsupported or unsettled histories instead of normalizing away semantics: %j",
  ({ history }) => {
    expect(() => createSessionHistorySeed(history)).toThrow();
  },
);

it("rejects oversize histories and malformed text output before creating a native session", () => {
  expect(() =>
    createSessionHistorySeed([{ role: "user", content: "x".repeat(8 * 1024 * 1024) }]),
  ).toThrow("byte limit");
  expect(() =>
    prepareSessionTranscriptSeed({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "x",
              input: {},
              state: "output-available",
              output: {},
              outputType: "text",
            },
          ],
        },
      ],
    }),
  ).toThrow("Text tool output");
});
