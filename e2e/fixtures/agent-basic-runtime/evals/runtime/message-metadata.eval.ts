import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

/** CI-only wire and durable rewind coverage; no model-dependent assertion. */
export default defineEval({
  description: "User message metadata survives wire delivery and a durable rewind.",
  async test(t) {
    const metadata = { editor: { selectedTool: null }, turnId: "application-value" };
    const first = await t.send("Reply briefly.", { messageMetadata: metadata });
    first.notEvent("turn.failed");
    const received = first.events.find((event) => event.type === "message.received");
    await t.require(
      received?.type === "message.received" ? received.data.metadata : undefined,
      equals(metadata),
    );

    const replay = await t.target.watchTurn(first.sessionId, { startIndex: 0 }).result();
    const replayed = replay.events.find((event) => event.type === "message.received");
    await t.require(
      replayed?.type === "message.received" ? replayed.data.metadata : undefined,
      equals(metadata),
    );

    const second = await t.send("Reply briefly again.");
    const next = second.events.find((event) => event.type === "message.received");
    await t.require(
      next?.type === "message.received" ? next.data.metadata : undefined,
      equals(undefined),
    );

    const invalid = await t.target.fetch(`/eve/v1/session/${first.sessionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "invalid", messageMetadata: [] }),
    });
    await t.require(invalid.status, equals(400));
  },
});
