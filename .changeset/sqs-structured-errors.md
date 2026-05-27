---
'@junando/ingest': patch
---

Emit structured errors with stack trace and step context in `SqsSubscriber`.

The 4 catch blocks now log via Pino's object-first contract (`logger.error({ err, step, ... }, msg)`) instead of string interpolation. The original `Error` instance reaches the log, so the stack trace is preserved and the failed step (`receive`, `delete`, `processMessage`, `index`) becomes a queryable field. Index failures were promoted from `warn` to `error` because a broken traceability chain is operationally severe. Closes #128.
