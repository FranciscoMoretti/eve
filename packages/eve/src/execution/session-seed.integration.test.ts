import { expect, it, vi } from "vitest";
import { pngBytes } from "#internal/testing/media-fixtures.js";
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
import {
  stageAttachmentsToSandbox,
  hydrateSandboxAttachments,
} from "#harness/attachment-staging.js";

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

it.each([
  { mediaType: "image/png", bytes: pngBytes(2, 3) },
  {
    mediaType: "application/pdf",
    bytes: Buffer.from("%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF"),
  },
])(
  "reuses shared $mediaType paths without copying files and rejects unavailable or changed originals",
  async ({ mediaType, bytes }) => {
    const runtime = await createTestRuntime();
    const sandbox = mockSandbox({ id: "shared-workspace" });
    const source = await runtime.runAsSession({ sessionId: "source", sandbox }, () =>
      stageAttachmentsToSandbox([{ type: "file", data: bytes, mediaType, filename: "notes.txt" }]),
    );
    if (typeof source === "string" || source[0]?.type !== "file" || !source[0].filename)
      throw new Error("Expected a staged source file.");
    const existingPath = source[0].filename;
    const initial = markSeedAttachmentsPending(
      {
        ...createSession({ continuationToken: "copy", sessionId: "destination", turnAgent }),
        history: [
          {
            role: "user",
            kind: "user",
            content: [
              {
                type: "file",
                data: new URL("https://chat.example/destination-file"),
                mediaType,
                filename: "notes.txt",
              },
            ],
          },
        ],
      },
      {
        attachments: "channel",
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "file",
                url: "https://chat.example/destination-file",
                mediaType,
                filename: "notes.txt",
                existingPath,
              },
            ],
          },
        ],
      },
    );
    const channel = {
      kind: "copy",
      state: {},
      fetchFile: vi.fn(async () => ({ bytes, mediaType })),
    };
    await expect(
      runtime.runAsSession({ sandbox, channel: { ...channel, fetchFile: async () => null } }, () =>
        stagePendingSeedAttachments(initial),
      ),
    ).rejects.toThrow("did not resolve");
    expect(initial.state?.["eve.pending-seed-files"]).toEqual({
      "https://chat.example/destination-file": existingPath,
    });
    const staged = await runtime.runAsSession({ sandbox, channel }, () =>
      stagePendingSeedAttachments(initial),
    );
    expect(channel.fetchFile).toHaveBeenCalledOnce();
    expect(sandbox.writes).toHaveLength(1); // Only the original upload; importing history performs no write.
    expect(staged.state?.["eve.pending-seed-files"]).toBeUndefined();
    const digests = seedFileDigests(staged);
    const modelHistory = await runtime.runAsSession({ sessionId: "fork", sandbox }, () =>
      hydrateSandboxAttachments(staged.history, digests),
    );
    const content = modelHistory[0]?.content;
    if (!Array.isArray(content)) throw new Error("Expected attachment model content.");
    const modelFile = content.find((part) => part.type === "file");
    expect(modelFile?.data).toEqual(bytes);
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
  },
);
