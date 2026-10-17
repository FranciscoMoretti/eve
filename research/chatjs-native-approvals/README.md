---
issue: https://github.com/FranciscoMoretti/eve/pull/9
status: consumer-proof-passed-integration-pending
last_updated: "2026-10-17"
---

# Native approval receipts at actual ChatJS consumers

Review after [streaming #10](https://github.com/FranciscoMoretti/eve/pull/10).
Exact base: `codex/eve080-native-streams` at `190cb362`.
The original upstream base remains `e3cea42486e7e32b7b3001bb5912e076b5443ad5`.
This stacked evidence slice supports [umbrella #9](https://github.com/FranciscoMoretti/eve/pull/9),
which targets the maintained fork and remains **incomplete and nondeployable**.
No maintained runtime source is deleted by this proof PR.

## Decision and before/after mapping

Do not port the private 0.61 receipt map into the native candidate for these local
MCP/deletion consumers. Native parked-call machinery supplies exact consent and
its accepted responder. Keep current ownership, policy and revision guards in the
app. Apply the small response-policy adaptation when integrating the candidate;
do not delete receipt checks or fall back to the requester.

| Maintained implementation                                                                                                                         | Native candidate replacement                                                                                                                                                                 | Evidence                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `context/tool-approval-receipts.ts`: 83-line private map populated from resolved batches/audit settlements and checked by call/session/tool/input | [`hitl/intake.ts`](../../packages/eve/src/harness/hitl/intake.ts) restores the requesting step and obtains the responder by request ID from durable state                                    | Previously accepted 15 native runtime +3 evidence-boundary cases, including restart/original closure/input and multi-client authority |
| Explicit exact input/tool binding in that map                                                                                                     | [`approved-calls.ts`](../../packages/eve/src/harness/hitl/approved-calls.ts) uses parked tool entries, validates stored input, rechecks policy and supplies responder to this execution only | Prior exact-binding proof plus actual consumer request/execution call identity in companion                                           |
| Public approval receipt includes requestId and responder                                                                                          | [`tools/definition.ts`](../../packages/eve/src/tools/definition.ts) exposes `approval.responder` for a local approved call                                                                   | Actual MCP and deletion execute functions consume the native responder without a public requestId                                     |
| Response authorizer reads old top-level responder                                                                                                 | [`approval/definition.ts`](../../packages/eve/src/approval/definition.ts) uses `response.principal`; `auth` is a separate capability                                                         | Candidate-only two-file app patch removes seven registration/deletion diagnostics                                                     |
| App effect guards                                                                                                                                 | Same actual ChatJS request/execute functions, retaining current owner/connector/revision checks                                                                                              | Five new native-runtime consumer scenarios                                                                                            |

`maintained-receipt.patch` is the exact historical helper addition from upstream
0.61 `241e5004cb1ac1e2bcd716a154bbc64f5a61cc53` to maintained fork
`5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c`. It is evidence, not a standalone
safe deletion patch. Mixed harness/tool-loop changes include other contracts;
this decision does not retire all of them or supersede historical fork #1/#2/#7.
Native architecture replaces this map only as part of the full 0.80.1 adoption.

## Actual consumer companion and validation

[ChatJS #849](https://github.com/FranciscoMoretti/chat-js/pull/849), head `9fee07422`,
is independently based on main `c0ab1c0504bb3da73ca0f3625f66c47bf69e042e` with
merged prerequisite #847. It does not depend on streaming companion #848.
Its real native backend sends request/execution contexts through a disposable
localhost bridge to the actual MCP/deletion consumer functions. Fixture adapters
provide database scope/persistence and remote MCP clients. The positive receipt
comes from native approval execution, not a test-created consent object.

Five cases pass: foreign responder then owner approval; transferred connector
ownership; policy tightened after a no-approval request; exact owned deletion;
and changed revision while pending. Recorded consumer errors prove denial paths
reached the actual guards. Workspace lint and eight current-pin type tasks pass.

The proposed response-policy patch is not applied to production sources. Applied
only to the exact #9/current-main compiler fixture, it eliminates all seven MCP
registration/deletion diagnostics, reducing authenticated diagnostics from56 to49.
The full app remains blocked. The patch preserves response authority and leaves
execution consent checks unchanged.

The [accepted runtime proof](https://github.com/FranciscoMoretti/chat-js/tree/1dfbd53194199aa982bfad8a976eb50bc3d41695/experiments/eve-supported-approval)
is reused, not rerun wholesale. These five scenarios add actual consumer coverage;
they do not repeat or expand its restart/state-machine claim.

## Remaining gates

The bridge serializes identity fields and reconstructs cancellation locally; it
proves neither credential/getToken capability nor workflow-context equivalence.
No full production dynamic catalog, atomic database deletion, real connector OAuth
or cancellation propagation claim is made. The broader exact #9/current-main
checkpoint remains red at missing transcript/input-schema exports and other
copy/projection contracts. No actual app startup/send/copy/sandbox pass is inferred.

Review #8, #10 and this slice in order. Review #848 and #849 independently against
ChatJS main. Integrate candidate adapters and missing required contracts before
considering umbrella adoption. Only then does the conditional ten-group inventory
become seven after startup, streaming and approval replacements. Unported correlation,
creation recovery, copy/checkpoint/projection, attachments, sandbox and distribution
remain pending, not working retained extensions. No production pin, release,
deployment, live database, old-session continuation or billing import changes.
