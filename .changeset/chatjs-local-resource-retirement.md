---
"eve": minor
---

Record exact local microsandbox session resources before allocation and provide worker-authoritative retirement and cleanup. Local sessions now require explicit local backend configuration and owned metadata; uncertain allocation blocks retries, while cleanup preserves borrowed snapshots and confirms removal before completing.
