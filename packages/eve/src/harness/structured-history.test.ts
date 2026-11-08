import { expect, it } from "vitest";
import { validateSessionHistory } from "#shared/session-history.js";
import { createImportedHistoryMessages } from "#harness/messages.js";
import { importedMessages } from "#client/messages.js";

it("imports ordered completed tools as data and preserves structured display", () => {
  const history = validateSessionHistory([
    {
      id: "u",
      role: "user",
      parts: [
        { type: "text", text: "Read this" },
        { type: "file", url: "https://files.example/doc", mediaType: "text/plain" },
      ],
    },
    {
      id: "a",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Inspect the supplied file" },
        {
          type: "dynamic-tool",
          toolName: "read",
          input: {},
          state: "output-available",
          output: { value: 42 },
        },
        { type: "text", text: "The result is 42" },
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "write",
          input: {},
          state: "output-denied",
          reason: "No permission",
        },
        {
          type: "dynamic-tool",
          toolName: "other",
          input: {},
          state: "output-error",
          errorText: "Unavailable",
        },
      ],
    },
  ])!;
  const model = createImportedHistoryMessages(history, "delivery-1");
  expect(model.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
    "assistant",
    "tool",
  ]);
  expect(model[2]).toMatchObject({
    content: [
      {
        type: "tool-result",
        toolCallId: "delivery-1:1:1",
        output: { type: "json", value: { value: 42 } },
      },
    ],
  });
  expect(model[5]).toMatchObject({
    content: [
      { output: { type: "error-text", value: "No permission" } },
      { output: { type: "error-text", value: "Unavailable" } },
    ],
  });
  const display = importedMessages("delivery-1", history);
  expect(display[0]).toMatchObject({
    metadata: { imported: true, historyId: "u" },
    parts: [
      { type: "text", text: "Read this" },
      { type: "file", url: "https://files.example/doc" },
    ],
  });
  expect(display[1]?.parts[3]).toMatchObject({
    type: "tool",
    state: "rejected",
    error: { message: "No permission" },
  });
  expect(createImportedHistoryMessages(history, "delivery-2")[2]).toMatchObject({
    content: [{ toolCallId: "delivery-2:1:1" }],
  });
});

it.each([
  { role: "user", parts: [{ type: "reasoning", text: "x" }] },
  {
    role: "assistant",
    parts: [{ type: "dynamic-tool", toolName: "pay", input: {}, state: "approval-requested" }],
  },
  {
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "pay",
        input: {},
        state: "output-available",
        output: {},
        approval: { approved: true },
      },
    ],
  },
  { role: "user", text: "both", parts: [{ type: "text", text: "parts" }] },
])("rejects an executable or ambiguous imported shape", (entry) => {
  expect(() => validateSessionHistory([entry])).toThrow();
});
