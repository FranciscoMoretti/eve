import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import { defineTool, type ToolDefinition } from "#tools/definition.js";
import type { DynamicToolEntry, DynamicToolSet } from "#tools/dynamic.js";

test("dynamic entries retain their approval input contract", () => {
  const entry: DynamicToolEntry<{ path: string }, { size: number }> = {
    description: "Read a path",
    inputSchema: z.object({ path: z.string() }),
    execute: (input) => ({ size: input.path.length }),
    approval: {
      request(context) {
        expectTypeOf(context.toolInput).toEqualTypeOf<Readonly<{ path: string }> | undefined>();
        return context.toolInput?.path ? "user-approval" : "denied";
      },
      response(context) {
        expectTypeOf(context.request.toolInput).toEqualTypeOf<
          Readonly<{ path: string }> | undefined
        >();
        return { status: "allowed" };
      },
    },
    approvalKey(input) {
      expectTypeOf(input).toEqualTypeOf<Readonly<{ path: string }>>();
      return input.path;
    },
  };
  expect(entry.approvalKey?.({ path: "report" })).toBe("report");
});

test("heterogeneous authored tools satisfy a dynamic set without widening inference", () => {
  const text = defineTool({
    description: "Text input",
    inputSchema: z.object({ text: z.string() }),
    execute: (input) => ({ length: input.text.length }),
    approval: (context) => (context.toolInput?.text ? "user-approval" : "denied"),
    approvalKey: (input) => input.text,
  });
  const count = defineTool({
    description: "Numeric input",
    inputSchema: z.object({ count: z.number() }),
    outputSchema: z.object({ doubled: z.number() }),
    execute: (input) => ({ doubled: input.count * 2 }),
    approval: {
      request: (context) => (context.toolInput?.count ? "user-approval" : "denied"),
      response(context) {
        expectTypeOf(context.request.toolInput).toEqualTypeOf<
          Readonly<{ count: number }> | undefined
        >();
        return { status: "allowed" };
      },
    },
    approvalKey: (input) => String(input.count),
  });
  const entries = { text, count } satisfies DynamicToolSet;
  expectTypeOf(entries.text.execute).parameter(0).toEqualTypeOf<{ text: string }>();
  expectTypeOf(entries.count.execute).parameter(0).toEqualTypeOf<{ count: number }>();
  expectTypeOf(entries.text).toMatchTypeOf<ToolDefinition<{ text: string }, { length: number }>>();
  expectTypeOf(entries.count).toMatchTypeOf<
    ToolDefinition<{ count: number }, { doubled: number }>
  >();
  expect(entries.text.approvalKey?.({ text: "report" })).toBe("report");
  expect(entries.count.approvalKey?.({ count: 2 })).toBe("2");
});
