import type { ChannelAdapter } from "#channel/adapter.js";
import { loadContext } from "#context/container.js";
import { AuthKey } from "#context/keys.js";
import { createDurableSessionState } from "#execution/durable-session-store.js";
import {
  prepareSessionTranscriptSeed,
  type SessionTranscriptSeed,
} from "#execution/session-transcript-seed.js";
import { createSession } from "#execution/session.js";
import {
  hydrateSandboxAttachments,
  markSeedAttachmentsPending,
  stagePendingSeedAttachments,
} from "#harness/attachment-staging.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { mockSandbox } from "#internal/testing/mocks/mock-sandbox.js";
import { expect, it } from "vitest";

const seed: SessionTranscriptSeed = {
  attachments: "channel",
  messages: [
    {
      role: "user",
      parts: Array.from({ length: 6 }, (_, i) => ({
        type: "file",
        url: `https://chatjs.local/copied/${i}.png`,
        mediaType: "image/png",
        filename: `${i}.png`,
      })),
    },
  ],
};
function session() {
  return markSeedAttachmentsPending({
    ...createSession({
      sessionId: "destination",
      continuationToken: "destination-op",
      turnAgent: {
        id: "agent",
        instructions: [],
        model: { id: "mock" },
        tools: [],
        workspaceSpec: { rootEntries: [] },
      },
    }),
    history: prepareSessionTranscriptSeed(seed).history,
  });
}

it("keeps six 1 MiB attachments out of the seed and durable history, resolving under destination auth", async () => {
  const runtime = await createTestRuntime();
  const sandbox = mockSandbox({ id: "destination-sandbox" });
  const calls: string[] = [];
  const channel: ChannelAdapter = {
    kind: "copy-channel",
    fetchFile: async (url, context) => {
      expect(context?.session?.auth.current?.principalId).toBe("destination-owner");
      calls.push(url);
      return { bytes: Buffer.alloc(1024 * 1024, calls.length), mediaType: "image/png" };
    },
  };
  await runtime.runAsSession({ channel, sandbox }, async () => {
    loadContext().set(AuthKey, {
      authenticator: "test",
      principalId: "destination-owner",
      principalType: "user",
      attributes: {},
    });
    const initial = session();
    expect(Buffer.byteLength(JSON.stringify(seed))).toBeLessThan(2048);
    const staged = await stagePendingSeedAttachments(initial);
    expect(calls).toHaveLength(6);
    expect(JSON.stringify(initial.history)).toContain("https://chatjs.local/copied/");
    expect(JSON.stringify(staged.history)).not.toContain("https://chatjs.local/copied/");
    expect(
      Buffer.byteLength(JSON.stringify(createDurableSessionState({ session: staged }))),
    ).toBeLessThan(10_000);
    expect(await stagePendingSeedAttachments(staged)).toBe(staged);
    expect(calls).toHaveLength(6);
    const hydrated = await hydrateSandboxAttachments(staged.history);
    const message = hydrated[0];
    if (!message || message.role !== "user" || typeof message.content === "string")
      throw new Error("Expected user attachments");
    expect(message.content).toHaveLength(6);
    for (const [index, part] of message.content.entries()) {
      if (part.type !== "file" || !Buffer.isBuffer(part.data))
        throw new Error("Expected hydrated bytes");
      expect(part.data.byteLength).toBe(1024 * 1024);
      expect(part.data[0]).toBe(index + 1);
    }
  });
});

it.each(["denied", "unhandled"])(
  "preserves pending seed history after %s resolution so a retry cannot drop files",
  async (failure) => {
    const runtime = await createTestRuntime();
    const sandbox = mockSandbox({ id: "retry-sandbox" });
    let ready = false;
    const channel: ChannelAdapter = {
      kind: "copy-channel",
      fetchFile: async () => {
        if (!ready) {
          if (failure === "denied") throw new Error("Access denied");
          return null;
        }
        return { bytes: Buffer.from("copied"), mediaType: "image/png" };
      },
    };
    await runtime.runAsSession({ channel, sandbox }, async () => {
      const initial = session();
      const before = JSON.stringify(initial);
      await expect(stagePendingSeedAttachments(initial)).rejects.toThrow();
      expect(JSON.stringify(initial)).toBe(before);
      ready = true;
      const staged = await stagePendingSeedAttachments(initial);
      expect(JSON.stringify(staged.history)).toContain("eve-sandbox:");
      expect(JSON.stringify(staged.history)).not.toContain("could not be retrieved");
    });
  },
);

