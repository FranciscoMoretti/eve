---
issue: "https://github.com/FranciscoMoretti/chat-js/pull/447"
status: local-draft
last_updated: "2026-09-12"
---

# Durable message metadata

Applications need to recover a user message's original UI choices after later turns, reloads, copies, and edits. Authentication and turn-scoped model context do not represent that history.

Accept `messageMetadata?: JsonObject` with `client.sessions.create({ message, messageMetadata })`, `session.send(message, { messageMetadata })`, and their HTTP message bodies. Emit the object as `message.received.data.metadata`; the default reducer puts it in `EveMessage.metadata.custom`. Preserve explicit JSON null values. Omission means no metadata for that message, not inheritance from the preceding turn. Reject metadata on response-only HTTP requests.

This is application data, not an authorization assertion or framework metadata override. Never merge it into `turnId`, `status`, `modelId`, auth, or model prompts. Applications must validate their own namespace before interpreting it as a UI setting. Server-authorized transcript seed messages accept `metadata?: JsonObject` on either role; native seed and imported-prefix fork projections forward it into `metadata.custom` without adding it to model history. Ordinary checkpoint forks retain their existing event-prefix behavior.

Delivery coalescing already projects several inputs as one user message. That message receives the last contributing message's metadata, including omission clearing earlier metadata; control-only payloads do not replace it. This intentionally does not add multi-message events or an application event bus.

Inbox wire v8 declares this owned payload field and rejects metadata-bearing sends to older consumers. Stream v27 advertises the additive event field while retaining existing supported stream versions. Old messages need no migration and have no custom metadata.

Validation covers HTTP/schema rejection, SDK transport, durable inbox encode/decode, coalescing, harness events versus model history, reducer replay, seed projection and imported-prefix forks. The basic runtime fixture adds a CI-only wire/rewind regression. This remains an unpublished local draft; no issue, release, or production cutover is authorized.
