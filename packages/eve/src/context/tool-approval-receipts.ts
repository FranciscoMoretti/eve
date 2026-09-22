import { isDeepStrictEqual } from "node:util";

import { contextStorage, type AlsContext } from "#context/container.js";
import { ContextKey } from "#context/key.js";
import { SessionKey } from "#context/keys.js";
import {
  getApprovalAuditState,
  type ApprovalResponderIdentity,
} from "#harness/approval-candidates.js";
import type { ResolvedInputBatch } from "#harness/input-request-resolution.js";
import type { SessionStateMap } from "#harness/types.js";

export interface ToolApprovalReceipt {
  readonly requestId: string;
  readonly responder: ApprovalResponderIdentity;
}

type Entry = {
  readonly input: unknown;
  readonly receipt: ToolApprovalReceipt;
  readonly sessionId: string;
  readonly toolName: string;
};

const ToolApprovalReceiptsKey = new ContextKey<Map<string, Entry>>(
  "eve.runtime.toolApprovalReceipts",
);

/** Only approvals resolved in this harness invocation can authorize execution. */
export function prepareToolApprovalReceipts(
  ctx: AlsContext,
  sessionId: string,
  batches: readonly ResolvedInputBatch[] | undefined,
  state: SessionStateMap | undefined,
): void {
  const settlements = getApprovalAuditState(state).settlements;
  const receipts = new Map<string, Entry>();
  const seen = new Set<string>();
  for (const batch of batches ?? []) {
    for (const input of batch.inputs) {
      const request = input.request;
      if (request.kind !== "tool-approval") continue;
      const callId = request.action.callId;
      if (seen.has(callId)) {
        receipts.delete(callId);
        continue;
      }
      seen.add(callId);
      if (input.outcome !== "approved") continue;
      const matches = settlements.filter((entry) => entry.requestId === request.requestId);
      if (matches.length !== 1 || matches[0]?.outcome !== "allowed") continue;
      receipts.set(callId, {
        input: structuredClone(request.action.input),
        receipt: Object.freeze({
          requestId: request.requestId,
          responder: Object.freeze({ ...matches[0].actor }),
        }),
        sessionId,
        toolName: request.action.toolName,
      });
    }
  }
  ctx.setVirtualContext(ToolApprovalReceiptsKey, receipts);
}

export function getToolApprovalReceipt(
  callId: string,
  toolName: string,
  input: unknown,
): ToolApprovalReceipt | undefined {
  const ctx = contextStorage.getStore();
  if (ctx === undefined) return undefined;
  const entry = ctx.get(ToolApprovalReceiptsKey)?.get(callId);
  if (
    entry === undefined ||
    entry.sessionId !== ctx.require(SessionKey).sessionId ||
    entry.toolName !== toolName ||
    !isDeepStrictEqual(entry.input, input)
  ) {
    return undefined;
  }
  return entry.receipt;
}
