## ChatJS eve 0.80.1 integration candidate

[Draft #9](https://github.com/FranciscoMoretti/eve/pull/9) upgrades the maintained
fork to eve 0.80.1. Review the residual changes against exact upstream commit
`e3cea42486e7e32b7b3001bb5912e076b5443ad5`.

### Retained contracts

| Contract                                  | Purpose                                                                                                                                                                               | Removal criterion                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Trusted transcript seeds                  | An authenticated channel resolves accepted app reservations. Fresh sessions import completed conversation content and stage explicit attachments without replaying historical tools.  | Equivalent upstream trusted initialization and attachment ownership. |
| Local resource ownership and deletion     | Persisted VM IDs and state snapshot digest/path receipts bind resources to their owner and canonical cache. Retirement fences allocation; deletion requires confirmed native absence. | Equivalent upstream ownership, retirement, and confirmed removal.    |
| Microsandbox SDK and development shutdown | SDK 0.6.18 and verified VM shutdown preserve normal session resume state within the CLI exit window.                                                                                  | Equivalent upstream SDK lifecycle.                                   |
| Scoped package resolution                 | Compiler lookups support the published `@chat-js/eve` package and its self references through an `eve` dependency alias.                                                              | Equivalent upstream scoped publication support.                      |

Copies start with fresh sandboxes. They retain conversation history, documents,
and explicit attachments; installed packages, arbitrary files, and running
processes are not copied. Historical turn checkpoints, sandbox fork snapshots,
borrower retention, and required document checkpoint hooks are removed. ChatJS
captures the current completed conversation under its own admission and document
locks. No custom native operation lookup or admission ledger remains. Interrupted
create/copy/send operations can stay unresolved and are never redispatched on
missing evidence.

### Distribution and evidence

ChatJS uses the ordinary versioned alias `npm:@chat-js/eve@0.80.1-chatjs.2`.
The published package corresponds to signed source commit
`97aba72836dad4194a08a002e08a2bf8d38809cf`, including these simplifications and
the isolated-layout development import fix. The `chatjs` tag points to `.2`;
`latest` remains `0.61.0-chatjs.0`.

Registry bytes match the tested artifact. SHA-512 integrity:
`lm6eZBc0hj9cSd2iZnhXt772GqHUHp1q3RWNshEBfTxZNyM8sEOnJr5U0MDXJENtRUsg7hGjRtduMG0CzpIA2Q==`.
A clean frozen registry install resolves `.2` in all four app consumers. The
isolated module regression and nested development startup pass. Historical
`.1` startup failure came from an internal unscoped package import and is fixed
in `.2`.

Fork prerelease versions do not name upstream container images. Set
`EVE_SANDBOX_IMAGE_TAG=0.80.1` for the matching upstream image; ChatJS commands
default to this tag and preserve an explicit override.

[ChatJS #850](https://github.com/FranciscoMoretti/chat-js/pull/850) is the integrated
app review. Historical evidence and upstream replacement reviews remain linked
in [startup #8](https://github.com/FranciscoMoretti/eve/pull/8),
[streams #10](https://github.com/FranciscoMoretti/eve/pull/10), and
[approvals #11](https://github.com/FranciscoMoretti/eve/pull/11).
Their results apply to their recorded commits, not automatically to this head.

### Authority limits

Resource retirement requires `MSB_BACKEND=local`, one canonical cache, matching
HOME/MSB_HOME, and an absolute MSB_HOME when set. Remote hosts, cache mismatches,
unattributed metadata, and crashed locks fail closed. Locks are never stolen.
State snapshot restoration verifies its recorded digest and artifact path;
cleanup refuses replacement resources that reuse names. Old fork-resource
records are unsupported and fail closed. This is not distributed fencing or
production cutover validation. Extension contract history remains immutable;
removed APIs require current extension epochs. No legacy session or billing
import is provided.

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
