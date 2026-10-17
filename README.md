## ChatJS 0.80.1 upgrade candidate

**Incomplete and nondeployable: the guest agent passes; authenticated integration remains blocked.**
[Umbrella #9](https://github.com/FranciscoMoretti/eve/pull/9) targets the maintained
`francisco/chatjs-package` branch, baseline
`5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c`. This candidate starts at exact upstream
**eve 0.80.1**, `e3cea42486e7e32b7b3001bb5912e076b5443ad5`.
The full umbrella diff includes the upstream upgrade. Review the residual ChatJS
patch against `codex/chatjs-eve080-base`, pinned to that exact upstream commit.

### Review order

| Slice                                                            | Exact review base                           | Companion / status                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Startup #8](https://github.com/FranciscoMoretti/eve/pull/8)     | `codex/chatjs-eve080-base` at `e3cea424`    | Minimal real Next production startup proof; included here                                                                         |
| [Streaming #10](https://github.com/FranciscoMoretti/eve/pull/10) | `codex/eve080-next-startup` at `9b902b5a`   | [ChatJS #848](https://github.com/FranciscoMoretti/chat-js/pull/848), independently based on main `2de14d3fd`; proof included here |
| [Approvals #11](https://github.com/FranciscoMoretti/eve/pull/11) | `codex/eve080-native-streams` at `190cb362` | [ChatJS #849](https://github.com/FranciscoMoretti/chat-js/pull/849), independently based on main `c0ab1c050`; proof included here |

The fork slices are stacked in that order. The two app companions are independent
and change no production eve pin. Dependency prerequisite
[ChatJS #847](https://github.com/FranciscoMoretti/chat-js/pull/847) is merged.
Historical fork PRs #1, #2 and #7 are neither included nor superseded.
Each subsequent necessary extension must declare its own dependency and narrow
review base. None of these draft proof PRs deletes maintained runtime code.

### Implemented retained extensions and upstream replacements

**Implemented local runtime slice: trusted fresh-copy seed initialization.**
The channel resolves only an authenticated accepted destination reservation;
structured history and `history.seeded` display are installed before first input,
without historical tool/model execution. Copied files use strict destination
channel staging and digest-checked later hydration, including compacted prompts.
No legacy decoder or public history normalizer is restored. Removal criterion:
upstream supplies equivalent trusted initialization and strict resource semantics.

Focused route, creation/projection, attachment and turn-step checks cover this
slice. Full ChatJS copy is still gated by checkpoint/fork source revisions,
sandbox lifecycle isolation, and creation recovery/admission. No copy-ready claim.
App integration `3a192e621` owns plan validation; 11 pre-seed authenticated-source
diagnostics remained. The local runtime slice must be packed and selected before
that count can be updated; the app still uses candidate `6869c350` at this point.

**Implemented runtime extension: authenticated read-only creation-operation lookup.**
It reuses upstream creation token derivation and owner resolution without sending
or creating. Ten focused route/create tests and package type checking pass; the
packaged integrated recovery gate is still pending. Missing aliases return 409
`eve_operation_unresolved`, never a not-found permission to recreate. Native
allocation can return a run ID before its alias hook exists, and releasing an
alias also loses lookup identity. Full recovery needs a durable allocation
binding; the current extension safely exposes known bindings only. Immutable
intent remains app-owned through the persisted initial request/content hash and
matching checks before dispatch. Changed-content and allocation-gap recovery
still need integrated evidence.

Removal criterion: upstream provides authenticated read-only operation lookup
with durable allocated identity (including before alias claim/after release),
and ChatJS proves immutable-intent verification and recovery without resending. Other required contracts below
remain missing.
The absence of old fork code is not proof that its requirements work upstream.

| Original inventory group | Replacement evidence                                                                                                                           | Remaining integration gate                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Next production startup  | [Two agents, real build/start, negative control, concurrency and failure/retry](research/chatjs-next-startup/README.md)                        | Full ChatJS startup after compiler blockers are resolved                  |
| Resumable HTTP streams   | [Six actual GET policy/relay to native HTTP scenarios](research/chatjs-native-streams/README.md), including exact cursor, real lease and abort | Adopt exact `follow=false` app allowlist; real full-app integration       |
| Exact approval receipts  | [Accepted 15+3 runtime cases and five actual MCP/deletion consumer scenarios](research/chatjs-native-approvals/README.md)                      | Candidate response-policy accessor patch; real catalog/DB/app integration |

Streaming's principal/database boundary and approvals' database/MCP persistence
boundary are fixtures. No credential/getToken or workflow-context equivalence is
claimed. Only integrated adoption of these three replacements reduces the original
ten-group inventory to seven. Required behavior is never dropped because it is
hard to port or absent from this upstream-based branch.

### Pending required contracts

| Group                                 | Smallest next decision                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Message metadata and identity         | Test native events against exact operation correlation/replay IDs; keep display metadata app-owned and port only missing correlation         |
| Creation-operation lookup             | Use native create dedupe where sufficient; prove authenticated read-only recovery without resend                                             |
| Checkpoints and forks                 | Evaluate native session/checkpoint APIs against new-conversation boundaries and owned resource isolation; port only missing guarantees       |
| History import and projection         | Evaluate trusted new-conversation seed/projection without tool replay or billing import; missing exports currently block authenticated build |
| Attachment staging                    | Preserve owned seed staging and complete retry semantics through native APIs or a minimal necessary extension                                |
| Sandbox lifecycle                     | Verify identity, cleanup, snapshot and Microsandbox 0.6 ownership; no silent backend downgrade                                               |
| Distribution and protocol integration | Validate all retained contracts, packaged exports, both agents and fresh-session runtime before adoption                                     |

The maintained inventory is requirements input, not an automatic patch queue.
Each row needs native evidence, an app-owned alternative or the smallest necessary
runtime port. No old-session continuity or historical billing import is required.
Authority, exact correlation, ownership, quota/balance, best-effort accounting,
independent tool charging and no automatic resend remain mandatory. The PostgreSQL
consumed-prefix patch and abrupt-crash recovery gate remain separate.

### Integrated ChatJS progress

Work continues on the dedicated `codex/eve080-integrated-upgrade` ChatJS branch,
based on merged main `c0ab1c0504bb3da73ca0f3625f66c47bf69e042e`, with an explicit
local candidate tarball. Production main's pin is unchanged.

- `b1858c77f`: real guest source compiles/builds; real Next proxy and signed guest
  credentials pass create/send/stream/exact cursor reconnect/active cancellation.
  External gateway HTTP is deterministic; database points to unused loopback port.
  Both agents remain configured normally after temporary guest isolation.
- `050f9f968`, followed by fixture typing cleanup `8aa4e52df`: native approval
  consumers and research child sessions adopted. Six suites/74 cases pass, and
  the existing native research harness passes adaptive research with independently
  charged search receipts and cancellation of owned children. It caught the
  structured reply rename to `eve__reply`. No provider model accounting claim.
- Actual authenticated compiler has 31 remaining copy/seed/projection diagnostics.
  Full repository lint/types remain blocked. Evidence and reproduction are in
  ChatJS `apps/chat/tests/eve-upgrade/README.md`.

The published #848 route assertion was changed by autofix after its earlier green
run; it is stale, not merge-ready. The integrated branch restores the exact mock
arity and passes the final focused suite. No separate proof publication is being
expanded while integrated work is prioritized.

### Exact candidate integration checkpoint

Candidate `aab691297a59cc8c325b8f8c584a472495aed9ce` built and packed successfully
and was consumed by tracked ChatJS main
`c0ab1c0504bb3da73ca0f3625f66c47bf69e042e` (merged #847).
The authenticated agent has 56 diagnostics in eight groups and fails its build
at missing `eve/transcript`; guest has one diagnostic and fails at removed
`inputResponseSchema`. Thirty focused app tests pass, but full startup/send/stream/
reconnect/cancel/approval/copy/attachment/sandbox flows remain blocked or unexecuted.

[Committed matrix, root causes and reproduction](https://github.com/FranciscoMoretti/chat-js/blob/d5b789589/experiments/eve080-candidate-verification/README.md)
record the exact tested head. A fixture SDK peer-tree artifact initially added one
MCP diagnostic; correcting the installation topology removed it without a source fix.

The candidate-only response-policy patch in #849 separately removes all seven MCP
registration/deletion-definition diagnostics (56 to49). Full compilation still fails.
It reads native `response.principal`; execution keeps `approval.responder` and
current owner/policy checks. This patch is not applied to production app sources.
Later commits here change only README/research evidence; runtime/package source
is unchanged from the exact tested candidate. No later full-app pass is claimed.

### Next minimal integration work

First replace the removed app input validator using an exact supported/app-owned
schema, and adopt the proven response-policy adapter only in candidate integration.
Then resolve native metadata/create recovery and copy/checkpoint/projection contracts
with evidence before choosing ports. Update progress and event consumers without
weakening accounting. Finish owned attachments, sandbox and distribution validation.
This plan does not authorize a wholesale port or imply that missing behavior works.
No maintained merge, release, deployment, live DB or production app pin cutover has
occurred.

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
