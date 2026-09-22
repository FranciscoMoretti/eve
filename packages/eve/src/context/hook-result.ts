import { z } from "#compiled/zod/index.js";
import { jsonObjectSchema } from "#shared/json-schemas.js";
import { modelUsageEvidence } from "#harness/model-usage.js";
import type { HookResultStreamEvent } from "#protocol/message.js";
import type { HookModelCall } from "#public/definitions/hook.js";

const resultSchema = z.strictObject({
  responseMetadata: z.unknown().optional(),
  modelCalls: z
    .array(
      z.strictObject({
        modelId: z.string().min(1).max(512),
        failed: z.boolean().optional(),
        usage: z
          .custom<HookModelCall["usage"]>(
            (value) => value !== null && typeof value === "object" && !Array.isArray(value),
          )
          .optional(),
        providerMetadata: z.record(z.string(), jsonObjectSchema).optional(),
      }),
    )
    .max(100)
    .optional(),
});

/** Retain billing attempts independently of the optional display annotation. */
export function createHookResultEvent(
  hookId: string,
  turnId: string,
  value: unknown,
): HookResultStreamEvent | undefined {
  const result = resultSchema.parse(value);
  const annotation = jsonObjectSchema.safeParse(result.responseMetadata);
  const responseMetadata = annotation.success ? annotation.data : undefined;
  if (responseMetadata === undefined && !result.modelCalls?.length) return undefined;
  const data: {
    -readonly [K in keyof HookResultStreamEvent["data"]]: HookResultStreamEvent["data"][K];
  } = { hookId, turnId };
  if (responseMetadata !== undefined) data.responseMetadata = responseMetadata;
  if (result.modelCalls?.length) {
    data.modelCalls = result.modelCalls.map((call) => ({
      modelId: call.modelId,
      failed: call.failed,
      ...modelUsageEvidence(call),
    }));
  }
  return { type: "hook.result", data };
}
