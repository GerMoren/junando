---
'@junando/core': patch
'@junando/ingest': patch
---

refactor: replace all switch/case with maps and FactoryRegistry.

Zero switch/case statements remaining in the codebase. Added FactoryRegistry generic class in shared/factory-registry.ts for adapter resolution. Refactored notifier factory, metric-to-alert.mapper evaluate() function, and sqs-subscriber test helpers to use map patterns instead of switch/case. Closes #137.