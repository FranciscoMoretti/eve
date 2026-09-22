import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

export default defineEval({
  description:
    "Completion hook annotations and attempt evidence persist before idle and replay over the wire.",
  async test(t) {
    const turn = await t.send("Reply briefly.", { messageMetadata: { hookResultFixture: true } });
    turn.notEvent("turn.failed");
    const result = turn.events.find((event) => event.type === "hook.result");
    await t.require(
      result?.type === "hook.result" ? result.data.responseMetadata : undefined,
      equals({ suggestions: ["Fixture next step"] }),
    );
    await t.require(
      result?.type === "hook.result" ? result.data.modelCalls : undefined,
      equals([{ modelId: "fixture-uncompleted", failed: true }]),
    );
    const types = turn.events.map((event) => event.type);
    await t.require(
      types.indexOf("hook.result") > types.indexOf("turn.completed") &&
        types.indexOf("hook.result") < types.indexOf("session.waiting"),
      equals(true),
    );
    const replay = await t.target.watchTurn(turn.sessionId, { startIndex: 0 }).result();
    await t.require(
      replay.events.find((event) => event.type === "hook.result"),
      equals(result),
    );
    const next = await t.send("Reply briefly again.");
    next.notEvent("hook.result");
  },
});
