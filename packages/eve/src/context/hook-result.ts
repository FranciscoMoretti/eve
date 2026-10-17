import { z } from "#compiled/zod/index.js";
import { jsonObjectSchema } from "#shared/json-schemas.js";
import type { HookResultStreamEvent } from "#protocol/message.js";

const resultSchema = z.strictObject({ responseMetadata: z.unknown().optional() });

/** Display annotations remain independent of application-owned model accounting. */
export function createHookResultEvent(
  hookId: string,
  turnId: string,
  value: unknown,
): HookResultStreamEvent | undefined {
  const result = resultSchema.parse(value);
  const annotation = jsonObjectSchema.safeParse(result.responseMetadata);
  if (!annotation.success) return undefined;
  return { type: "hook.result", data: { hookId, turnId, responseMetadata: annotation.data } };
}