it("commits staged history and its marker together before a later model-selection failure", async () => {
  const { createToolLoopHarness } = await import("#harness/tool-loop.js");
  const runtime = await createTestRuntime();
  const sandbox = mockSandbox({ id: "model-selection-failure" });
  let fetches = 0;
  const channel: ChannelAdapter = {
    kind: "copy-channel",
    fetchFile: async () => {
      fetches++;
      return { bytes: Buffer.from("copied"), mediaType: "image/png" };
    },
  };
  await runtime.runAsSession({ channel, sandbox }, async () => {
    const harness = createToolLoopHarness({
      mode: "conversation",
      tools: new Map(),
      handleEvent: async () => {},
      resolveModel: async () => {
        throw new Error("Model configuration unavailable");
      },
    });
    const failed = await harness(session(), { message: "Retain this follow up" });
    expect(fetches).toBe(6);
    expect(JSON.stringify(failed.session.history)).toContain("eve-sandbox:");
    expect(JSON.stringify(failed.session.history)).not.toContain("https://chatjs.local/copied/");
    expect(JSON.stringify(failed.session.history)).toContain("Retain this follow up");
    expect(await stagePendingSeedAttachments(failed.session)).toBe(failed.session);
    expect(fetches).toBe(6);
  });
});

it("stages inherited pending files under the fork's auth without copying source state", async () => {
  const { restoreSessionCheckpoint } = await import("#execution/restore-session-checkpoint.js");
  const runtime = await createTestRuntime();
  const sandbox = mockSandbox({ id: "fork-sandbox" });
  let allowed = false;
  let fetches = 0;
  const channel: ChannelAdapter = {
    kind: "copy-channel",
    fetchFile: async (_url, context) => {
      expect(context?.session?.auth.current?.principalId).toBe("fork-owner");
      fetches++;
      if (!allowed) throw new Error("Temporarily unavailable");
      return { bytes: Buffer.from("inherited"), mediaType: "image/png" };
    },
  };
  await runtime.runAsSession({ channel, sandbox }, async () => {
    loadContext().set(AuthKey, {
      authenticator: "test",
      principalId: "fork-owner",
      principalType: "user",
      attributes: {},
    });
    const original = session();
    const source = {
      ...original,
      state: { ...original.state, "private-source-state": "do not inherit" },
    };
    const snapshot = createDurableSessionState({ session: source }).snapshot;
    if (!snapshot) throw new Error("Missing snapshot");
    const target = createSession({
      sessionId: "fork",
      continuationToken: "fork-op",
      turnAgent: {
        id: "agent",
        instructions: [],
        model: { id: "mock" },
        tools: [],
        workspaceSpec: { rootEntries: [] },
      },
    });
    const restored = restoreSessionCheckpoint({
      target,
      checkpoint: {
        version: 1,
        sessionId: source.sessionId,
        beforeTurnId: "turn_0",
        snapshot: { ...snapshot, version: 2 },
      },
    });
    expect(restored.state?.["private-source-state"]).toBeUndefined();
    expect(restored.sessionId).toBe("fork");
    await expect(stagePendingSeedAttachments(restored)).rejects.toThrow(
      "Attachment retrieval failed",
    );
    allowed = true;
    const beforeRetry = fetches;
    const staged = await stagePendingSeedAttachments(restored);
    expect(fetches - beforeRetry).toBe(6);
    expect(JSON.stringify(staged.history)).toContain("eve-sandbox:");
    expect(JSON.stringify(source.history)).toContain("https://chatjs.local/copied/");
    expect(await stagePendingSeedAttachments(staged)).toBe(staged);
    expect(fetches - beforeRetry).toBe(6);
  });
});
