---
"@junando/core": minor
---

Add `VercelGatewayProvider` — a new `ILLMProvider` implementation for [Vercel AI Gateway](https://vercel.com/ai-gateway)'s OpenAI-compatible endpoint. Set `LLM_PROVIDER=vercel-gateway` and `LLM_MODEL` to any Gateway model string (e.g. `anthropic/claude-3-5-haiku`, `alibaba/qwen-3-14b`) to use it. Unlike the other providers, there's no default model — Vercel AI Gateway's catalog is too broad for one sensible default, so `LLM_MODEL` is required.
