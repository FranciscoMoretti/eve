---
issue: "https://github.com/FranciscoMoretti/chat-js/pull/447"
status: local-draft
last_updated: "2026-10-17"
---

# Completion hook results

Optional response annotations, such as follow-up suggestions, need their own configured model while remaining part of the native durable response. Changing the main answer's schema or asking it to call a suggestion tool changes that behavior.

Allow only `turn.completed` authored hooks to return `{ responseMetadata?: JsonObject }`. Void remains valid. A strict result parser rejects unknown fields. Applications own model accounting at the provider boundary; see [ChatJS #842](https://github.com/FranciscoMoretti/chat-js/pull/842).

The dispatcher emits `hook.result` with its own stamped ID, originating hook slug, exact turn ID and display annotation. It reuses the existing durable event emitter before session waiting. Observers receive the event; the completion hook does not recursively run. Default projection stores annotations in `assistant.metadata.annotations[hookId]`, separate from user custom data and framework fields. Repeated results replace only their own namespace. No annotation enters model history and no client mutation API is introduced.

Optional annotation generators catch their own failures so a missing suggestion need not fail the main answer. Billing is independent of annotation generation and delivery.

Trusted seed messages accept validated hook-ID/JSON-object annotations. Internal imported-prefix forks preserve them. Execution-history forks copy annotation payloads. Public exports choose their own allowlist. Stream version 28 advertises the new event while preserving supported prior stream normalization.

Unit/in-memory integration tests cover misuse, sanitization, exact turn targeting, namespace isolation, deterministic replay, seed and native fork preservation, prompt isolation, and event order before idle. A deterministic basic-runtime fixture exercises the wire in CI. This proposal is unpublished; no issue or release has been created.

Invalid display metadata is omitted. Unknown result fields reject the authored result.
