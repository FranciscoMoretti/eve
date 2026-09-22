---
issue: "https://github.com/FranciscoMoretti/chat-js/pull/447"
status: local-draft
last_updated: "2026-09-12"
---

# Completion hook results

Optional response annotations, such as follow-up suggestions, need their own configured model while remaining part of the native durable response. Changing the main answer's schema or asking it to call a suggestion tool changes that behavior.

Allow only `turn.completed` authored hooks to return `{ responseMetadata?: JsonObject, modelCalls?: HookModelCall[] }`. Each call carries `modelId`, optional native SDK usage/provider metadata, and `failed?: boolean` for a request that failed before completion. Void remains valid. A strict result parser rejects unknown fields and bounds the attempt list at 100.

The dispatcher emits `hook.result` with its own stamped ID, originating hook slug and exact turn ID, optional annotation, and sanitized model-call evidence. It reuses the existing durable event emitter before session waiting. Observers receive the event; the completion hook does not recursively run. Default projection stores annotations in `assistant.metadata.annotations[hookId]`, separate from user custom data and framework fields. Repeated results replace only their own namespace. No annotation enters model history and no client mutation API is introduced.

Applications capture completed call evidence before output validation. They can return usage without display metadata when output is invalid, or `failed: true` without invented usage on an uncompleted request. A thrown hook has existing failure semantics and cannot return its evidence, so optional annotation generators must catch their own failures. Distinct actual attempts remain distinct; replay deduplication uses event ID and attempt index.

Trusted seed messages accept validated hook-ID/JSON-object annotations. Internal imported-prefix forks preserve them. Execution-history forks copy only annotation payloads, stripping historical call evidence. Public exports choose their own allowlist. Stream version 28 advertises the new event while preserving supported prior stream normalization.

Unit/in-memory integration tests cover misuse, sanitization, usage-only results, exact turn targeting, namespace isolation, deterministic replay, seed and native fork preservation, prompt isolation, and event order before idle. A deterministic basic-runtime fixture exercises the wire in CI. This proposal is unpublished; no issue or release has been created.

Invalid display metadata is omitted independently of valid model-call evidence. Malformed call entries or unknown result fields still reject the authored result.
