## ChatJS maintained eve fork

The maintained branch is `francisco/chatjs-package`. The eve 0.80.1 upgrade in
[fork #9](https://github.com/FranciscoMoretti/eve/pull/9) and its companion
[ChatJS #850](https://github.com/FranciscoMoretti/chat-js/pull/850) are merged.
Compare the residual fork against exact upstream commit
`e3cea42486e7e32b7b3001bb5912e076b5443ad5` (eve 0.80.1), not upstream's moving
`main`. Recheck every entry when changing that baseline.

The shared-workspace seed contract and app-owned sandbox lifecycle are released
in `@chat-js/eve@0.80.1-chatjs.4`, for adoption with
[ChatJS #871](https://github.com/FranciscoMoretti/chat-js/pull/871).

### Retained contracts

Three feature areas contain four review slices. The rows describe current
patches; proposed destinations are investigation directions, not confirmed
upstream equivalents or submitted contributions. T1 and the remaining T2 are
parts of one proposed upstream capability: **initialize a conversation from
history, including its attachment references**. Keep both patch IDs until that
capability replaces their implementations.

| ID / feature area              | Retained change and source                                                                                                                                                                       | Why it remains / ChatJS boundary                                                                                                                                                                  | Removal condition / investigation direction                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 / Transcript initialization | [Trusted transcript seeds](packages/eve/src/execution/session-transcript-seed.ts), authenticated channel resolution, native history initialization and display events.                           | Copies need prior exchanges without replaying historical tools. ChatJS owns source capture, branch boundaries, authorization and immutable intent.                                                | Adopt an upstream trusted history-initialization API covering native history, display events, and the attachment acceptance criteria below (T2).                                      |
| T2 / Transcript initialization | [Shared-workspace attachment resolution](packages/eve/src/harness/seed-attachments.ts) and hydration of seeded model history.                                                                    | Fork history references existing files in one app-owned workspace. ChatJS owns authorization and immutable originals; eve verifies existing paths and hydrates model input without copying files. | Retire with the attachment portion of the T1 history-initialization proposal: existing workspace references, authorization and equivalent integrity checks.                           |
| R2 / Local resource management | [Hosted-build import separation](packages/eve/src/execution/sandbox/bindings/microsandbox-runtime.ts) keeps the development-environment helper independent of the optional installer.            | Hosted builds can prune the installer while the native runtime still needs the helper.                                                                                                            | Upstream accepts the import/pruning fix or provides an equivalent build path. Candidate for a standalone bug fix.                                                                     |
| P1 / Package resolution        | [Scoped package/self-reference resolution](packages/eve/src/internal/application/package.ts) and the [internal development-capability import](packages/eve/src/self-modification/filesystem.ts). | ChatJS installs `@chat-js/eve` under the `eve` alias, including isolated dependency layouts.                                                                                                      | Retire scoped-distribution handling when ChatJS returns to upstream eve, or upstream supports generic package identity resolution. Investigate the internal import fix independently. |

The combined history-initialization proposal must:

- Initialize a new conversation from selected history, including image/PDF
  attachment references, without replaying historical tools.
- Resolve those references in the existing shared workspace without allocating
  another sandbox or copying workspace files. Shared paths alone do not initialize
  the new session's native attachment metadata.
- Preserve authorization and integrity checks, including on later turns and after
  compaction, while retaining access to immutable uploaded originals when their
  mutable working copies are edited or deleted.

T2 therefore remains an attachment requirement within history initialization,
not a separate workspace-copy feature. ChatJS owns workspace membership, access
control and immutable original storage; eve needs to reconstruct valid native
attachment references for the imported history. This is the agreed proposal scope,
not a claim that upstream already supports it or that either patch is removed.

R1, L1 and L2 are retired in this source tree. Companion
[ChatJS #865](https://github.com/FranciscoMoretti/chat-js/pull/865) owns persistent
sandbox allocation, ownership, confirmed deletion and development shutdown through
its installed provider. Native Microsandbox code and its SDK pin return to the
upstream 0.80.1 baseline (SDK 0.5.5); the R2 import fix remains.
The fork-only `manageLocalMicrosandboxResources` export is removed. Existing native
resources must be cleaned up with the old version before adopting a new package.
Do not adopt this removal until #865 and its lifecycle acceptance gates pass.
Use fresh worlds; no native-resource migration or compatibility path is provided.

Supporting changes are not additional runtime features: regression tests,
changesets, dependency lock data, extension compatibility epochs/reports, and
fork release/inventory guardrails. Historical contract reports remain immutable;
do not delete them as transient evidence. The release guard prevents this fork
from running the upstream publication workflow.

Admission, billing, operation journaling, document copying, branch selection and
source-boundary capture belong to ChatJS. This inventory does not propose moving
those responsibilities into eve. No upstream contribution is claimed for a row
until a proposal or PR is linked here.

Forks share the same app-owned workspace. They retain only the selected conversation
history while files, installed environment, and sandbox state remain shared and
are never rolled back to the historical boundary. Imported explicit attachments
reuse previously observed paths without destination allocation or duplicate writes.
ChatJS retains immutable uploaded originals separately from mutable working files. Historical turn checkpoints, sandbox fork snapshots,
borrower retention, and required document checkpoint hooks are removed. ChatJS
captures the current completed conversation under its own admission and document
locks. No custom native operation lookup or admission ledger remains. Interrupted
create/copy/send operations can stay unresolved and are never redispatched on
missing evidence.

### Distribution and evidence

The shared-workspace consumer uses `npm:@chat-js/eve@0.80.1-chatjs.4`.
Its source is merged commit `df72a62b6da4ce7abba7dc06f47cccd82ec18dd9`,
including [#14](https://github.com/FranciscoMoretti/eve/pull/14) and
[#15](https://github.com/FranciscoMoretti/eve/pull/15). The release checkout sets
the package version before building so the embedded runtime stamp matches the
published manifest. Scoped distribution metadata is applied after packing.
The `chatjs` tag selects `.4`; `latest` remains `0.61.0-chatjs.0`.

Tested artifact SHA-512 integrity:
`wUfAPFoJg4DoJ6OGW8P2jVD8KMc5uU3NuqSF37//DVZNxpBBAE3d0AuFMxVnDu91VXjadqjXDCZPi6sD/7mVFQ==`.
The build, 76 focused seed/turn/module tests, and live ChatJS private-Blob
image/PDF fork and restart scenarios passed. ChatJS preserves its workflow-ID
patch. The `.3` artifact is deprecated because its embedded version stamp did
not match its published manifest; use `.4`.

The live flow verifies shared provider files and immutable attachment originals.
ChatJS's code-execution tool still uses a separate temporary sandbox per call;
this is an accepted limitation, not evidence of persistent tool execution.
Historical `.2` verification applies to source `97aba72836dad4194a08a002e08a2bf8d38809cf`,
not this release. No captured logs, archives or secrets are committed.

Fork prerelease versions do not name upstream container images. Set
`EVE_SANDBOX_IMAGE_TAG=0.80.1` for the matching upstream image; ChatJS commands
default to this tag and preserve an explicit override.

[ChatJS #850](https://github.com/FranciscoMoretti/chat-js/pull/850) records the merged
app integration. Historical evidence and upstream replacement reviews remain linked
in [startup #8](https://github.com/FranciscoMoretti/eve/pull/8),
[streams #10](https://github.com/FranciscoMoretti/eve/pull/10), and
[approvals #11](https://github.com/FranciscoMoretti/eve/pull/11).
Their results apply to their recorded commits, not automatically to this head.

### Authority limits

The removed fork resource-retirement API no longer provides local ownership,
identity-receipt or deletion guarantees. ChatJS #865 provides those guarantees
through its own provider and database fences. Native Microsandbox users receive
upstream 0.80.1 behavior; this removal does not certify native timeout cleanup or
production cutover. Extension contract history remains immutable. No legacy
session or billing import is provided.

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
