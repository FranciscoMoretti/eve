import { z } from "#compiled/zod/index.js";

const textPart = z.strictObject({ type: z.literal("text"), text: z.string() });
const reasoningPart = z.strictObject({ type: z.literal("reasoning"), text: z.string() });
const filePart = z.strictObject({
  type: z.literal("file"),
  url: z.url().refine((url) => /^https?:/.test(url)),
  mediaType: z.string().min(1),
  filename: z.string().optional(),
});
const toolBase = { type: z.literal("dynamic-tool"), toolName: z.string().min(1), input: z.json() };
const toolPart = z.discriminatedUnion("state", [
  z.strictObject({
    ...toolBase,
    state: z.literal("output-available"),
    output: z.json(),
    outputType: z.literal("text").optional(),
  }),
  z.strictObject({ ...toolBase, state: z.literal("output-error"), errorText: z.string() }),
  z.strictObject({ ...toolBase, state: z.literal("output-denied"), reason: z.string().optional() }),
]);
export const historyPart = z.union([
  textPart,
  reasoningPart,
  filePart,
  toolPart,
  z.strictObject({ type: z.literal("step-start") }),
]);
export type ImportedHistoryPart = z.infer<typeof historyPart>;

/** Prior conversation, imported as data rather than executable calls or approvals. */
export type ImportedMessage = {
  readonly id?: string;
  readonly role: "user" | "assistant";
} & (
  | { readonly text: string; readonly parts?: never }
  | { readonly parts: readonly ImportedHistoryPart[]; readonly text?: never }
);
