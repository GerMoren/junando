---
'@junando/ingest': patch
---

Silence install-time `UNRESOLVED_IMPORT` warnings for `@junando/core` during the `prepare` (tsdown) build by marking it via `deps.neverBundle` only when core's `dist/` is not built yet; publish-time builds still bundle core as before. Path check is CWD-independent (`import.meta.url`). Refs #205.
