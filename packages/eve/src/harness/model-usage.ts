import type { LanguageModelUsage } from "ai";
import type { StepCompletedProviderMetadata } from "#protocol/message.js";

export function modelUsageEvidence(input: {
  readonly usage?: LanguageModelUsage;
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}) {
  return {
    providerMetadata: extractStepProviderMetadata(input.providerMetadata),
    usage: extractStepUsage({
      costUsd: extractGatewayCostUsd(input.providerMetadata),
      usage: input.usage,
    }),
  };
}

/**
 * Projects the AI SDK's `LanguageModelUsage` into the flat `step.completed`
 * event usage shape. Returns `undefined` when the SDK reports no usage.
 */
function extractStepUsage(input: {
  readonly costUsd: number | undefined;
  readonly usage: LanguageModelUsage | undefined;
}):
  | {
      costUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | undefined {
  const result: {
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  } = {};

  if (input.costUsd !== undefined) result.costUsd = input.costUsd;

  const usage = input.usage;
  if (usage === undefined) {
    return Object.keys(result).length > 0 ? result : undefined;
  }

  if (isTokenCount(usage.inputTokens)) result.inputTokens = usage.inputTokens;
  if (isTokenCount(usage.outputTokens)) result.outputTokens = usage.outputTokens;
  if (isTokenCount(usage.inputTokenDetails?.cacheReadTokens)) {
    result.cacheReadTokens = usage.inputTokenDetails.cacheReadTokens;
  }
  if (isTokenCount(usage.inputTokenDetails?.cacheWriteTokens)) {
    result.cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function extractStepProviderMetadata(
  providerMetadata: Readonly<Record<string, unknown>> | undefined,
): StepCompletedProviderMetadata | undefined {
  const generationId = readGatewayGenerationId(providerMetadata);
  return generationId === undefined ? undefined : { gateway: { generationId } };
}

function extractGatewayCostUsd(
  providerMetadata: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  const gateway = readGatewayMetadata(providerMetadata);
  const cost = gateway?.cost;
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
    return cost;
  }
  if (typeof cost === "string" && cost.trim().length > 0) {
    const parsed = Number(cost);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

export function readGatewayGenerationId(
  providerMetadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const generationId = readGatewayMetadata(providerMetadata)?.generationId;
  return typeof generationId === "string" && generationId.length > 0 ? generationId : undefined;
}

function readGatewayMetadata(
  providerMetadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const gateway = providerMetadata?.gateway;
  return gateway && typeof gateway === "object" && !Array.isArray(gateway)
    ? (gateway as Readonly<Record<string, unknown>>)
    : undefined;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
