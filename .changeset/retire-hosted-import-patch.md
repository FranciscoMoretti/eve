---
"eve": patch
---

Retire the fork-only hosted Microsandbox import repair after ChatJS moves to its app-owned sandbox provider. This returns the import to upstream behavior; consumers that independently retain the native Microsandbox runtime during hosted pruning can still encounter the upstream missing-export defect.
