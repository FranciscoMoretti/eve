---
issue: "https://github.com/vercel/eve/issues/5340"
status: implemented
last_updated: 2026-11-08
---

# Structured history through the existing import API

Extend `onMessage.history` on upstream 1.0.0-rc.6 with `parts` as an
alternative to `text`, retaining the optional application message ID.
User parts contain text/files. Assistant parts additionally contain reasoning
text, completed tool exchanges, and step boundaries. Historical calls are data:
they neither execute tools nor grant live approval.

The native delivery history feeds model context and display. File references use
ordinary channel resolution, sandbox staging and hydration, including existing
fallback-to-note behavior. There is no separate seed callback, seed-only create,
operation lookup, URL renewal, or attachment storage contract.

The app owns source authorization, immutable prefix capture, resource ownership,
operation fencing and display metadata. History comes from the trusted channel,
not directly from browser input. Unknown delivery never authorizes a resend.

History becomes visible when the first real message is consumed. ChatJS removes
standalone copy-before-message and creates edit/regenerate branches with their
first message. The old fork's `resolveSeed`, `seed: true`, seed metadata and
seed-specific attachment-path machinery are removed. Exact workspace paths,
byte retention and access checks remain application responsibilities.

Completed exchanges use `dynamic-tool` input parts and native tool display states.
Opaque provider reasoning signatures and rich binary tool outputs are outside
this change. The scoped-package alias patch remains separate distribution support.

Focused tests cover schema validation, completed exchanges, native projection and
attachment staging. Earlier local worker experimentation used a deterministic
model and just-bash sandbox, not production credentials; it is not a claim of
production validation. No experimental app or captured evidence is shipped here.
