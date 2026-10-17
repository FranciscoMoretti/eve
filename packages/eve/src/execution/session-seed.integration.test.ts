import { expect, it, vi } from "vitest";
import { getCompiledRuntimeAgentBundle } from "#runtime/sessions/compiled-agent-cache.js";
import { createSessionStep } from "#execution/create-session-step.js";
import { emitSessionTranscriptSeedStep } from "#execution/emit-session-transcript-seed-step.js";
import { defaultMessageReducer } from "#client/message-reducer.js";
import { parseSessionTranscriptSeed } from "#execution/session-transcript-seed.js";
import type { MessageStreamEvent } from "#protocol/message.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { mockSandbox } from "#internal/testing/mocks/mock-sandbox.js";
import { createSession } from "#execution/session.js";
import {
  markSeedAttachmentsPending,
  stagePendingSeedAttachments,
  seedFileDigests,
} from "#harness/seed-attachments.js";
import { hydrateSandboxAttachments } from "#harness/attachment-staging.js";

vi.mock("#runtime/sessions/compiled-agent-cache.js", () => ({
  getCompiledRuntimeAgentBundle: vi.fn(),
}));
const turnAgent = {
  id: "copy",
  instructions: [],
  tools: [],
  model: { id: "mock" },
  workspaceSpec: { rootEntries: [] },
  initialMessages: [{ role: "user", kind: "context.instruction", content: "Current instructions" }],
} as const;

it("installs ordered copy history and stable display without replaying historical tool execution", async () => {
  vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue({
    resolvedAgent: { config: {} },
    turnAgent,
  } as never);
  const seed = parseSessionTranscriptSeed({
    attachments: "channel",
    messages: [
      { role: "user", parts: [{ type: "text", text: "Read notes" }] },
      {
        role: "assistant",
        modelId: "gateway/mock",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "not_registered_or_executable",
            input: {},
            state: "output-available",
            output: "Saved notes",
            outputType: "text",
          },
          { type: "text", text: "Finished" },
        ],
      },
    ],
  });
  const created = await createSessionStep({
    seed,
    compiledArtifactsSource: { kind: "bundled" },
    continuationToken: "copy",
    sessionId: "destination",
  });
  expect(created.history.map((message) => message.role)).toEqual([
    "user",
    "user",
    "assistant",
    "tool",
    "assistant",
  ]);
  expect(created.history[0]?.content).toBe("Current instructions");
  expect(created.history[3]?.content).toEqual([
    {
      type: "tool-result",
      toolCallId: "seed_tool_0",
      toolName: "not_registered_or_executable",
      output: { type: "text", value: "Saved notes" },
    },
  ]);
  const events: MessageStreamEvent[] = [];
  await emitSessionTranscriptSeedStep({
    seed,
    writable: new WritableStream({
      write(chunk) {
        events.push(JSON.parse(new TextDecoder().decode(chunk)));
      },
    }),
  });
  expect(events.map((event) => event.type)).toEqual(["history.seeded", "session.waiting"]);
  const reducer = defaultMessageReducer();
  let display = reducer.initial();
  for (const event of [...events, ...events]) display = reducer.reduce(display, event);
  expect(display.messages.map((message) => message.id)).toEqual([
    "seed_message_0",
    "seed_message_1",
  ]);
  expect(display.messages[1]?.metadata?.modelId).toBe("gateway/mock");
  await expect(
    createSessionStep({
      seed,
      compiledArtifactsSource: { kind: "bundled" },
      continuationToken: "child",
      sessionId: "child",
      rootSessionId: "parent",
    }),
  ).rejects.toThrow("fresh root");
});

it("keeps failed copied files pending and rejects missing or mutated destination bytes on later hydration", async () => {
  const runtime = await createTestRuntime();
  const sandbox = mockSandbox({ id: "destination-only" });
  const initial = markSeedAttachmentsPending({
    ...createSession({ continuationToken: "copy", sessionId: "destination", turnAgent }),
    history: [
      {
        role: "user",
        kind: "user",
        content: [
          {
            type: "file",
            data: new URL("https://chat.example/destination-file"),
            mediaType: "text/plain",
            filename: "notes.txt",
          },
        ],
      },
    ],
  });
  const channel = {
    kind: "copy",
    state: {},
    fetchFile: vi.fn(async () => Buffer.from("owned destination bytes")),
  };
  await expect(
    runtime.runAsSession({ sandbox, channel: { ...channel, fetchFile: async () => null } }, () =>
      stagePendingSeedAttachments(initial),
    ),
  ).rejects.toThrow("did not resolve");
  expect(initial.state?.["eve.pending-seed-files"]).toBe(true);
  const staged = await runtime.runAsSession({ sandbox, channel }, () =>
    stagePendingSeedAttachments(initial),
  );
  expect(channel.fetchFile).toHaveBeenCalledOnce();
  expect(staged.state?.["eve.pending-seed-files"]).toBeUndefined();
  const digests = seedFileDigests(staged);
  await expect(
    runtime.runAsSession({ sandbox }, () => hydrateSandboxAttachments(staged.history, digests)),
  ).resolves.toHaveLength(1);
  await expect(
    runtime.runAsSession({ sandbox: mockSandbox({ id: "different-sandbox" }) }, () =>
      hydrateSandboxAttachments(staged.history, digests),
    ),
  ).rejects.toThrow("unavailable or changed");
  await expect(
    runtime.runAsSession({ sandbox: mockSandbox({ id: "compacted-destination" }) }, () =>
      hydrateSandboxAttachments(
        [{ role: "user", content: "Compacted attachment reference" }],
        digests,
      ),
    ),
  ).rejects.toThrow("unavailable or changed");
  const path = Object.keys(digests)[0]!;
  await sandbox.session.writeBinaryFile({ path, content: Buffer.from("changed") });
  await expect(
    runtime.runAsSession({ sandbox }, () => hydrateSandboxAttachments(staged.history, digests)),
  ).rejects.toThrow("unavailable or changed");
});
