## ChatJS eve 0.80.1 integration candidate

This branch is a **draft for review, not a release or production cutover**.
The paired ChatJS branch now compiles both real agents and has local guest and
authenticated integration evidence. External model and Blob transport use
explicit disposable fixtures; application authentication, workflow execution,
PostgreSQL persistence and local microsandbox VMs are real.

[Umbrella #9](https://github.com/FranciscoMoretti/eve/pull/9) targets
`francisco/chatjs-package`, maintained baseline
`5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c`.
The umbrella includes the upstream upgrade. Review the **residual fork** against
`codex/chatjs-eve080-base`, exact upstream 0.80.1
`e3cea42486e7e32b7b3001bb5912e076b5443ad5`.

### Retained runtime contracts

| Contract                                        | Why it remains                                                                                                                                                                                                                              | Removal criterion                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Trusted fresh-copy seeds                        | Authenticated channel resolution supplies an accepted destination reservation. History is installed before first input without replaying historical model/tool work. Copied files use strict destination staging and digest verification.   | Upstream supplies equivalent trusted initialization, projection and attachment ownership.              |
| Serialized copy checkpoints                     | The source owner captures an exact idle turn boundary. Private durable receipts precede readiness; authorized forks restore the retained history and immutable sandbox artifact. Imported seed prefixes are bounded and privately retained. | Upstream supplies equivalent exact-boundary capture, authorization and immutable restore.              |
| Required checkpoint callback                    | ChatJS must commit its document manifest before a checkpoint becomes ready. The dedicated callback propagates failure; ordinary stream/billing/logging hooks remain best effort.                                                            | Upstream offers a serialized commit callback with required persistence and idempotent retry semantics. |
| Immutable local sandbox resources               | Existing session metadata retains owner/cache identity, stable VM IDs, snapshot digest/path receipts, borrowed artifacts and allocation/removal phases. Retirement fences new allocation; cleanup requires confirmed native absence.        | Upstream supplies equivalent provider ownership, retirement and confirmed removal.                     |
| Microsandbox SDK alignment and development stop | SDK 0.6.18 matches ChatJS. Development shutdown stops the same verified persisted VM and preserves its receipts, without starting snapshot allocation inside the CLI's bounded exit window.                                                 | Upstream supports the same SDK lifecycle and ownership guarantees.                                     |

No native admission ledger or create/send recovery lookup is retained. The stale
lookup changeset was removed. ChatJS owns immutable dispatch intent and keeps
only positively known response bindings. Lost-response creates or sends may
remain unknown permanently; absence never authorizes another dispatch.
The separate accepted-seed/copy resolver uses upstream `resolveSession`, with an
app adapter pinned to 0.80.1's auth-scoped token derivation and parity coverage.

Message selection and logical display identity are app-owned projections of
exact native event/delivery bindings. Unknown, foreign, ambiguous or inherited
bindings acquire no new metadata. Sharing sanitizes the projected transcript.
No legacy decoder, old-session migration or historical billing import is added.

### Upstream replacements and companion review

Native Next startup, resumable streams and exact approval receipts replace the
corresponding maintained patches. Their focused evidence remains in
[Startup #8](https://github.com/FranciscoMoretti/eve/pull/8),
[Streaming #10](https://github.com/FranciscoMoretti/eve/pull/10) and
[Approvals #11](https://github.com/FranciscoMoretti/eve/pull/11), in that order.
All three are included here. Historical fork #1, #2 and #7 are not superseded.
[ChatJS #847](https://github.com/FranciscoMoretti/chat-js/pull/847) is merged.
The old independent app proof PRs #848/#849 are not the integrated app branch;
#848's published route assertion is stale. The integrated branch corrects it.

The remaining original inventory groups map to the retained contracts above
(checkpoints/forks, history import, attachments, sandbox lifecycle), app-owned
alternatives (message metadata, admission), and the paired package validation
below (distribution). They are not an automatic queue to port old APIs.

### Exact paired package and evidence

Runtime candidate: signed+DCO commit `efe221c7`.
The app selects `.eve-upgrade/eve-0.80.1-efe221c7.tgz` in all four consumers.
SHA-256: `3c7be9eb1e6b9b3a71633dfe31d565f1922c44fba107937977210e051db22fa9`.
Later documentation-only commits do not change that tested runtime candidate.
The app branch is `codex/eve080-integrated-upgrade`, based on merged main
`c0ab1c0504bb3da73ca0f3625f66c47bf69e042e`. Its committed evidence lives in
`apps/chat/tests/eve-upgrade/README.md` and `authenticated-evidence.json`.
The tarball is a local integration artifact, not a published package or production pin.

Validated locally:

- Both agents compile; all eight app type tasks and root lint pass. Guest and
  authenticated create/send/stream/reconnect/cancel run through the real proxy.
- Owner document create/edit, stale revision rejection, browser approval and
  foreign rejection pass. The integration fixed disabled approval controls.
- Authenticated upload, native attachment URL replay and Edit restoration pass;
  foreign download/submission is rejected. Transport uses a disposable Blob fixture.
- App SIGKILL after native acceptance leaves the same dispatch unknown after
  restart and does not resend. A separate native post-commit SIGKILL retains its
  checkpoint and copy boundary after restart.
- A real native owner captured a VM checkpoint, the source advanced, and a copy
  read the original file under its own session ID. Foreign checkpoint access was
  rejected. Development stop preserved receipts; `eve dev --resume` restored the
  source's latest file in the same VM. Final owned session cleanup reached zero.
- Real SDK resource checks cover retirement/allocation races, unknown allocation,
  source cleanup with a live child, failed removal/retry and replacement identity
  rejection. The authenticated worker route separately verifies copy retention.
- All 60 native workspace type tasks, targeted unit/integration tests, lint,
  invariant guard and docs checks pass. The shutdown regression failed before
  repair because it lost ownership metadata, and passes with preserved receipts.

Source-owner/VM host evidence: `/tmp/eve080-owner-vm-persisted-final.log`,
`/tmp/eve080-owner-vm-events.json`, `/tmp/eve080-owner-vm-metadata.json`,
`/tmp/eve080-owner-vm-resumed.json`, `/tmp/eve080-owner-vm-final-cleanup.log`.
Provider evidence and reproduction:
[resource proof](research/chatjs-native-checkpoints/README.md#local-resource-retirement).

### Limits and release gates

Resource retirement is explicitly local: `MSB_BACKEND=local`, one canonical
cache, matching HOME/MSB_HOME, and an absolute MSB_HOME when set. Remote or
production hosts, cache mismatch, unattributed metadata and crashed locks fail
closed. Locks are never stolen or expired. This is not distributed fencing.
App copy-retention policy remains separate from native borrower facts.

The earlier owner/VM proof uses a deterministic authored tool fixture. The
[combined authenticated app evidence](https://github.com/FranciscoMoretti/chat-js/blob/ec381a867/apps/chat/tests/eve-upgrade/REQUIREMENTS.md)
now also verifies document revisions, owned files and bound reservations with an
actual immutable VM fork, plus an independently allocated saved public copy.
Authenticated MCP checks use real connector rows, current database policy and
owner approval receipts with disposable HTTP transport. The temporary fetch/dispatcher
injection used for that transport does not verify live OAuth, SSRF or DNS pinning.
There is no claim of a kill inside the native checkpoint commit window: that boundary has injected storage
fault coverage, while actual native SIGKILL occurs after commit. Early failing
shutdown fixtures are retained for inspection when their ownership or allocation
receipt is unknown; final successful fixture sessions were purged.

Local approval route captures pass in four viewport/theme variants. Fleet visual
comparison was blocked by missing `UIVERIFY_API_KEY`. Full CI/scenario/e2e tiers
and production deployment were not run locally. The PostgreSQL consumed-prefix
patch remains separate. Review CI, distribution/release policy and production
resource authority before adoption; no maintained merge, release, deployment,
live database migration or production pin change is authorized by this draft.

---

<div align="center">
  <a href="https://eve.dev/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/eve.svg">
      <img alt="eve logo" src=".github/assets/eve.svg" height="128">
    </picture>
  </a>
  <h1>eve</h1>

<a href="https://vercel.com"><img alt="Vercel logo" src="https://img.shields.io/badge/MADE%20BY%20Vercel-000000.svg?style=for-the-badge&logo=Vercel&labelColor=000"></a>
<a href="https://www.npmjs.com/package/eve"><img alt="NPM version" src="https://img.shields.io/npm/v/eve.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://github.com/vercel/eve/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/npm/l/eve.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://github.com/vercel/eve/discussions"><img alt="Join the community on GitHub" src="https://img.shields.io/badge/Join%20the%20community-blueviolet.svg?style=for-the-badge&logo=Github&labelColor=000000&logoWidth=20"></a>

</div>

[eve](https://eve.dev/) is a filesystem-first framework for durable AI agents. Core agent capabilities live in
conventional locations, so projects are easier to inspect, extend, and operate.

## The filesystem is the authoring interface

A typical eve agent has this structure:

```text
my-agent/
└── agent/
    ├── agent.ts            # Optional: model and runtime config
    ├── instructions.md     # Required: the always-on system prompt
    ├── tools/              # Optional: typed functions the model can call
    │   └── get_weather.ts
    ├── skills/             # Optional: procedures loaded on demand
    │   └── plan_a_trip.md
    ├── channels/           # Optional: message channels (HTTP, Slack, Discord)
    │   └── slack.ts
    └── schedules/          # Optional: recurring cron jobs
        └── weekly_recap.ts
```

Read the [documentation](https://eve.dev/docs) for the full project layout and guides.

## Quick start

```bash
npx eve@latest init my-agent
```

This creates a new `my-agent` directory, installs its dependencies, initializes Git, and starts
the interactive terminal UI. The generated agent uses `openai/gpt-6-luna-fast` with high reasoning.

To start with another AI Gateway model, pass its model ID:

```bash
npx eve@latest init my-agent --model openai/gpt-5.6-terra
```

Passing `--model` without `--reasoning` uses the provider's default reasoning. Pass `--reasoning` to set it explicitly.

To add eve to an existing project, pass a path:

```bash
cd myapp
npx eve@latest init .
```

> [!NOTE]
> The `eve` package includes its full documentation, so coding agents can read it locally from
> `node_modules/eve/docs`.

### A minimal example

The generated project includes an `agent` directory. Replace `agent/instructions.md` with:

```md
You are a concise weather demo assistant. Tell users that the weather data is mocked.
```

Add a mock weather tool at `agent/tools/get_weather.ts`:

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Return mock weather data for a city.",
  inputSchema: z.object({ city: z.string().min(1) }),
  async execute({ city }) {
    return { city, condition: "Sunny", temperatureF: 72 };
  },
});
```

Choose the model in `agent/agent.ts`:

```ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-6-luna-fast",
  reasoning: "high",
});
```

For a new scaffold, start the agent again:

```bash
npm run dev
```

That's a working agent. Add human-in-the-loop prompts, subagents, and schedules as needed.
Follow the [first-agent tutorial](https://eve.dev/docs/tutorial/first-agent) for a complete
walkthrough.

### Add Web Chat

From your agent's directory, link a Vercel project and add Web Chat:

```bash
npx eve link
npx eve add channel/web
```

Choose a hosting layout, then **Sign in with Vercel** to provision authentication for members of the project's team.
You can also select **Web Chat** from the terminal UI's `/add` channel picker.
Run `npx eve deploy` when ready to publish. Local development works without browser sign-in.
See the [Web Chat setup guide](https://eve.dev/docs/channels/eve#web-chat-with-sign-in-with-vercel) for permissions and recovery.

## Community

The eve community lives on [GitHub Discussions](https://github.com/vercel/eve/discussions),
where you can ask questions, share ideas, and show what you've built.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get the repo
running locally and land a change, and use
[issues](https://github.com/vercel/eve/issues) and
[discussions](https://github.com/vercel/eve/discussions) to collaborate. By
participating, you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please do not open public issues for security vulnerabilities. Instead, follow
[SECURITY.md](SECURITY.md) and report responsibly to
[responsible.disclosure@vercel.com](mailto:responsible.disclosure@vercel.com).

## Beta terms

eve is currently in beta and subject to the [Vercel beta terms](https://vercel.com/docs/release-phases/public-beta-agreement);
the framework, APIs, documentation, and behavior may change before general availability.

Stable native identity receipts accompany resource names: VM IDs and snapshot
digests plus artifact paths come from successful SDK allocation results. Cleanup
refuses a replacement that reused a name. Snapshot absence is checked at its
recorded artifact path, because the SDK snapshot index is rebuildable; snapshot
removal also keeps native child/dependency protection enabled. Fork artifact
version 2 retains the captured digest, resolves its indexed path and verifies the
manifest before restore. Mutable state snapshot restoration performs the same
identity check. Earlier name-only fork/resource records are unsupported.
