---
"@junando/core": patch
"@junando/webhook": patch
---

Remove `CLUSTER_WINDOW_MS`/`clusterWindowMs`. It was parsed into `Config` but never read anywhere — `ClusteringService.buildClusters` groups purely by fingerprint, with no time window. Documented-but-absent behavior is worse than no documentation, so the dead config field, its `.env.example`/Helm entries, and its tests are removed rather than left in place.
