---
issue: https://github.com/FranciscoMoretti/eve/pull/9
status: local-integration
last_updated: "2026-10-17"
---

# Native Next startup retirement evidence

This slice tests the supported startup replacement for the maintained ChatJS fork patch. It does not rebase the maintained branch or port its other contracts.

## Review topology and dependency map

- Candidate base: `codex/chatjs-eve080-base` at upstream eve0.80.1 `e3cea42486e7e32b7b3001bb5912e076b5443ad5`.
- Slice head: `codex/eve080-next-startup`; only inventory/proof artifacts differ from that base.
- Maintained runtime: `francisco/chatjs-package` at `5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c`, unchanged.
- Historical patch comparison: upstream0.61 `241e5004cb1ac1e2bcd716a154bbc64f5a61cc53` → maintained SHA above.
- App prerequisite commits `448df985a` / `5b28112d4` and [ChatJS #847](https://github.com/FranciscoMoretti/chat-js/pull/847) supply prior dependency/accounting evidence. No companion app change is needed for this standalone proof.

A PR against the maintained branch would include the entire upstream upgrade and obscure the slice. The dedicated exact-upstream base makes this proof/inventory diff honest. This PR contains **zero production source deletions**. It establishes that the specific startup patch need not be carried into an integrated upgrade candidate. It does not establish that the other missing fork contracts are unnecessary. Their dispositions remain in the top README.

Standalone startup proof can proceed independently of the full application's red compiler probes. Actual package adoption still requires those app ports, stable-world performance/recovery disposition, and full integration. Inventory10→9 is conditional on adopting the tested startup replacement, not on merging this proof branch alone.

## Exact patch and upstream replacement

[retired-maintained-delta.patch](retired-maintained-delta.patch) is the unedited two-file historical delta:

| Historical owner                             | Delta  | Behavior                                                                                                                |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/eve/src/public/next/index.ts`      | +27/−9 | Start all local/named workers during `phase-production-server`, then reuse their resolved destinations inside rewrites. |
| `packages/eve/src/public/next/index.test.ts` | +22/−0 | Assert production config loading starts the worker before `rewrites()` runs.                                            |

The retained native implementation is more explicit:

1. [Upstream `withEve`](https://github.com/vercel/eve/blob/e3cea42486e7e32b7b3001bb5912e076b5443ad5/packages/eve/src/public/next/index.ts#L492) starts each local agent when Next loads production-server config. This matters because `next start` serves saved build rewrites and does not invoke the rewrite function again.
2. [The native server owner](https://github.com/vercel/eve/blob/e3cea42486e7e32b7b3001bb5912e076b5443ad5/packages/eve/src/public/next/server.ts#L44) keys in-flight/completed startup promises by application root **and origin**. Concurrent/repeated config loading in one process shares the worker. A rejected startup removes its promise, permitting retry.
3. [The process launcher](https://github.com/vercel/eve/blob/e3cea42486e7e32b7b3001bb5912e076b5443ad5/packages/eve/src/shared/framework-eve-server.ts#L455) runs each built `.output/server/index.mjs` on its resolved loopback port. Missing output fails explicitly; early child exit rejects readiness.

The old patch should not be transplanted onto these owners. The retained upstream implementation supplies the contract; this slice adds evidence at the actual Next/process boundary.

## Test value and scope

Upstream's [config integration tests](https://github.com/vercel/eve/blob/e3cea42486e7e32b7b3001bb5912e076b5443ad5/packages/eve/src/public/next/index.integration.test.ts) already verify mocked spawning and config behavior. Its framework scenario tests cover Vercel assembly. Neither independently proves local `next start` consumes persisted rewrites while real agent processes become reachable.

This proof's primary contract is local production startup/routing. A credible regression moves startup back into the rewrite callback, keeps a rejected promise, or starts duplicate workers for repeated config loads. Real build output, subprocesses and HTTP ports are necessary to catch those failures. No production export, flag or test-only seam is added. Fixture content is authored inline; no trees are added under `packages/eve/test/fixtures`.

The negative control deliberately supplies build phase to the wrapper when Next loads server config. It preserves saved rewrites while suppressing startup, reproducing the missing-startup condition. Both proxy health checks must fail and no agent worker may exist. The positive run uses the actual phase and must reach both agents. This is a controlled lifecycle regression, not a claim to have executed the old0.61 binary.

The retry check temporarily replaces one disposable built entry with an immediate throw. It asserts the real child fails before readiness, restores the exact built entry, and retries in the **same process**. Both agents must then become healthy with exactly two workers total. The successful sibling is retained rather than duplicated.

[RESULTS.json](RESULTS.json) records measured ports, saved rewrites, process identities, build commands, and outcomes. All environment values and output directories are disposable. No app migration script, configured database, provider request, deployment, or sandbox prewarm is used. Health probes exercise transport readiness; they do not validate ChatJS tools or session behavior. Duplicate-worker claims apply to repeated/concurrent config evaluation **within one host process**, not independent competing production hosts.

## Reproduce

Use Node24 and pnpm12.7.0:

```sh
cd research/chatjs-next-startup
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm fmt
```

The package pins eve0.80.1 and ChatJS's Next16.3.0. The published upstream package is the runtime under test; source links above identify its exact release. No modified source package is substituted. Real minimal eve builds and a minimal Next webpack build are part of the proof. Temporary evidence remains at the path printed by the runner; owned process groups are stopped in cleanup.

Validation completed on Node24.20.0: both real eve builds, the Next16.3.0 webpack build, negative control (two500 responses/no workers), production run (two200 responses/two workers), and same-process retry passed. Syntax, focused oxlint, formatting, frozen dependency installation, and `git diff --check` passed. No TypeScript production source changed; whole-workspace type checking was not run.

No whole-monorepo build, full scenario tier, existing approval suite, or prerequisite suite is rerun. This research-only slice does not change published package behavior and needs no changeset. The nine other inventory groups are explicitly pending dispositions/adoption, not implicitly ported.
