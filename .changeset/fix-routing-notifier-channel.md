---
'@junando/core': patch
---

Honour the `channel` argument in `RoutingNotifier.send`. The method previously declared only `(cluster, analysis)`, silently discarding the third parameter that `INotifier` declares and that `ProcessIncidentUseCase` passes when a rule Route action applies — so every notification went to the default notifier. It now resolves the channel against the `ChannelRegistry` and returns that notifier's `NotifyResult`, which also makes the wide event report the channel actually notified.

Channel resolution failure and delivery failure are no longer conflated: an unregistered channel still falls back to the default, but a delivery error now propagates so the use case can mark the notification failed and let SQS retry.

`createNotifier` also reports, at startup, any channel referenced by a rule that has no registered notifier and will therefore fall back to the default. Refs #294.
