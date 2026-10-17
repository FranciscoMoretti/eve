import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { useTemporaryDirectories } from "#internal/testing/use-temporary-app-roots.js";

const createScratchDirectory = useTemporaryDirectories();
const run = promisify(execFile);

describe("package module path", () => {
  // `node -e` defines a global `__filename` of "[eval]", which ESM modules can see.
  it("loads eve/next under node -e", async () => {
    const entry = new URL("../../../dist/src/public/next/index.js", import.meta.url).href;
    const { stdout } = await run(process.execPath, [
      "-e",
      `import(${JSON.stringify(entry)}).then((next) => console.log(typeof next.withEve))`,
    ]);

    expect(stdout.trim()).toBe("function");
  });
});

describe("installed package self references", () => {
  it.each(["eve", "@chat-js/eve"])("resolves eve/context inside isolated %s", async (name) => {
    const root = await createScratchDirectory("eve-package-self-reference-");
    const manifest = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    await writeFile(join(root, "package.json"), JSON.stringify({ ...manifest, name }));
    for (const file of [
      "internal/application/package.js",
      "internal/application/stamped-package-version.js",
      "internal/package-name.js",
    ]) {
      const target = join(root, "dist/src", file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(new URL(`../../../dist/src/${file}`, import.meta.url), target);
    }
    const contextPath = join(root, "dist/src/public/context/index.js");
    await mkdir(dirname(contextPath), { recursive: true });
    await writeFile(contextPath, "export {};\n");
    const entry = pathToFileURL(join(root, "dist/src/internal/application/package.js")).href;
    const { stdout } = await run(process.execPath, [
      "--input-type=module",
      "-e",
      `const { resolvePackageDependencyPath } = await import(${JSON.stringify(entry)}); console.log(resolvePackageDependencyPath("eve/context"));`,
    ]);
    expect(stdout.trim()).toBe(realpathSync.native(contextPath));
  });
});
