---
"eve": minor
---

Add a typed `audience(input)` hook to `defineChannel`; `metadata()` now contains custom fields only and the `ChannelAudienceMetadata` type is removed. The default eve channel classifies anonymous callers as public, `user`/`service`/`runtime` callers as private, other principal types as unknown, and trace policies receive durable channel, mode, environment, and principal-type context with public-or-development content defaults.
