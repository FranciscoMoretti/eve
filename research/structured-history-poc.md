---
issue: "Local prototype requested by maintainer; no issue posted"
status: prototype
last_updated: 2026-11-08
---

# Structured history through the existing import API

Throwaway proof on eve 1.0.0-rc.6 (`663640b`). No release or compatibility
commitment. Add `parts` as an alternative to `text` in `onMessage.history`,
with the existing optional app message ID. User parts are text/files. Assistant
parts additionally carry reasoning text, completed tool exchanges and step
boundaries. Historical calls do not execute or grant live approval.

The same native delivery history feeds the model and display. File URLs use the
existing channel resolver, sandbox staging and hydration, including native
fallback-to-note behavior. No seed callback, operation lookup, byte-retention
service, URL renewal or sandbox-copy contract is introduced.

The prototype's `dynamic-tool` input spelling matches the current ChatJS capture
shape; the native display is RC6 `tool` with completed/failed/rejected states.
Naming can be revised before proposing this API upstream. Opaque signed provider
reasoning and rich binary tool-result payloads are not supported by this sketch.

The app owns source authorization, immutable prefix capture, resource ownership,
operation fencing and IDs. This code accepts trusted channel history, not browser
history. It neither guarantees exactly-once delivery nor authorizes retry.

Empty HTTP create does not call `onMessage`; history remains invisible until a
real message consumes it. Preserve this for the experiment. If native pre-send
display is required, extend normal initialization using the same history type
and projector; do not restore the parallel seed lifecycle.

Verification: focused source tests plus a companion ChatJS API fixture on a real
local eve worker with deterministic model and just-bash sandbox. No production
ChatJS database or live model was used. Native file paths may change; exact
shared-workspace path and digest guarantees remain app-side decisions.
