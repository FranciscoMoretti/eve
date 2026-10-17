import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { buildWithNitroRolldown } from "#internal/bundler/nitro-rolldown.js";
import { createCompiledSandboxProviderPrunePlugin } from "./compiled-sandbox-provider-prune-plugin.js";

it("bundles local resource management with the hosted optional-installer stub", async () => {
  const sourceRoot = new URL("../../../", import.meta.url);
  const result = await buildWithNitroRolldown({
    input: fileURLToPath(new URL("execution/sandbox/bindings/microsandbox-runtime.ts", sourceRoot)),
    platform: "node",
    write: false,
    external: (id: string) =>
      !id.startsWith("#") && !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
    plugins: [
      createCompiledSandboxProviderPrunePlugin(),
      {
        name: "eve-test-source-aliases",
        resolveId(id: string) {
          if (id.startsWith("#compiled/")) return { id, external: true };
          if (!id.startsWith("#")) return null;
          return fileURLToPath(new URL(id.slice(1).replace(/\.js$/u, ".ts"), sourceRoot));
        },
      },
    ],
    output: { format: "esm" },
  });
  expect(
    result.output.some((item) => item.type === "chunk" && item.code.includes("MicrosandboxVm")),
  ).toBe(true);
});
