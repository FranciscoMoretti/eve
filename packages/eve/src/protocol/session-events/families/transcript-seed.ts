import { z } from "#compiled/zod/index.js";

const text = z.strictObject({ type: z.literal("text"), text: z.string() });
const reasoning = z.strictObject({ type: z.literal("reasoning"), text: z.string() });
const file = z.strictObject({
  type: z.literal("file"),
  url: z
    .url()
    .refine(
      (value) => ["https:", "http:"].includes(new URL(value).protocol),
      "Seed files require an authorized original HTTP URL.",
    ),
  /** Canonical path observed when this file was staged in the shared workspace. */
  existingPath: z.string().startsWith("/").min(1),
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
export const sessionTranscriptSeed = z.strictObject({
  /** Resolve compact file URLs through the authenticated channel before the first model turn. */
  attachments: z.literal("channel"),
  messages: z
    .array(
      z.discriminatedUnion("role", [
        z.strictObject({
          role: z.literal("user"),
          metadata: z.record(z.string(), z.json()).optional(),
          parts: z.array(z.union([text, file])).min(1),
        }),
        z.strictObject({
          role: z.literal("assistant"),
          metadata: z.record(z.string(), z.json()).optional(),
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
