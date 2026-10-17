---
"eve": minor
---

Add authorized, source-serialized copy checkpoints with immutable sandbox restoration and a required application checkpoint persistence hook. Imported-message forks retain exact trusted transcript prefixes without replaying historical tools; ordinary event hooks remain best-effort.

Rebuild extension distributions against the new capability epochs; this fresh-start candidate does not accept the previous epochs for changed public contracts.
