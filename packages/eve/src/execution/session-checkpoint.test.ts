import { describe, expect, it } from "vitest";
import { createSession } from "#execution/session.js";
import { setHarnessEmissionState } from "#harness/emission-state.js";
import { writeSessionCheckpoint } from "#execution/session-checkpoint.js";
import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";

function session() {
  return createSession({
    sessionId: "source",
    continuationToken: "source-inbox",
    turnAgent: {
      id: "test",
      instructions: ["Instruction"],
      model: { id: "test" },
      tools: [],
      workspaceSpec: { rootEntries: [] },
    },
  });
}

function sink() {
  const checkpoints: SessionCheckpoint[] = [];
  const writable = new WritableStream<SessionCheckpoint>({
    write(value) {
      checkpoints.push(value);
    },
  });
  return { checkpoints, target: { sessionId: "source", writable } };
}

describe("session checkpoints", () => {
  it("writes nothing on transient resource capture failure and retries with the seed", async () => {
    const source = { ...session(), sandboxState: { initialized: true, session: null } };
    const { checkpoints, target } = sink();
    const seed = { backendName: "test", metadata: { id: "immutable" } };
    let attempts = 0;
    const sandbox = {
      captureState: async () => ({ initialized: true, session: null }),
      get: async () => null,
      stop: async () => {},
      captureForkCheckpoint: async () => {
        if (++attempts === 1) throw new Error("temporary I/O failure");
        return seed;
      },
    };
    const input = { session: source, delivery: { message: "next" }, target, sandbox };
    await expect(writeSessionCheckpoint(input)).rejects.toThrow("temporary I/O failure");
    expect(checkpoints).toHaveLength(0);
    expect(target.writable.locked).toBe(false);
    await writeSessionCheckpoint(input);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.snapshot.session.sandboxState?.forkCheckpoint).toEqual(seed);
  });

  it("keeps native tool and file history before the replacement message", async () => {
    const initial = session();
    initial.history.push(
      {
        role: "user",
        kind: "user",
        content: [{ type: "file", mediaType: "application/pdf", data: new Uint8Array([1, 2, 3]) }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call",
            toolName: "wordCount",
            input: { text: "hello" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call",
            toolName: "wordCount",
            output: { type: "json", value: { count: 1 } },
          },
        ],
      },
      { role: "assistant", content: "One word." },
    );
    const source = setHarnessEmissionState(initial, {
      sessionStarted: true,
      sequence: 7,
      stepIndex: 0,
      turnId: "",
    });
    const { checkpoints, target } = sink();
    await writeSessionCheckpoint({ session: source, delivery: { message: "replacement" }, target });
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.beforeTurnId).toBe("turn_7");
    expect(checkpoints[0]?.snapshot.session.history).toEqual(initial.history);
    expect(target.writable.locked).toBe(false);
  });

  it("does not checkpoint tool continuation, another session's stream, or an active turn", async () => {
    const source = session();
    const { checkpoints, target } = sink();
    await writeSessionCheckpoint({ session: source, delivery: undefined, target });
    await writeSessionCheckpoint({
      session: source,
      delivery: { message: "new" },
      target: { ...target, sessionId: "other" },
    });
    await writeSessionCheckpoint({
      session: setHarnessEmissionState(source, {
        sessionStarted: true,
        sequence: 1,
        stepIndex: 1,
        turnId: "turn_1",
      }),
      delivery: { message: "new" },
      target,
    });
    expect(checkpoints).toHaveLength(0);
  });

  it("propagates storage failure before model work and releases the writer", async () => {
    const target = {
      sessionId: "source",
      writable: new WritableStream<SessionCheckpoint>({
        write() {
          throw new Error("storage unavailable");
        },
      }),
    };
    await expect(
      writeSessionCheckpoint({ session: session(), delivery: { message: "new" }, target }),
    ).rejects.toThrow("storage unavailable");
    expect(target.writable.locked).toBe(false);
  });
});
