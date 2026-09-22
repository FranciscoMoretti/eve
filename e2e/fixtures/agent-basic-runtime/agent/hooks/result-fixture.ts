import { defineHook } from "eve/hooks";
import { defineState } from "eve/context";

const requested = defineState("fixture.hook-result", () => false);
export default defineHook({
  events: {
    "message.received": (event) => {
      requested.update(() => event.data.metadata?.hookResultFixture === true);
    },
    "turn.completed": () => {
      if (!requested.get()) return;
      return {
        responseMetadata: { suggestions: ["Fixture next step"] },
        modelCalls: [{ modelId: "fixture-uncompleted", failed: true }],
      };
    },
  },
});
