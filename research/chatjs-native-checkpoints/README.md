# Immutable checkpoint resources

This slice adds the resource boundary needed by the pending native conversation
checkpoint implementation. It does not expose a working conversation fork route.

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

The package's 0.5.5 SDK is the dependency used here. ChatJS currently installs
0.6.18; this does not establish its compatibility. Local SDK 0.6.18 was separately
probed for basic snapshot isolation and absence of source environment inheritance,
but that SDK-only probe is not native provider evidence.

The saved `microsandbox-result.txt` records a passing actual-provider run after
the shutdown fix. The affected provider/access suites pass 49 unit tests; package
TypeScript, targeted lint, docs validation and build pass. The stop regression was
run red before the fix. The temporary probe's remaining VMs were cleaned up.

Owner serialization, active-work exclusion, named checkpoint rejection, exact
turn boundaries, history restoration and source authorization remain the next
runtime slice. Admission/recovery remains held separately. No complete-copy or
deployment readiness claim follows from the resource tests.
