## ChatJS maintained eve fork

The maintained branch is `francisco/chatjs-package`. This source upgrades the
fork from eve 0.80.1 to **1.0.0-rc.1**, upstream commit
`db7850007`. Compare the residual patch against
that exact commit, not upstream's moving main.

### Retained contracts

One functional capability (T1/T2) and scoped package support (P1) remain:

| ID  | Retained behavior                                                                                                                                                                                                                                                                                                                                       | App boundary and removal condition                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | [Trusted structured transcript seeds](packages/eve/src/execution/session-transcript-seed.ts), resolved on the authenticated server. Completed tool calls/results initialize model history without execution. Imported display is carried by v27 `session.started.data.transcriptSeed`; clients render completed `tool` parts without live interactions. | ChatJS owns authorization, source capture, branch boundaries and immutable intent. Remove when upstream [#5340](https://github.com/vercel/eve/issues/5340) supports the required structured history. RC1 native history remains text-only.                                                               |
| T2  | [Shared-workspace attachment hydration](packages/eve/src/harness/seed-attachments.ts) reuses authorized existing paths without duplicate writes or sandbox copies.                                                                                                                                                                                      | ChatJS owns workspace selection, attachment access and immutable originals. Adopt upstream attachment imports when available. Existing fork digest checks, including later turns and compaction, are additional guarantees to move app-side or explicitly trade off; they are not requirements of #5340. |
| P1  | [Scoped package resolution](packages/eve/src/internal/application/package.ts) canonical workflow IDs, and internal development-capability imports support `@chat-js/eve` installed as `eve`.                                                                                                                                                            | Remove when ChatJS returns to the upstream package.                                                                                                                                                                                                                                                      |

Billing, admission, operation journals, document copying, branch selection,
sandbox allocation, ownership, deletion and shutdown remain **app-owned**.
R1/R2/L1/L2 are retired; this upgrade does not restore them. The last unused local
sandbox route helpers and the obsolete hosted-pruning regression are removed.
Upstream RC1 now defines the native sandbox/runtime behavior.

Branches share the app-owned workspace. They preserve selected conversation
history but do not roll files, installed packages or processes back to a historical
boundary. Unknown create/copy/send outcomes must not trigger automatic redispatch.

### RC1 adoption

`@chat-js/eve@1.0.0-rc.1-chatjs.0` is published under the `chatjs-rc` npm tag
from source `7f45f90282e4e75b746dd90cd1782a93dcda2d0a`.
Companion ChatJS adoption is tracked in [#918](https://github.com/FranciscoMoretti/chat-js/pull/918).
Current ChatJS main still installs `npm:@chat-js/eve@0.80.1-chatjs.4`.
Its published source is `df72a62b6da4ce7abba7dc06f47cccd82ec18dd9`; historical
validation is recorded in [#16](https://github.com/FranciscoMoretti/eve/pull/16)
and does not certify this RC1 source.

Before adopting an RC1 fork package, migrate ChatJS's store/message types,
v27 event consumers, approvals and delivery results. Billing remains app-owned,
but its consumers must use v27 stream positions rather than counting events.
The fork's `history.seeded` event is replaced by the initial v27 session fact;
seed message IDs remain `seed_message_<index>`. Seed requests still accept only
`seed: true` and an operation identity, never a caller-supplied transcript.

Keep the upstream RC1 extension distribution contract and rebuild old extensions.
Historical extension contract reports remain immutable records, not a compatibility
promise. The fork release workflow guard remains in place. Publishing a scoped RC
package, updating ChatJS, merging, and deployment are separate steps.

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
