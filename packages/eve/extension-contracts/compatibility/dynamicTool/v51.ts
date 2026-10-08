import { defineDynamic, defineTool } from "#public/tools/index.js";
import type { DynamicToolSet } from "#public/tools/index.js";

// Epoch 51 authored untyped dynamic tools with record-shaped approval input.
export default defineDynamic({
  events: {
    "session.started": () =>
      ({
        inspect: defineTool({
          description: "Inspect an approved resource.",
          inputSchema: { type: "object", properties: { resource: { type: "string" } } },
          approval: {
            request: (context) => (context.toolInput?.resource ? "user-approval" : "denied"),
            response: () => ({ status: "allowed" }),
          },
          approvalKey: (input) => String(input.resource),
          execute: (input) => ({ resource: String(input.resource) }),
        }),
      }) satisfies DynamicToolSet,
  },
});
