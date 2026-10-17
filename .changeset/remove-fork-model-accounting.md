---
"eve": minor
---

Remove the fork-specific `compaction.usage` event, `HookModelCall` export and completion-hook `modelCalls` result field. Applications must account for these provider calls themselves; completion-hook display annotations and ordinary step usage remain available.
