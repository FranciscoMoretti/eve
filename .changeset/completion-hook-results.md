---
"eve": patch
---

Allow completion hooks to return durable response annotations and auxiliary model-call usage. Clients receive hook results before the session becomes idle and can replay per-hook assistant annotations without adding them to model prompts.
