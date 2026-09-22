import { z } from "#compiled/zod/index.js";
import {
  parseSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";

const withoutEmptyProviderOptions = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "providerOptions" in value
    ) {
      const { providerOptions, ...content } = value;
      if (
        providerOptions === undefined ||
        (providerOptions !== null &&
          typeof providerOptions === "object" &&
          !Array.isArray(providerOptions) &&
          Object.keys(providerOptions).length === 0)
      )
        return content;
    }
    return value;
  }, schema);
const text = withoutEmptyProviderOptions(
  z.strictObject({ type: z.literal("text"), text: z.string() }),
);
const reasoning = withoutEmptyProviderOptions(
  z.strictObject({ type: z.literal("reasoning"), text: z.string() }),
);
const url = z.preprocess((value) => (value instanceof URL ? value.href : value), z.url());
const file = withoutEmptyProviderOptions(
  z.strictObject({
    type: z.literal("file"),
    data: url,
    mediaType: z.string().min(1),
    filename: z.string().optional(),
  }),
);
const image = withoutEmptyProviderOptions(
  z.strictObject({
    type: z.literal("image"),
    image: url,
    mediaType: z.string().startsWith("image/"),
  }),
);
const call = withoutEmptyProviderOptions(
  z.strictObject({
    type: z.literal("tool-call"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.json(),
  }),
);
const result = withoutEmptyProviderOptions(
  z.strictObject({
    type: z.literal("tool-result"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    output: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("json"), value: z.json() }),
      z.strictObject({ type: z.literal("text"), value: z.string() }),
      z.strictObject({ type: z.literal("error-text"), value: z.string() }),
    ]),
  }),
);
const historySchema = z
  .array(
    z.discriminatedUnion("role", [
      z.strictObject({
        role: z.literal("user"),
        kind: z.literal("user").optional(),
        content: z.union([z.string(), z.array(z.union([text, file, image])).min(1)]),
      }),
      z.strictObject({
        role: z.literal("assistant"),
        content: z.union([z.string(), z.array(z.union([text, reasoning, file, call])).min(1)]),
      }),
      z.strictObject({ role: z.literal("tool"), content: z.array(result).min(1) }),
    ]),
  )
  .max(10_000);

type SeedMessage = SessionTranscriptSeed["messages"][number];
type AssistantSeed = Extract<SeedMessage, { role: "assistant" }>;

/**
 * Converts a trusted, selected, settled conversation into a fresh idle-session seed.
 * This is a bounded normalizer, not a historical reader or runtime checkpoint.
 * Unsupported provider-specific data, system messages, binary files, live approvals,
 * and incomplete tool batches reject rather than silently changing model context.
 * File URLs must already belong to the destination; channel authorization is used
 * on first continuation. Returned message IDs are scoped to the new session.
 */
export function createSessionHistorySeed(value: unknown): {
  readonly seed: SessionTranscriptSeed;
  readonly messageIds: readonly string[];
  readonly toolCallIds: Readonly<Record<string, string>>;
} {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 8 * 1024 * 1024)
    throw new Error("Session history byte limit exceeded.");
  const history = historySchema.parse(value);
  const messages: SeedMessage[] = [];
  const messageIds: string[] = [];
  const toolCallIds: Record<string, string> = Object.create(null);
  let toolSequence = 0;
  for (let index = 0; index < history.length; index++) {
    const message = history[index]!;
    const messageId = `seed_message_${messages.length}`;
    if (message.role === "tool") throw new Error("Unpaired tool results in session history.");
    messageIds.push(messageId);
    if (message.role === "user") {
      const content =
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content;
      messages.push({
        role: "user",
        parts: content.map((part) => {
          if (part.type === "text") return part;
          return {
            type: "file",
            url: part.type === "image" ? part.image : part.data,
            mediaType: part.mediaType,
            ...(part.type === "file" && part.filename !== undefined
              ? { filename: part.filename }
              : {}),
          };
        }),
      });
      continue;
    }
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    const calls = content.filter((part) => part.type === "tool-call");
    const next = history[index + 1];
    if (calls.length && (next?.role !== "tool" || next.content.length !== calls.length))
      throw new Error("Session history requires a complete adjacent tool-result batch.");
    const parts: AssistantSeed["parts"] = [];
    let callIndex = 0;
    for (const part of content) {
      if (part.type !== "tool-call") {
        if (callIndex)
          throw new Error("Assistant content after tool calls requires a separate message.");
        if (part.type === "file")
          parts.push({
            type: "file",
            url: part.data,
            mediaType: part.mediaType,
            filename: part.filename,
          });
        else parts.push(part);
        continue;
      }
      const output = next?.role === "tool" ? next.content[callIndex++] : undefined;
      if (!output || output.toolCallId !== part.toolCallId || output.toolName !== part.toolName)
        throw new Error("Tool results must match call identity, name and order.");
      if (Object.hasOwn(toolCallIds, part.toolCallId))
        throw new Error("Duplicate tool-call identity in session history.");
      toolCallIds[part.toolCallId] = `seed_tool_${toolSequence++}`;
      const base = { type: "dynamic-tool" as const, toolName: part.toolName, input: part.input };
      if (output.output.type === "error-text")
        parts.push({ ...base, state: "output-error", errorText: output.output.value });
      else if (output.output.type === "text")
        parts.push({
          ...base,
          state: "output-available",
          output: output.output.value,
          outputType: "text",
        });
      else parts.push({ ...base, state: "output-available", output: output.output.value });
    }
    messages.push({ role: "assistant", parts });
    if (calls.length) {
      messageIds.push(messageId);
      index++;
    }
  }
  return {
    seed: parseSessionTranscriptSeed({ attachments: "channel", messages }),
    messageIds,
    toolCallIds,
  };
}
