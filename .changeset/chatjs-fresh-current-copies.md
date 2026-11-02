---
"eve": patch
---

Remove historical conversation checkpoints and sandbox fork snapshots.

Trusted transcript seeds create independent sessions with fresh sandboxes and explicit attachments. Normal session resume remains supported; resource ownership, retirement fences, and confirmed deletion belong to the app. Extensions that used removed checkpoint APIs must rebuild against the new capability epochs.
