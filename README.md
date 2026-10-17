## ChatJS 0.80.1 upgrade candidate

This candidate starts at upstream **eve 0.80.1**,
[`e3cea42486e7e32b7b3001bb5912e076b5443ad5`](https://github.com/vercel/eve/commit/e3cea42486e7e32b7b3001bb5912e076b5443ad5).
The umbrella branch `codex/chatjs-eve080-upgrade` targets the maintained
`francisco/chatjs-package` branch. Its full diff includes the upstream version
upgrade and is not the residual ChatJS patch. Inspect the residual patch against
`codex/chatjs-eve080-base`, pinned to the exact upstream commit above.
The maintained `francisco/chatjs-package` runtime remains at
[`5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c`](https://github.com/FranciscoMoretti/eve/commit/5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c).
This candidate is **not ready for ChatJS adoption**. Starting from upstream does
not mean the remaining contracts have been ported or retired.

**Next production startup:** native candidate retirement evidence is recorded in
[the startup slice](research/chatjs-next-startup/README.md). It maps the exact old
patch to upstream behavior and exercises two minimal agents with real local
`next build` / `next start`. Merging this proof alone does not delete code from the
maintained runtime. Its ten-group inventory becomes nine only when this verified
startup replacement is adopted in an integrated candidate.

### Review order and implementation status

1. Review [startup proof #8](https://github.com/FranciscoMoretti/eve/pull/8)
   against `codex/chatjs-eve080-base`. This aggregate already includes its two commits.
2. Review the streaming proof against `codex/eve080-next-startup`, then the
   approval consumer proof against the streaming slice. These are planned stacked
   review slices; neither is complete or included here yet.
3. Review each necessary retained extension as a narrow slice against its declared
   dependency. Aggregate only reviewed, evidenced behavior. Check the final residual
   diff against the exact upstream base before considering the umbrella for merge.
4. Integrate both ChatJS agents after the independent
   [dependency prerequisite #847](https://github.com/FranciscoMoretti/chat-js/pull/847),
   then validate fresh-session ownership, correlation, copy, accounting and recovery.

**Implemented retained extensions: none.** This branch currently contains upstream
0.80.1 plus startup proof and upgrade documentation. Required fork-only behavior is
missing. The branch is **incomplete and nondeployable** until the remaining contracts
and application integration pass. No published package or production app pin has
been changed by our candidate commits.

**Upstream replacements:** native Next startup is proven for the minimal local
fixture. Streams and approval receipts remain conditional replacement candidates;
the table identifies their remaining consumer gates. Existing fork PRs #1, #2 and
#7 are not included or superseded. Their behavior must be assessed before reuse.

### Pending required contracts and candidate decisions

| Group                                 | Candidate disposition and remaining gate                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Exact approval receipts               | Removal candidate; accepted 15+3 supported proof exists, actual MCP/deletion consumer integration remains. |
| Message metadata and identity         | Port/narrow exact operation correlation and replay IDs; generic display metadata is app-owned.             |
| Creation-operation lookup             | Narrow around native create dedupe; authenticated read-only recovery without resend still needs proof.     |
| Checkpoints and forks                 | Port required new-conversation boundaries and owned resource isolation.                                    |
| History import and projection         | Port trusted new-conversation seed/projection APIs without tool replay or billing import.                  |
| Attachment staging                    | Narrow to strict owned seed staging and complete retry semantics.                                          |
| Sandbox lifecycle                     | Port required identity, cleanup, snapshot and Microsandbox 0.6 contracts; no silent backend downgrade.     |
| Resumable HTTP streams                | Removal candidate; native stream semantics still need the ChatJS proxy/security proof.                     |
| Distribution and protocol integration | Unproven until all retained contracts, packaged exports, both app agents and fresh-session runtime pass.   |

The application dependency prerequisite is reviewed separately in
[ChatJS #847](https://github.com/FranciscoMoretti/chat-js/pull/847).
No application pin changes, release, deployment, old-session continuation, or old
billing import are part of this candidate. Authority, exact correlation, ownership,
best-effort accounting, and no automatic resend remain required. The application's
PostgreSQL consumed-prefix patch and abrupt-crash recovery gate remain separate.

### Exact candidate integration checkpoint

**Not yet compatible with real ChatJS.** Candidate
`aab691297a59cc8c325b8f8c584a472495aed9ce` was built and packed successfully,
then consumed by tracked ChatJS main `c0ab1c0504bb3da73ca0f3625f66c47bf69e042e`
(including merged #847). Both real agent builds fail: authenticated at missing
`eve/transcript`, guest at removed `inputResponseSchema`. Authenticated types have
56 diagnostics in eight groups; guest has one. Thirty focused app tests pass, but
full startup/send/stream/cancel/approval/copy/sandbox flows remain blocked.

[Committed matrix, root causes and reproduction](https://github.com/FranciscoMoretti/chat-js/blob/355553f0b/experiments/eve080-candidate-verification/README.md)
distinguish app adaptations from missing required runtime contracts. An initial
extra MCP schema diagnostic was a fixture dependency-topology artifact and was
removed without modifying application or runtime code. This documentation update
changes no runtime source; the tested commit remains the exact SHA above.

Streaming evidence is now [fork #10](https://github.com/FranciscoMoretti/eve/pull/10),
stacked on #8, with independent [ChatJS #848](https://github.com/FranciscoMoretti/chat-js/pull/848).
It is not yet incorporated into this aggregate. Its fixture proof does not override
the real-app compiler failures.

### Next minimal port plan

First complete stream proxy/security and approval consumer proofs to decide whether
those runtime patches can be omitted. Then inspect native event metadata and create
dedupe against exact operation correlation and read-only recovery. Port only a
missing observable contract; keep display metadata and policy decisions in ChatJS.
Next evaluate native checkpoint/session APIs for trusted new-conversation copy,
projection and owned attachment staging as one contract with separately reviewable
changes. Finally verify sandbox identity/lifecycle and packaged exports. None of
these pending contracts is implemented merely because it appears in this plan.

The maintained inventory is the requirements input, not a patch queue. Each row
must end with native evidence, a proven app-owned alternative, or the smallest
necessary runtime port. Old-session continuity, credential fallback and wholesale
history replay are not substitute proofs for fresh-session ownership and copy.

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
