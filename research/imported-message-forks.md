---
issue: "https://github.com/FranciscoMoretti/chat-js/pull/447"
status: local-draft
last_updated: "2026-09-12"
---

# Imported message forks

Saved public transcripts contain no source execution checkpoints. A new owner needs to edit or regenerate their imported conversation without granting access to the publisher's private session state.

Extend the existing authorized fork reference with `{ sessionId, beforeMessageId }`, mutually exclusive with execution checkpoint coordinates. Resolve the selected imported user boundary from the source's immutable `history.seeded` projection, including when nested inside restored history. Use the same sanitized prefix for model history and display. Empty prefixes are valid; unknown IDs and assistant boundaries fail closed.

Start a fresh root conversation at native turn zero. Retain completed tool results as content, defer attachment staging under destination authorization, and never inherit a later sandbox. The host application owns document checkpoint mapping and model selection. Assistant seeds now retain a bounded, informational model reference through imported forks, without importing turn identities or changing model history. Applications can use this provenance when offering regeneration.

The implementation uses bounded stream reads and validates imported identities. Local native tests cover prefix exclusion, deferred files, malformed references, stalled streams, exact model/display agreement, and descendant forks. No issue or proposal has been published.
