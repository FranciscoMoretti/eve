## ChatJS fork inventory

This inventory describes the maintained `francisco/chatjs-package` branch relative to
upstream [`eve@0.61.0` (`241e5004`)](https://github.com/vercel/eve/commit/241e5004cb1ac1e2bcd716a154bbc64f5a61cc53).
It is a list of our remaining patches, not a claim that newer upstream releases lack them.
[Build and distribution details](CHATJS.md).

| Change                                | What it does / why it remains                                                                                                                                                | Removal condition                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact approval receipts               | Binds execution to the winning authenticated approval. ChatJS rechecks owner and current tool policy at execution time.                                                      | A supported runtime preserves the same call/input/approver binding and callback through rediscovery, cancellation and restart.                                       |
| Message metadata and identity         | Carries caller operation IDs and tool selection to the exact received message; keeps replayed message IDs stable. Pending sends and annotations use this evidence.           | Supported correlation on create/send retains every coalesced caller token; ChatJS owns display annotations.                                                          |
| Creation-operation lookup             | Binds an authenticated immutable creation operation to its allocated session. Lost responses must not create another conversation.                                           | Supported lookup recovers the same allocation without reissuing uncertain work.                                                                                      |
| Completion-hook results               | Persists auxiliary response annotations such as follow-up suggestions, outside model history.                                                                                | Supported durable result delivery preserves exact-turn targeting, replay and copy behavior, or ChatJS replaces this feature.                                         |
| Checkpoints and forks                 | Captures/reads/restores native and named boundaries, including document and sandbox state. Conversation branching needs a consistent snapshot.                               | Supported checkpoints and owned forks pass boundary, state-restoration and resource-isolation tests.                                                                 |
| History import and projection         | Imports trusted transcript seeds and restores history with stable message/tool identities, annotations and model display. New conversation copies still need this.           | Supported authenticated import/fork APIs preserve these semantics without replaying inherited tools or billing.                                                      |
| Attachment staging                    | Resolves owned files and stages copied/seeded attachments, with retry after staging failure.                                                                                 | Supported file resolution preserves ownership and complete attachment content through copy/fork.                                                                     |
| Sandbox lifecycle                     | Adds local identity receipts, owned checkpoints, cleanup and Microsandbox 0.6 lifecycle/serialized mutations. Prevents foreign-resource deletion and preserves forked files. | Supported backend APIs provide equivalent ownership, snapshot and cleanup guarantees for the selected SDK.                                                           |
| Resumable HTTP streams                | Adds tail positions, bounded reads, heartbeats and lease-end control frames. Clients reconnect without treating controls as messages.                                        | Supported transport resumes exact durable positions and bounds idle connections.                                                                                     |
| Next production startup               | Starts local/named workers during production-server initialization, before rewrite handling.                                                                                 | A supported Next integration passes production startup and routing checks.                                                                                           |
| Distribution and protocol integration | Ships `@chat-js/eve` with matching exports, compiler/stream capabilities and stable workflow identities.                                                                     | All required runtime contracts are supported, the application passes against that release, and the scoped package plus remaining integration patches can be dropped. |

**Every fork PR must update this inventory:** add or revise affected rows and their
removal conditions, delete rows when their patches are retired, and state “inventory
reviewed; no change” in the PR when no row changes. Rebase/upgrade PRs must update the
comparison baseline and re-evaluate each row. Each PR must link its companion ChatJS
PR (or explain why none is needed), summarize entries added/narrowed/removed, and
state application/package adoption order. Link upstream issues or discussions when
known; distinguish an upstream implementation from a verified replacement for our
contract. Fresh-start deployment requires no
old-session continuation or historical billing import. PostgreSQL-world patches live
in ChatJS and are tracked separately from this eve fork.

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
the interactive terminal UI.

To start with another AI Gateway model, pass its model ID:

```bash
npx eve@latest init my-agent --model openai/gpt-5.6-terra
```

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
  model: "openai/gpt-5.6-luna-fast",
});
```

For a new scaffold, start the agent again:

```bash
npm run dev
```

That's a working agent. Add human-in-the-loop prompts, subagents, and schedules as needed.
Follow the [first-agent tutorial](https://eve.dev/docs/tutorial/first-agent) for a complete
walkthrough.

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
