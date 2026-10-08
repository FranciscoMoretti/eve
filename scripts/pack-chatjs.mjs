import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep the upstream workspace name and workflow identities stable. Rename only
// the distributable, after building with the upstream workspace identity.
const root = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = join(root, "packages/eve");
const output = resolve(process.argv[2] ?? join(root, "artifacts"));
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const version = `${manifest.version}-chatjs.3`;
const name = "@chat-js/eve";
const temporary = await mkdtemp(join(tmpdir(), "chatjs-eve-pack-"));
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      EVE_PACKAGE_DEPENDENCY_URL: `npm:${name}@${version}`,
    },
  });

try {
  await mkdir(output, { recursive: true });
  for (const script of ["check-bin-runtime-dependencies", "build-js", "copy-docs", "stamp-version-tokens"]) {
    run(process.execPath, [`./scripts/${script}.mjs`], packageRoot);
  }
  run(process.execPath, ["../../scripts/copy-package-license.mjs", "."], packageRoot);
  const staging = join(temporary, "package");
  await mkdir(staging);
  for (const file of [...manifest.files, "LICENSE"]) {
    await cp(join(packageRoot, file), join(staging, file), { recursive: true });
  }
  const packed = structuredClone(manifest);
  const workspace = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
  const aiVersion = /^  ai: "([^"]+)"$/m.exec(workspace)?.[1];
  if (packed.peerDependencies.ai !== "catalog:" || !aiVersion) {
    throw new Error("Review the AI peer dependency catalog before packing.");
  }
  packed.peerDependencies.ai = aiVersion;
  packed.name = name;
  packed.version = version;
  packed.homepage = "https://github.com/FranciscoMoretti/eve";
  packed.bugs = { url: "https://github.com/FranciscoMoretti/eve/issues" };
  packed.repository.url = "git+https://github.com/FranciscoMoretti/eve.git";
  packed.publishConfig = { access: "public", tag: "chatjs" };
  // Lifecycle scripts refer to the source workspace and must not run in consumers.
  delete packed.scripts;
  delete packed.devDependencies;
  delete packed.packageManager;
  for (const section of [packed.dependencies, packed.peerDependencies, packed.optionalDependencies]) {
    if (Object.values(section ?? {}).some((value) => /^(workspace|catalog):/.test(value))) {
      throw new Error("Unresolved workspace dependency in distributable.");
    }
  }
  await writeFile(join(staging, "package.json"), `${JSON.stringify(packed, null, 2)}\n`);
  run("bun", ["pm", "pack", "--destination", output], staging);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
