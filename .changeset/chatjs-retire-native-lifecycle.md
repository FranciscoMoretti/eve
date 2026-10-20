---
"eve": minor
---

Remove the fork-only `manageLocalMicrosandboxResources` API and restore upstream eve 0.80.1 Microsandbox SDK and shutdown behavior. ChatJS must adopt its app-owned sandbox lifecycle before using this release; clean up existing native resources with the previous version and start with fresh worlds.
