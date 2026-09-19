---
"@junando/core": patch
---

Fix `loadSecretsFromSSM` calling `GetParametersCommand` with more than 10 parameter names, which AWS SSM rejects with a `ValidationException`. Switched to `GetParametersByPathCommand` (recursive, paginated), which has no name-count limit and no longer requires a hardcoded parameter list.
