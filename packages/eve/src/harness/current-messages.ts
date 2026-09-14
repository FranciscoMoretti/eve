import type { ModelMessage, SystemModelMessage } from "ai";
import type { HistoryState } from "#context/keys.js";

import {
  createFrameworkUserMessage,
  type FrameworkMessageKind,
  type HarnessModelMessage,
} from "#harness/messages.js";

interface AddCurrentMessageOptions {
  readonly cacheFriendly?: boolean;
}

interface CurrentMessagesOptions {
  readonly historyState?: HistoryState;
  readonly currentTurnMessages?: readonly HarnessModelMessage[];
  readonly projectedMessages?: readonly HarnessModelMessage[];
}

const ANNOUNCEMENT_KINDS = {
  availableSkills: "context.state",
  deliveryInstruction: "context.instruction",
  taskState: "context.state",
} as const satisfies Record<keyof HistoryState, FrameworkMessageKind>;

/**
 * Appends messages without moving a pending approval response away from the
 * absolute history tail. When possible, additions are placed before the
 * assistant message that opened the approval exchange so the tool-call and
 * approval messages remain contiguous.
 */
export function appendMessagesPreservingTailApproval(
  messages: readonly ModelMessage[],
  additions: readonly ModelMessage[],
): ModelMessage[] {
  if (additions.length === 0) {
    return [...messages];
  }

  const tail = messages.at(-1);
  if (tail?.role !== "tool") {
    return [...messages, ...additions];
  }

  const approvalIds = new Set(
    tail.content
      .filter((part) => part.type === "tool-approval-response")
      .map((part) => part.approvalId),
  );
  if (approvalIds.size === 0) {
    return [...messages, ...additions];
  }
  const completedToolCallIds = new Set(
    tail.content.filter((part) => part.type === "tool-result").map((part) => part.toolCallId),
  );

  let insertionIndex: number | undefined;
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          part.type === "tool-approval-request" &&
          approvalIds.has(part.approvalId) &&
          !completedToolCallIds.has(part.toolCallId),
      )
    ) {
      insertionIndex = index;
    }
  }

  if (insertionIndex === undefined) {
    return [...messages, ...additions];
  }

  return [...messages.slice(0, insertionIndex), ...additions, ...messages.slice(insertionIndex)];
}

/** Builds the model view and durable history for one step. */
export function createCurrentMessages(
  history: readonly HarnessModelMessage[],
  options: CurrentMessagesOptions = {},
): {
  readonly history: readonly HarnessModelMessage[];
  readonly historyState: HistoryState;
  readonly nonSystemMessages: readonly HarnessModelMessage[];
  readonly systemMessages: readonly SystemModelMessage[];
  add(message: string, kind: FrameworkMessageKind, options?: AddCurrentMessageOptions): void;
  addAnnouncements(announcements: HistoryState): void;
  addSystem(messages: SystemModelMessage | readonly SystemModelMessage[]): void;
} {
  const durableMessages = [...history];
  const historyState = { ...options.historyState };
  const systemMessages: SystemModelMessage[] = [];
  const nonSystemMessages: HarnessModelMessage[] = [];
  const currentTurnMessages = new Set(options.currentTurnMessages);
  let currentTurnInsertionIndex: number | undefined;

  for (const message of options.projectedMessages ?? history) {
    if (currentTurnInsertionIndex === undefined && currentTurnMessages.has(message)) {
      currentTurnInsertionIndex = nonSystemMessages.length;
    }
    if (message.role === "system") {
      systemMessages.push(message);
    } else {
      nonSystemMessages.push(message);
    }
  }
  let userInsertionIndex = currentTurnInsertionIndex ?? nonSystemMessages.length;
  const currentInputIndex = history.findIndex((message) => currentTurnMessages.has(message));
  let historyInsertionIndex = currentInputIndex === -1 ? history.length : currentInputIndex;
  // The AI SDK collects approval responses only from the tail tool message.
  // Appending user-role context there would skip the approved tool's
  // execution and send the provider a tool call with no result.
  const canAppendUserMessages =
    currentTurnInsertionIndex !== undefined || !hasTailApprovalResponse(nonSystemMessages);

  function add(
    message: string,
    kind: FrameworkMessageKind,
    { cacheFriendly = true }: AddCurrentMessageOptions = {},
  ): boolean {
    if (cacheFriendly && canAppendUserMessages) {
      const entry = createFrameworkUserMessage(kind, message);
      nonSystemMessages.splice(userInsertionIndex, 0, entry);
      durableMessages.splice(historyInsertionIndex, 0, entry);
      userInsertionIndex += 1;
      historyInsertionIndex += 1;
      return true;
    }
    systemMessages.push({ role: "system", content: message });
    return false;
  }

  return {
    add,
    addAnnouncements(announcements) {
      for (const key of ["availableSkills", "taskState", "deliveryInstruction"] as const) {
        const message = announcements[key];
        if (message === undefined || message.length === 0 || historyState[key] === message)
          continue;
        if (add(message, ANNOUNCEMENT_KINDS[key])) historyState[key] = message;
      }
    },
    addSystem(messages) {
      systemMessages.push(...(Array.isArray(messages) ? messages : [messages]));
    },
    get nonSystemMessages() {
      return [...nonSystemMessages];
    },
    get history() {
      return [...durableMessages];
    },
    get historyState() {
      return { ...historyState };
    },
    get systemMessages() {
      return [...systemMessages];
    },
  };
}

/** True when the history ends with a tool message carrying a tool-approval-response. */
export function hasTailApprovalResponse(messages: readonly ModelMessage[]): boolean {
  const tail = messages.at(-1);
  return (
    tail?.role === "tool" && tail.content.some((part) => part.type === "tool-approval-response")
  );
}
