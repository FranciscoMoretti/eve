import type { HarnessModelMessage } from "#harness/messages.js";
import { jsonObjectSchema } from "#shared/json-schemas.js";
import type { AssistantContent, ToolContent, UserContent } from "ai";
import { z } from "#compiled/zod/index.js";
import type { EveMessage, EveMessagePart } from "#client/message-reducer-types.js";

const text = z.strictObject({ type: z.literal("text"), text: z.string() });
const reasoning = z.strictObject({ type: z.literal("reasoning"), text: z.string() });
const file = z.strictObject({
  type: z.literal("file"),
  url: z
    .url()
    .refine(
      (value) => ["https:", "http:", "data:"].includes(new URL(value).protocol),
      "Seed files require a copied HTTP or data URL.",
    ),
  mediaType: z.string().min(1),
  filename: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});
const toolBase = { type: z.literal("dynamic-tool"), toolName: z.string().min(1), input: z.json() };
const tool = z.discriminatedUnion("state", [
  z.strictObject({
    ...toolBase,
    state: z.literal("output-available"),
    output: z.json(),
    outputType: z.literal("text").optional(),
  }),
  z.strictObject({ ...toolBase, state: z.literal("output-error"), errorText: z.string() }),
  z.strictObject({ ...toolBase, state: z.literal("output-denied"), reason: z.string().optional() }),
]);

/** Trusted server input, never a browser request body or a runtime checkpoint. */
const sessionTranscriptSeed = z.strictObject({
  /** Resolve compact file URLs through the authenticated channel before the first model turn. */
  attachments: z.literal("channel").optional(),
  messages: z
    .array(
      z.discriminatedUnion("role", [
        z.strictObject({
          role: z.literal("user"),
          metadata: jsonObjectSchema.optional(),
          annotations: z.record(z.string().min(1).max(512), jsonObjectSchema).optional(),
          parts: z.array(z.union([text, file])).min(1),
        }),
        z.strictObject({
          role: z.literal("assistant"),
          metadata: jsonObjectSchema.optional(),
          annotations: z.record(z.string().min(1).max(512), jsonObjectSchema).optional(),
          modelId: z.string().min(1).max(512).optional(),
          parts: z
            .array(
              z.union([
                text,
                reasoning,
                file,
                tool,
                z.strictObject({ type: z.literal("step-start") }),
              ]),
            )
            .min(1),
        }),
      ]),
    )
    .max(10_000),
});
export type SessionTranscriptSeed = z.infer<typeof sessionTranscriptSeed>;

/** Validates and detaches trusted callback data before crossing a durable boundary. */
export function parseSessionTranscriptSeed(value: unknown): SessionTranscriptSeed {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 8 * 1024 * 1024)
    throw new Error("Session transcript seed byte limit exceeded.");
  const seed = sessionTranscriptSeed.parse(value);
  for (const message of seed.messages) {
    for (const part of message.parts) {
      if (
        part.type === "dynamic-tool" &&
        part.state === "output-available" &&
        part.outputType === "text" &&
        typeof part.output !== "string"
      )
        throw new Error("Text tool output must be a string.");
    }
  }
  return seed;
}

/** Derives both native model history and display from one capability-free transcript. */
export function prepareSessionTranscriptSeed(value: unknown): {
  readonly history: HarnessModelMessage[];
  readonly messages: EveMessage[];
} {
  const seed = parseSessionTranscriptSeed(value);
  const history: HarnessModelMessage[] = [];
  const messages: EveMessage[] = [];
  let toolSequence = 0;
  for (const [index, message] of seed.messages.entries()) {
    const parts: EveMessagePart[] = [];
    if (message.role === "user") {
      const content: UserContent = [];
      for (const part of message.parts) {
        parts.push(part.type === "text" ? { ...part, state: "done" } : part);
        if (part.type === "text") content.push(part);
        else if (seed.attachments !== "channel" && part.mediaType.startsWith("image/"))
          content.push({ type: "image", image: new URL(part.url), mediaType: part.mediaType });
        else
          content.push({
            type: "file",
            data: new URL(part.url),
            mediaType: part.mediaType,
            filename: part.filename,
          });
      }
      history.push({ role: "user", kind: "user", content });
    } else {
      let content: AssistantContent = [];
      let results: ToolContent = [];
      const flush = () => {
        if (content.length) history.push({ role: "assistant", content });
        if (results.length) history.push({ role: "tool", content: results });
        content = [];
        results = [];
      };
      for (const part of message.parts) {
        if (part.type === "step-start") {
          flush();
          parts.push(part);
          continue;
        }
        // A tool result must precede any subsequent assistant text or reasoning.
        if (results.length && part.type !== "dynamic-tool") flush();
        if (part.type === "text" || part.type === "reasoning") {
          parts.push({ ...part, state: "done" });
          content.push(part);
        } else if (part.type === "file") {
          parts.push(part);
          content.push({
            type: "file",
            data: new URL(part.url),
            mediaType: part.mediaType,
            filename: part.filename,
          });
        } else {
          const toolCallId = `seed_tool_${toolSequence++}`;
          content.push({
            type: "tool-call",
            toolCallId,
            toolName: part.toolName,
            input: part.input,
          });
          const output =
            part.state === "output-available"
              ? part.outputType === "text" && typeof part.output === "string"
                ? { type: "text" as const, value: part.output }
                : { type: "json" as const, value: part.output }
              : {
                  type: "error-text" as const,
                  value:
                    part.state === "output-error"
                      ? part.errorText
                      : (part.reason ?? "Tool execution was denied."),
                };
          results.push({ type: "tool-result", toolCallId, toolName: part.toolName, output });
          if (part.state === "output-denied") {
            parts.push({
              type: part.type,
              toolName: part.toolName,
              toolCallId,
              input: part.input,
              state: part.state,
              approval: { id: `seed_denial_${toolSequence}`, approved: false, reason: part.reason },
            });
          } else parts.push({ ...part, toolCallId });
        }
      }
      flush();
    }
    const seeded: { -readonly [K in keyof EveMessage]: EveMessage[K] } = {
      id: `seed_message_${index}`,
      role: message.role,
      parts,
    };
    if (
      (message.role === "assistant" && message.modelId !== undefined) ||
      message.metadata !== undefined ||
      message.annotations !== undefined
    ) {
      const metadata: {
        -readonly [K in keyof NonNullable<EveMessage["metadata"]>]: NonNullable<
          EveMessage["metadata"]
        >[K];
      } = {};
      if (message.role === "assistant" && message.modelId !== undefined)
        metadata.modelId = message.modelId;
      if (message.metadata !== undefined) metadata.custom = message.metadata;
      if (message.annotations !== undefined) metadata.annotations = message.annotations;
      seeded.metadata = metadata;
    }
    messages.push(seeded);
  }
  return { history, messages };
}
