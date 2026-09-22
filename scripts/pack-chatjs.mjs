import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep the upstream workspace name and workflow identities stable. Rename only
// the distributable, after pnpm has resolved catalog/workspace dependencies.
const root = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = join(root, "packages/eve");
const output = resolve(process.argv[2] ?? join(root, "artifacts"));
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const version = `${manifest.version}-chatjs.0`;
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
  run("pnpm", ["pack", "--pack-destination", temporary], packageRoot);
  run("tar", ["-xzf", join(temporary, `eve-${manifest.version}.tgz`), "-C", temporary], root);
  const staging = join(temporary, "package");
  const packed = JSON.parse(await readFile(join(staging, "package.json"), "utf8"));
  packed.name = name;
  packed.version = version;
  packed.homepage = "https://github.com/FranciscoMoretti/eve";
  packed.bugs = { url: "https://github.com/FranciscoMoretti/eve/issues" };
  packed.repository.url = "git+https://github.com/FranciscoMoretti/eve.git";
  packed.publishConfig = { access: "public", tag: "chatjs" };
  // Lifecycle scripts refer to the source workspace and must not run in consumers.
  delete packed.scripts;
  delete packed.devDependencies;
  await writeFile(join(staging, "package.json"), `${JSON.stringify(packed, null, 2)}\n`);
  run("npm", ["pack", "--ignore-scripts", "--pack-destination", output, "--quiet"], staging);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
