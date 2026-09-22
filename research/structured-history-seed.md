---
issue: "https://github.com/FranciscoMoretti/chat-js/pull/447"
status: draft
last_updated: "2026-09-18"
---

# Selected settled history seeds

Prototype a small continuation contract on top of the maintained transcript seed:
`createSessionHistorySeed(history)` returns `{ seed, messageIds, toolCallIds }`.
A public memory capture callback supplies immutable structured history. The
application selects a settled boundary and provides an authorized seed through
`resolveSeed`. Empty prefixes support first-message edit and regeneration.

Reuse the existing idle seed path; do not read or clone Workflow checkpoints.
Normal successful completion must supply history to the declared memory callback.
Reject unsupported provider-specific semantics instead of pretending this is
lossless state restoration. Preserve text versus JSON tool output across copies.

Local mock integration covers edit-first, regenerate-first, edit-later,
regenerate-later, branching, idle initialization, continued parent execution,
and the public capture hook. Pure tests cover bounds, pair validation, IDs,
attachments, and unsupported inputs. Existing seed integration covers the trusted
channel import. Paid-model and hosted e2e validation are intentionally pending.

Resource fencing/snapshots, historical selection across compaction, and a
production ChatJS capture store remain separate work. This experiment has no
published issue or contribution.
