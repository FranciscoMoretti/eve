import {
  sessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#protocol/session-events/families/transcript-seed.js";
export type { SessionTranscriptSeed } from "#protocol/session-events/families/transcript-seed.js";
import { seedMessages } from "#client/seed-messages.js";
import type { HarnessModelMessage } from "#harness/messages.js";
import type { AssistantContent, ToolContent, UserContent } from "ai";
import type { EveMessage } from "#client/message-types.js";

/** Validates and detaches trusted callback data before crossing a durable boundary. */
export function parseSessionTranscriptSeed(value: unknown): SessionTranscriptSeed {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 8 * 1024 * 1024)
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
  const messages = seedMessages(seed);
  let toolSequence = 0;
  for (const message of seed.messages) {
    if (message.role === "user") {
      const content: UserContent = [];
      for (const part of message.parts) {
        if (part.type === "text") content.push(part);
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
          continue;
        }
        // A tool result must precede any subsequent assistant text or reasoning.
        if (results.length && part.type !== "dynamic-tool") flush();
        if (part.type === "text" || part.type === "reasoning") {
          content.push(part);
        } else if (part.type === "file") {
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
        }
      }
      flush();
    }
  }
  return { history, messages };
}
