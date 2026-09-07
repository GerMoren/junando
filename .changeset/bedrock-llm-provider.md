---
"@junando/core": minor
---

Add Bedrock LLM provider (`LLM_PROVIDER=bedrock`), using AWS Bedrock Runtime's Converse API with IAM/role-based auth instead of an API key. Extends `LlmDegradedReason` with `provider_unavailable` for Bedrock's transient throttling/unavailability errors.
