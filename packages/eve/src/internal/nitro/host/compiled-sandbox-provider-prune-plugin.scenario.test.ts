import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

import { buildSingleRolldownChunk } from "#internal/bundler/nitro-rolldown.js";
import { createCompiledSandboxProviderPrunePlugin } from "./compiled-sandbox-provider-prune-plugin.js";

afterEach(() => vi.unstubAllEnvs());

async function bundleHostedConsumer(source: string) {
  const sourceRoot = new URL("../../../", import.meta.url);
  const entry = "\0hosted-consumer";
  return await buildSingleRolldownChunk("hosted sandbox consumer", {
    input: entry,
    platform: "node",
    external: (id: string) =>
      !id.startsWith("#") && !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
    plugins: [
      createCompiledSandboxProviderPrunePlugin(),
      {
        name: "eve-test-hosted-consumer",
        resolveId(id: string) {
          if (id === entry) return entry;
          if (id.startsWith("#compiled/")) return { id, external: true };
          if (!id.startsWith("#")) return null;
          return fileURLToPath(new URL(id.slice(1).replace(/\.js$/u, ".ts"), sourceRoot));
        },
        load(id: string) {
          return id === entry ? source : null;
        },
      },
    ],
    output: { format: "esm" },
  });
}

it("bundles a retained microsandbox runtime when hosted installation is pruned", async () => {
  await expect(
    bundleHostedConsumer(
      'export { MicrosandboxVm } from "#execution/sandbox/bindings/microsandbox-runtime.js";',
    ),
  ).resolves.toMatchObject({ type: "chunk" });
});

it("preserves the development flag without enabling hosted installation", async () => {
  const chunk = await bundleHostedConsumer(`
    export { isEveDevEnvironment } from "#internal/application/dev-environment.js";
    export { installPackageIntoProject } from "#internal/application/optional-package-install.js";
  `);
  const bundled = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );

  for (const [flag, expected] of [
    [undefined, false],
    ["0", false],
    ["true", false],
    ["1", true],
  ] as const) {
    vi.stubEnv("EVE_DEV", flag);
    expect(bundled.isEveDevEnvironment()).toBe(expected);
    expect(() => bundled.installPackageIntoProject()).toThrow(
      "Optional local sandbox engines cannot be installed in hosted server runtimes.",
    );
  }
});
