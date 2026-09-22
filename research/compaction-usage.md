---
issue: "https://github.com/FranciscoMoretti/chat-js/pull/447"
status: local-draft
last_updated: "2026-09-12"
---

# Compaction usage evidence

Compaction may invoke its summary model repeatedly, and a returned summary may be rejected as empty. The current completion event describes a committed checkpoint and cannot account for those separate calls.

Emit `compaction.usage` after each returned model call and before validating its summary. Include the compaction model reference, session/turn coordinates, available token/cost usage, and the gateway generation reference. Expose the event through authored hooks and the durable client stream. Reuse the ordinary model-step usage projection. Keep `compaction.completed` reserved for successfully appended checkpoints.

A missing provider cost remains unknown; it must not be inferred as zero. A transport failure that returns no provider result still needs separate provider reconciliation. This change does not reconstruct usage for historical compactions that emitted no evidence.

Local tests cover empty summaries, repeated paid attempts, manual compaction event ordering, and application ledger replay/rounding. No issue or proposal has been published.
