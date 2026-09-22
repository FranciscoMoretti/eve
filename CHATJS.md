# ChatJS eve distribution

This branch contains the native implementation and tests previously stored in
ChatJS PR #447 as `patches/eve-0.61.0.source.patch`. Its base is upstream
`eve@0.61.0` (`241e5004cb1ac1e2bcd716a154bbc64f5a61cc53`). Production still uses
native checkpoints; the history continuation experiment does not replace them.

## Build and test a package

Use Node 24+ and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm pack:chatjs
node scripts/test-chatjs-package.mjs artifacts/chat-js-eve-0.61.0-chatjs.0.tgz
pnpm guard:invariants
pnpm --filter eve exec tsc --noEmit -p tsconfig.json
pnpm --filter eve exec vitest run --config vitest.unit.config.ts
pnpm --filter eve exec vitest run --config vitest.integration.config.ts src/execution/session-history-seed.integration.test.ts src/execution/session-transcript-seed.integration.test.ts src/execution/session-fork.integration.test.ts src/execution/session-resource-fork.integration.test.ts src/execution/session-checkpoint.integration.test.ts src/execution/hook-results.integration.test.ts src/harness/seed-attachments.integration.test.ts
```

`pack:chatjs` runs the normal source build and pnpm packaging, then changes the
package's distribution metadata to `@chat-js/eve@0.61.0-chatjs.0`. The workspace
package remains named `eve`, keeping internal imports, workspace dependencies,
and workflow identities stable. pnpm resolves catalog dependencies before the
archive is renamed. CLI scaffold dependency tokens point to the scoped package.
The package declares the Microsandbox 0.6 SDK contract directly.

The consumer smoke test installs the archive as `eve` using npm, checks public
export files and declarations, imports the ChatJS-specific transcript API and
other runtime entrypoints, and runs the CLI. It needs no provider credentials or
database. This is a package test, not a certification of existing workflow-run
migration or live provider/sandbox recovery.

## Test alongside ChatJS

Use a separate ChatJS worktree based on the package-integration change. Install
the tarball under the dependency key `eve`, and remove the old `eve@0.61.0`
entry from root `patchedDependencies`. Both `apps/chat/package.json` and
`apps/chat/tests/eve-fixture/package.json` must use the same artifact.

Run ChatJS lint, workspace type checks, native approval-contract tests and
scaffold tests. Do not publish or commit absolute local tarball paths. For
shared CI, use the exact published prerelease through an npm alias:

```json
{ "dependencies": { "eve": "npm:@chat-js/eve@0.61.0-chatjs.0" } }
```

Generated ChatJS applications retain this dependency rather than rebuilding and
vendoring an eve patch. The unrelated MCP and Postgres patches remain.

## Publish

The `ChatJS eve package` workflow builds and tests an artifact by default.
Its optional publish job uses the `npm` GitHub environment and npm trusted
publishing. Configure `@chat-js/eve` to trust repository
`FranciscoMoretti/eve`, workflow `chatjs-package.yml`, environment `npm`.
A first publication may require an authenticated owner of the `@chat-js` npm
scope to bootstrap the package:

```sh
npm publish artifacts/chat-js-eve-0.61.0-chatjs.0.tgz --access public --tag chatjs
```

Do not publish until the package and ChatJS checks pass. Publish the tested
archive rather than rebuilding it. After publication, pin the alias in ChatJS,
regenerate its Bun lockfile, rerun install/contract/scaffold checks, and remove
the obsolete eve source patch, compiled patch, and `build-eve-patch.ts`.

The upstream release workflow is restricted to `vercel/eve`; this fork must not
publish upstream packages or Vercel container images. Each release is immutable.
Increment the fork revision in `scripts/pack-chatjs.mjs` and update the workflow
artifact paths together. Keep the upstream base version separate from that
revision. Future upstream upgrades are explicit rebases with regression checks.

## Migration validation

The local package passes npm consumer imports, declaration/export checks, CLI
startup, and assertions that the renamed package keeps the existing sleep
workflow identity. Native checks pass: 9,149 unit tests (one skipped), 44 focused
integration tests, production and test type checks, and repository invariant
guards. The retained extension authoring examples compile with the current API;
new capability reports record the additive fork contracts without removing old
epochs. Source research notes identify ChatJS PR #447 as their provenance.

ChatJS passes lint, all seven workspace type checks, 359 focused runtime tests,
and 22 scaffold/vendor tests against this archive. Publication and the registry
lockfile gate remain pending npm authentication. These results do not certify
migration of existing deployed Workflow runs or live provider recovery.
