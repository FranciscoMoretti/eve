import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Usage: node scripts/test-chatjs-package.mjs <tarball>");
const archive = resolve(process.argv[2]);
const temporary = await mkdtemp(join(tmpdir(), "chatjs-eve-consumer-"));
try {
  // Bun stores an aliased dependency under its scoped distribution name, away
  // from the application's node_modules/eve alias. Exercise true self-resolution.
  const isolated = join(temporary, "isolated/node_modules/@chat-js");
  await mkdir(isolated, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", isolated]);
  await rename(join(isolated, "package"), join(isolated, "eve"));
  const ownRoot = await realpath(join(isolated, "eve"));
  const resolver = await import(pathToFileURL(join(ownRoot, "dist/src/internal/application/package.js")).href);
  const scopedManifest = JSON.parse(await readFile(join(ownRoot, "package.json"), "utf8"));
  for (const specifier of ["eve", "eve/client", "eve/context"]) {
    assert.ok(resolver.resolvePackageDependencyPath(specifier).startsWith(ownRoot));
  }
  assert.deepEqual(resolver.resolveInstalledPackageInfo(), { name: "eve", version: scopedManifest.version.split("-chatjs.")[0] });
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { eve: `file:${archive}`, ai: "7.0.105" },
    }),
  );
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: temporary,
    stdio: "inherit",
  });
  const installed = JSON.parse(
    await readFile(join(temporary, "node_modules/eve/package.json"), "utf8"),
  );
  assert.equal(installed.name, "@chat-js/eve");
  assert.equal(installed.peerDependencies.microsandbox, "^0.6.18");
  assert.ok(installed.version.includes("-chatjs."));
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { access } from 'node:fs/promises';
    import manifest from 'eve/package.json' with { type: 'json' };
    const root = new URL('./node_modules/eve/', import.meta.url);
    for (const entry of Object.values(manifest.exports)) {
      for (const value of typeof entry === 'string' ? [entry] : Object.values(entry)) {
        if (typeof value === 'string' && !value.includes('*') && !value.startsWith('./src/')) await access(new URL(value, root));
      }
    }
    const transcript = await import('eve/transcript');
    assert.ok(Object.keys(transcript).length > 0);
    await import('eve/channels/eve');
    await import('eve/hooks');
    await import('eve/tools/approval');
    const { resolveInstalledPackageInfo, resolvePackageRoot } = await import(new URL('dist/src/internal/application/package.js', root));
    assert.deepEqual(resolveInstalledPackageInfo(), { name: 'eve', version: '0.61.0' });
    assert.equal(resolvePackageRoot(), root.pathname.slice(0, -1));
    const { applyWorkflowTransform, isAuthoredApplicationRoot } = await import(new URL('dist/src/internal/workflow-bundle/workflow-builders.js', root));
    assert.equal(isAuthoredApplicationRoot(resolvePackageRoot()), false);
    const transformed = await applyWorkflowTransform('src/execution/tools/sleep-workflow.ts', 'export async function executeSleepTool() { "use workflow"; return "done"; }', 'metadata', new URL('dist/src/execution/tools/sleep-workflow.js', root).pathname, resolvePackageRoot());
    assert.ok(transformed.code.includes('workflow//eve@0.61.0//executeSleepTool'));

  `,
    ],
    { cwd: temporary, stdio: "inherit" },
  );
  execFileSync(process.execPath, ["node_modules/eve/bin/eve.js", "--version"], {
    cwd: temporary,
    stdio: "inherit",
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
