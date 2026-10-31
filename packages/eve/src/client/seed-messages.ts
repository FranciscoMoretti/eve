import type { SessionTranscriptSeed } from "#protocol/session-events/families/transcript-seed.js";
import type { EveMessage, EveMessagePart } from "#client/message-types.js";

/** Imported calls are finished records, never actionable interactions. */
export function seedMessages(seed: SessionTranscriptSeed): EveMessage[] {
  let sequence = 0;
  return seed.messages.map((message, index) => {
    const parts: EveMessagePart[] = [];
    let stepIndex = 0;
    for (const part of message.parts) {
      if (part.type === "step-start") {
        stepIndex++;
        continue;
      }
      if (part.type === "dynamic-tool") {
        parts.push({
          type: "tool",
          kind: "tool",
          name: part.toolName,
          label: part.toolName,
          callId: `seed_tool_${sequence++}`,
          stepIndex,
          input: part.input,
          state:
            part.state === "output-available"
              ? "completed"
              : part.state === "output-denied"
                ? "rejected"
                : "failed",
          output: part.state === "output-available" ? part.output : undefined,
          error:
            part.state === "output-error"
              ? { code: "imported_tool_error", message: part.errorText }
              : undefined,
        });
      } else if (part.type === "file") parts.push(part);
      else parts.push({ ...part, state: "done" });
    }
    return {
      id: `seed_message_${index}`,
      role: message.role,
      parts,
      metadata: {
        imported: true,
        status: "complete",
        custom: message.metadata,
        modelId: message.role === "assistant" ? message.modelId : undefined,
      },
    };
  });
}
