---
"eve": patch
---

Remove completion-hook return values and the hook.result event now that ChatJS owns optional suggestions. Restore upstream side-effect-only lifecycle callbacks and remove annotation projection/import. Stream version 29 identifies this fresh-start contract; old hook-result sessions are not continued.
