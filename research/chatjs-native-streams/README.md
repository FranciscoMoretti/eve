---
issue: https://github.com/FranciscoMoretti/eve/pull/9
status: validated-proxy-replacement-pending-integration
last_updated: 2026-10-17
---

# Native resumable streams through ChatJS

Review this slice against `codex/eve080-next-startup` at
`9b902b5a82c3f5dfa6548cf9cc068f14064b84a4`, after [startup #8](https://github.com/FranciscoMoretti/eve/pull/8).
It is a stacked evidence slice for [umbrella #9](https://github.com/FranciscoMoretti/eve/pull/9),
whose target is the maintained fork. It changes no production runtime source.
The aggregate remains incomplete and nondeployable; this proof does not remove
maintained code or implement the missing copy, correlation or sandbox contracts.

The exact candidate upstream baseline remains
`e3cea42486e7e32b7b3001bb5912e076b5443ad5` (eve 0.80.1).
The old comparison is upstream 0.61 commit `241e5004cb1ac1e2bcd716a154bbc64f5a61cc53`
to maintained fork `5f129f3b0b4d9a094ead45ca1cd3c53548d1da3c`.

## Decision and source mapping

Omit the private fork stream-response extraction when adopting the native candidate.
Its heartbeat, leased EOF, cursor and tail semantics have native implementations.
Keep the ChatJS owner/origin/query boundary. The necessary bounded-query adaptation
is [ChatJS #848](https://github.com/FranciscoMoretti/chat-js/pull/848), independently
based on ChatJS main `2de14d3fd96165bc493fc79c089763906d00f951`.
It permits only `follow=false`; no runtime fork port is needed for this boundary.

| Maintained behavior                           | Native 0.80.1 replacement                                                                                                          | Evidence                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Private `stream-response.ts`, 159 added lines | [`request.ts` response creation and serialization](../../packages/eve/src/eve-channel/request.ts)                                  | Actual native HTTP response through the real ChatJS GET handler                                                              |
| Cursor replay and optional tail reporting     | `createSessionStreamResponse` obtains the tail before committing headers; `parseFollow` supports bounded history                   | Exact suffix equality, bounded EOF, empty reads at tail, preserved headers                                                   |
| Blank heartbeats and 60-second leased EOF     | `serializeStream` retains 10-second blank heartbeat and 60-second `$eve` lease control                                             | One full real lease through ChatJS; control does not advance the event cursor                                                |
| Client read-only reconnect                    | [`open-stream.ts`](../../packages/eve/src/client/open-stream.ts) increments cursor only for events and reconnects on lease control | Source mapping plus explicit HTTP reconnect at the same cursor; automatic native-client reconnect not independently executed |
| Cancellation                                  | Native body pipe receives request signal; ChatJS passes browser signal and response body                                           | Aborted read rejects, then a bounded read succeeds; no command resend                                                        |
| Authorization/protocol boundary               | ChatJS GET validates principal, bound conversation, origin and strict query before dispatch                                        | Foreign owner and cross-origin rejection before any native request                                                           |

`maintained-comparison.patch` preserves the exact historical comparison. **It is
not a deletion patch.** `request.ts` includes unrelated seed, metadata and fork
hunks; those are not retired by this slice. Only the stream helper extraction,
stream handler delegation and corresponding stream-test import belong to this
decision. Native upstream also obtains tail state for following reads before
committing success, so missing/expired/unavailable state can return an HTTP error.
That source observation is not a separately executed error-race proof here.

## Validation and limits

The companion's reproducible `experiments/eve080-stream-proxy` executes the actual
ChatJS route/query/relay against published eve 0.80.1. Principal resolution,
conversation lookup and upstream URL mapping are fixtures. Six scenarios pass,
including the real 60-second lease, along with 13 ordinary route tests, workspace
lint and eight current-pin type tasks. Recorded companion head:
`4401e1ad6` (see its RESULTS.json for native run provenance).

The first lease assertion used an incorrect expected control shape; correcting it
to the native documented `$eve: stream.lease-ended` shape produced the green run.
No heartbeat/lease duration or production implementation was changed for testing.

This proves the HTTP stream boundary with a deterministic authored backend. It
is not full ChatJS deployment, database authorization, native package distribution,
or both real agents' runtime integration. Exact #9 package/current-main compiler
verification is separate. No old-session continuation, credential fallback or
workflow-context equivalence is claimed. The PostgreSQL consumed-prefix patch
remains necessary based on its separate transfer-volume proof. Production pins,
releases, deployments and maintained branches are unchanged.

Adoption order: review #8, this slice and #848; complete required remaining runtime
contracts and both agents' integration; only then consider umbrella adoption.
Conditional inventory count becomes eight after both startup and streaming
replacements are integrated, not by merging this evidence PR alone.
