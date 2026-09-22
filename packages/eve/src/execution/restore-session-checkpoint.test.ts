import { expect, it } from "vitest";
import { createSession } from "#execution/session.js";
import { createDurableSessionState } from "#execution/durable-session-store.js";
import { setHarnessEmissionState } from "#harness/emission-state.js";
import { restoreSessionCheckpoint } from "#execution/restore-session-checkpoint.js";
import type { SessionCheckpoint } from "#execution/session-checkpoint-contract.js";

function fresh(sessionId: string) {
  return createSession({
    sessionId,
    continuationToken: `${sessionId}-inbox`,
    turnAgent: {
      id: "test",
      instructions: ["Current instructions"],
      model: { id: "current-model" },
      tools: [],
      workspaceSpec: { rootEntries: [] },
    },
  });
}
function checkpoint(): SessionCheckpoint {
  const source = setHarnessEmissionState(
    {
      ...fresh("source"),
      localSandboxIdentity: {
        version: 1,
        sessionId: "source",
        backendName: "microsandbox",
        appRoot: "/source/root",
      },
      state: { "source-secret-state": { approval: "source-request", consumedTokens: 123 } },
      history: [
        { role: "user", kind: "user", content: "remember this" },
        { role: "assistant", content: "Remembered." },
      ],
    },
    { sessionStarted: true, sequence: 4, stepIndex: 0, turnId: "" },
  );
  const snapshot = createDurableSessionState({ session: source }).snapshot;
  if (!snapshot) throw new Error("Missing test snapshot");
  return {
    version: 1,
    sessionId: "source",
    beforeTurnId: "turn_4",
    snapshot: { ...snapshot, version: 2 },
  };
}

it("restores history and sequence while retaining fresh target identity, model and state", () => {
  const source = checkpoint();
  const target = fresh("branch");
  const restored = restoreSessionCheckpoint({ target, checkpoint: source });
  expect(restored.sessionId).toBe("branch");
  expect(restored.localSandboxIdentity).toBeUndefined();
  expect(restored.continuationToken).toBe("branch-inbox");
  expect(restored.agent).toBe(target.agent);
  expect(restored.state?.["source-secret-state"]).toBeUndefined();
  expect(restored.state?.["eve.harness.emission"]).toEqual({
    sessionStarted: false,
    sequence: 4,
    stepIndex: 0,
    turnId: "",
  });
  expect(restored.history).toEqual(source.snapshot.session.history);
  restored.history.push({ role: "user", kind: "user", content: "branch only" });
  expect(source.snapshot.session.history).toHaveLength(2);
});

it("rejects wrong identities and an already-used target", () => {
  const source = checkpoint();
  expect(() => restoreSessionCheckpoint({ target: fresh("source"), checkpoint: source })).toThrow(
    "Invalid",
  );
  expect(() =>
    restoreSessionCheckpoint({
      target: fresh("branch"),
      checkpoint: { ...source, sessionId: "other" },
    }),
  ).toThrow("Invalid");
  expect(() =>
    restoreSessionCheckpoint({
      target: {
        ...fresh("branch"),
        history: [{ role: "user", kind: "user", content: "existing" }],
      },
      checkpoint: source,
    }),
  ).toThrow("fresh target");
});

it("does not revive unfinished tools or silently discard sandbox attachments", () => {
  const source = checkpoint();
  source.snapshot.session.history.push({
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "pending", toolName: "dangerous", input: {} }],
  });
  expect(() => restoreSessionCheckpoint({ target: fresh("branch"), checkpoint: source })).toThrow(
    "unresolved tool",
  );
  source.snapshot.session.history.pop();
  source.snapshot.session.history.push({
    role: "user",
    kind: "user",
    content: [
      { type: "file", mediaType: "image/png", data: new URL("eve-sandbox:?path=/old/file") },
    ],
  });
  expect(() => restoreSessionCheckpoint({ target: fresh("branch"), checkpoint: source })).toThrow(
    "resource copying",
  );
});
