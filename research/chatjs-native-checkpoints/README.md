---
issue: https://github.com/FranciscoMoretti/eve/pull/9
status: local-integration
last_updated: "2026-10-17"
---

# Immutable checkpoint resources

This slice combines immutable sandbox resources with source-owned conversation
checkpoints and authorized fresh-session fork routes.

Provider `fork.capture` returns an immutable artifact with a lifetime independent
of both sessions. `fork.restore` creates a destination-owned resource under the
destination's current open options. Sandbox access rejects borrowed capture,
unsupported initialized providers, incompatible providers/protocols and mixed
live/pending state. A failed restore retains its pending artifact; it cannot
fall back to an empty sandbox.

Only microsandbox implements this capability. Its fork snapshots use a separate
namespace from mutable resume snapshots. Source capture reconnects the same VM;
destination identity derives from the destination session and immutable artifact.
Source and destination cleanup never release the fork artifact. Checkpoint
retention/release must be owned by the later checkpoint lifecycle; these artifacts
are deliberately not swept by session cleanup or template pruning.

The actual provider probe found an existing shutdown race: SDK 0.5.5 `stop()`
requests shutdown but returns while the persisted VM still reports running.
Immediate resume can reconnect to that process as it exits, producing missing
file reads and commands without an exit event. The provider now waits through the
persisted handle's stop operation before detaching. No blank-resource fallback or
SDK dependency change is used for this fix.

## Validation

Build first, then run `node research/chatjs-native-checkpoints/verify-microsandbox.mjs`
with `MSB_BACKEND=local`, an isolated HOME, no cloud credentials, and a locally
installed microsandbox runtime. The probe uses Debian's public base image and
the actual compiled provider. It asserts copied bytes, distinct resource identity,
source reconnect, destination stop/resume, independent mutation, source cleanup
and restore from the retained snapshot after both original resources are gone.
It removes only resources it created. The saved red result captures the restart
failure before the stop fix.

The first provider run used SDK 0.5.5. The same actual provider lifecycle then
passed with ChatJS's installed 0.6.18 SDK. The package now declares and installs
0.6.18, with optional peer range `^0.6.18`; it does not retain a 0.5 compatibility
branch. `microsandbox-sdk0618-result.txt` records the repeated run using the newly
aligned package dependency, with the loaded SDK version printed by the probe.
Development cleanup now traverses the SDK's paginated list builder and validates
exact provider/development-run labels before touching returned resources.

The saved `microsandbox-result.txt` records a passing actual-provider run after
the shutdown fix. The affected provider/access suites pass 49 unit tests; package
TypeScript, targeted lint, docs validation and build pass. The stop regression was
run red before the fix. The temporary probe's remaining VMs were cleaned up.

The local owner slice now covers serialization, active-work exclusion, named
checkpoint rejection, exact turn boundaries, history restoration and source
authorization in actual in-memory owner integration tests. Imported-message forks
retain the trusted seed privately and restore only an exact user-message prefix,
without decoding display history or replaying historical tools. The dedicated
required checkpoint hook propagates app persistence failures before readiness;
ordinary event hooks still log failures and continue. The actual ChatJS hook is
separately verified against PGlite, including immutable document manifests on retry.
Combined owner/provider resource restoration and abrupt process restart remain
unproven; these tests do not expand the provider probe's evidence boundary. Admission is app-owned; permanently unknown sends are accepted and never automatically resent. No complete-copy or
deployment readiness claim follows from the resource tests.

SDK-alignment validation: 23 affected runtime/cleanup unit tests and package
TypeScript pass, including later-page cleanup and foreign-owner exclusion. The
confirmed-shutdown wait remains the provider's stop contract; it is not a
version-dependent compatibility path. No app dependency change or production
cutover was made.

Owner-slice validation: 59 affected request, reducer and hook unit tests plus 17
owner, seed and hook-lifecycle integration tests pass. Package TypeScript, targeted
lint, documentation and framework invariant checks pass. Changed extension
capability epochs are regenerated with fresh-start requirements; no new legacy
compatibility fixtures were added.
