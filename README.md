## ChatJS 0.80.1 upgrade candidate

This candidate starts at upstream **eve 0.80.1**,
[`e3cea42486e7e32b7b3001bb5912e076b5443ad5`](https://github.com/vercel/eve/commit/e3cea42486e7e32b7b3001bb5912e076b5443ad5).
Its review base is `codex/chatjs-eve080-base`, pinned to that commit.
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

**HTTP streaming:** [the streaming slice](research/chatjs-native-streams/README.md)
proves native bounded history, exact cursor reconnect, heartbeat/lease and abort
through the actual ChatJS GET policy/relay. Its principal and database boundary
are fixtures. [ChatJS #848](https://github.com/FranciscoMoretti/chat-js/pull/848)
is the independent minimal query adaptation. The count becomes eight only after
both startup and streaming replacements are adopted; required unported contracts
remain missing. The [umbrella #9](https://github.com/FranciscoMoretti/eve/pull/9)
targets the maintained branch and remains incomplete/nondeployable.

**Approvals:** [the consumer slice](research/chatjs-native-approvals/README.md)
adds five actual MCP/deletion request/execute scenarios to the accepted native15+3
proof. [ChatJS #849](https://github.com/FranciscoMoretti/chat-js/pull/849) supplies
a candidate-only response-policy patch; seven compiler diagnostics disappear, but
the full app still fails. No credential or workflow-context equivalence is claimed.
The conditional inventory reaches seven only on integrated adoption of all three
replacements. Implemented retained runtime extensions remain none.

### Remaining inventory dispositions

| Group                                 | Candidate disposition and remaining gate                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact approval receipts               | Native local receipts pass accepted 15+3 and five actual consumer cases; candidate response-policy adapter and full app integration remain. |
| Message metadata and identity         | Port/narrow exact operation correlation and replay IDs; generic display metadata is app-owned.                                              |
| Creation-operation lookup             | Narrow around native create dedupe; authenticated read-only recovery without resend still needs proof.                                      |
| Checkpoints and forks                 | Port required new-conversation boundaries and owned resource isolation.                                                                     |
| History import and projection         | Port trusted new-conversation seed/projection APIs without tool replay or billing import.                                                   |
| Attachment staging                    | Narrow to strict owned seed staging and complete retry semantics.                                                                           |
| Sandbox lifecycle                     | Port required identity, cleanup, snapshot and Microsandbox 0.6 contracts; no silent backend downgrade.                                      |
| Resumable HTTP streams                | Native replacement proven through the ChatJS GET proxy; adopt companion #848 and finish full candidate integration.                         |
| Distribution and protocol integration | Unproven until all retained contracts, packaged exports, both app agents and fresh-session runtime pass.                                    |

The application dependency prerequisite is reviewed separately in
[ChatJS #847](https://github.com/FranciscoMoretti/chat-js/pull/847).
No application pin changes, release, deployment, old-session continuation, or old
billing import are part of this candidate. Authority, exact correlation, ownership,
best-effort accounting, and no automatic resend remain required. The application's
PostgreSQL consumed-prefix patch and abrupt-crash recovery gate remain separate.

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
