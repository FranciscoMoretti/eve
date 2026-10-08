---
issue: https://github.com/FranciscoMoretti/chat-js/issues/652
status: draft
last_updated: "2026-10-08"
---

# Durable candidate ownership

Session creation may produce multiple physical Workflow runs after retries or
partial failures. The PostgreSQL World associates every candidate with a stable
operation before either the run payload or initial queue payload commits. The
server derives the operation from namespace, agent, authenticated principal,
channel and continuation identity. An immutable intent digest rejects reuse for
a different request.

The continuation alias's physical inbox hook claims the canonical owner. Session
initialization follows that claim, so a losing session candidate cannot create a
sandbox or execute a business tool. Retained ownership prevents a new winner
after hook disposal. Auxiliary workflows do not inherit this no-effects claim:
activity renderers can invoke provider effects and need explicit cleanup support.

Owned native children have their own canonical owner and a parent operation.
Checkpoint copies record a source dependency without becoming owned descendants.
Sealing closes admission and claims across the owned family while allowing
settlement writes; retirement blocks payload writes after application settlement.
Registry associations and tombstones survive payload deletion.

The exact `workflow//eve//workflowToolRunWorkflow` wrapper does not allocate an
eve-native sandbox. Its workflow body rejects `getSandbox` and `getSkill`, and
authored steps receive a fresh context without sandbox access, even when an
ambient caller has it. Sandbox-backed helpers cannot implicitly allocate one.
Cleanup may use this narrow contract only with trusted immutable registry
candidate membership in an operation, its validated canonical owner, and the
authorized owned-operation closure. Generic SDK parent/root attributes are
mutable and are not ownership evidence. The wrapper name is insert-only through
the normal World API but is not frozen by a SQL trigger. Sessions requested through
`ctx.agent` still require complete owned-descendant cleanup. This contract does
not certify arbitrary external allocations or business effects in authored code,
and does not extend to other workflows merely because their role is auxiliary.

This protocol requires coordinated World migrations and eve deployment. Missing
legacy associations are incomplete inventory, not evidence of absence. Operators
must stop old producers and drain or quarantine legacy records before claiming
complete erasure. Managed Vercel and arbitrary auxiliary resource cleanup remain
unsupported. This draft is not a release certification.
