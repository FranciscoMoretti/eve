import { resumeHook } from "#internal/workflow/runtime.js";
import { sessionInboxHookToken } from "#execution/session-inbox/address.js";
import { createChannelDeliveryMetadata } from "#channel/delivery-metadata.js";
import { markMockModel } from "#internal/mock-model-identity.js";
import { defineDynamic } from "#dynamic/definition.js";
import { expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { buildSerializedContext } from "#internal/testing/entry-test-helpers.js";
import { startSessionOwner } from "#internal/testing/workflow-test-helpers.js";
import { captureTurnEvents } from "#internal/testing/events.js";
import { textStreamResult } from "#internal/testing/approval-resume.js";
import { workflowEntry } from "#execution/session/entry.js";
import { defineAgent } from "#public/definitions/agent.js";
import { defineTool } from "#tools/definition.js";
import { parseSessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import { conversationOf } from "#client/conversation.js";
import { z } from "zod";

it("continues a seeded root through v27 publication without rerunning completed tools", async () => {
  let executions = 0;
  let sawResult = false;
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      sawResult = prompt.some(
        (message) =>
          message.role === "tool" &&
          message.content.some((part) => part.type === "tool-result" && part.toolName === "saved"),
      );
      return textStreamResult("Continued from the saved result.");
    },
  });
  const runtime = await createTestRuntime({
    agent: {
      definition: defineAgent({
        model: defineDynamic(() => ({
          model: markMockModel(model),
          modelContextWindowTokens: 200_000,
        })),
      }),
    },
    modules: [
      {
        logicalPath: "tools/saved.ts",
        loadNamespace: async () => ({
          default: defineTool({
            description: "Read saved notes",
            inputSchema: z.object({}),
            execute: async () => {
              executions++;
              return "new execution";
            },
          }),
        }),
      },
    ],
  });
  await runtime.run(async () => {
    const run = await startSessionOwner(workflowEntry, [
      {
        kind: "initial",
        ownerDeploymentId: "dpl_inline",
        input: {},
        seed: parseSessionTranscriptSeed({
          attachments: "channel",
          messages: [
            { role: "user", parts: [{ type: "text", text: "Read the notes." }] },
            {
              role: "assistant",
              parts: [
                {
                  type: "dynamic-tool",
                  toolName: "saved",
                  input: {},
                  state: "output-available",
                  output: "Recorded notes",
                  outputType: "text",
                },
              ],
            },
          ],
        }),
        serializedContext: buildSerializedContext({
          channelKind: "http",
          continuationToken: "seed-v27-runtime",
          auth: { principalType: "user", principalId: "alice" },
        }),
      },
    ]);
    const stream = captureTurnEvents(run);
    try {
      const initial = await stream.nextUntil((event) => event.type === "session.started");
      expect(conversationOf(initial).messages).toHaveLength(2);
      await resumeHook(sessionInboxHookToken("seed-v27-runtime"), {
        auth: { principalType: "user", principalId: "alice" },
        kind: "send",
        delivery: createChannelDeliveryMetadata({ channelKind: "http", channelName: "test" }),
        payload: { message: "Continue the saved discussion." },
      });
      const events = [...initial, ...(await stream.nextTurn())];
      expect(events.filter((event) => event.type === "session.started")).toHaveLength(1);
      expect(events.find((event) => event.type === "turn.settled")?.data.outcome).toBe("completed");
      expect(sawResult).toBe(true);
      expect(executions).toBe(0);
      const messages = conversationOf(events).messages;
      expect(messages.slice(0, 2).map((message) => message.id)).toEqual([
        "seed_message_0",
        "seed_message_1",
      ]);
      expect(messages.at(-1)?.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text", text: "Continued from the saved result." }),
        ]),
      );
    } finally {
      stream.dispose();
      await run.cancel();
    }
  });
}, 60_000);
