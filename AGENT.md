# AGENT DEVELOPMENT CONTEXT — Junando

"Junar" = to observe (Rioplatense lunfardo). This is an AIOps incident intelligence agent.

## Architecture: Hexagonal (Ports & Adapters) + DDD

packages/core/src/
├── domain/
│   ├── entities/       ← Alert, Cluster, Incident (Zod schemas + types)
│   ├── value-objects/  ← Fingerprint (immutable, hash-based)
│   ├── ports/          ← IDeduplicationStore, ITraceRepository, ILLMProvider, INotifier
│   └── services/       ← ClusteringService (pure, no I/O)
├── application/
│   ├── use-cases/      ← ProcessIncidentUseCase (orchestrates via ports)
│   └── dtos/           ← normalizePayload (Alertmanager → domain entity)
├── infrastructure/     ← concrete adapter implementations
│   ├── dedup/          ← RedisDeduplicationStore, InMemoryDeduplicationStore
│   ├── traces/         ← LokiTraceRepository, MockTraceRepository
│   ├── llm/            ← GeminiProvider, ClaudeProvider, MockLLMProvider
│   └── notifier/       ← SlackNotifier, ConsoleNotifier
└── shared/
    ├── config/         ← loadConfig() — fails fast on missing env vars
    └── logger/         ← createLogger() — Pino structured JSON

## Hard Rules
- domain/ has ZERO external imports (no AWS SDK, no Redis, no HTTP clients)
- application/ imports only domain ports and entities — never concrete adapters
- infrastructure/ imports domain ports to implement them
- Swap any adapter without touching domain or application code
- Pipeline: Webhook → Dedup → Cluster → Extract → LLM → Notify
- Webhook always returns 200 in <50ms
- LLM always returns structured JSON (LLMAnalysisSchema)
- Fail gracefully: Loki down → continue; LLM down → notify without diagnosis
- No autonomous destructive actions
