# @junando/core

Core domain logic for the Junando alerting platform. Implements the full incident processing pipeline: receives normalized alerts, clusters them by root cause, deduplicates, fetches traces from Loki, analyzes with an LLM, and dispatches notifications to Slack or Teams.

## Installation

```bash
npm install @junando/core
# or
pnpm add @junando/core
```

## Architecture

Junando follows hexagonal architecture. `@junando/core` defines the domain model and ports — infrastructure adapters are provided out of the box but can be replaced with custom implementations.

```
NormalizedAlert[]
      ↓
ClusteringService       (pure, no I/O)
      ↓
AlertCluster[]
      ↓
ProcessIncidentUseCase  (orchestrates ports)
  ├── IDeduplicationStore  → RedisDeduplicationStore / InMemoryDeduplicationStore
  ├── ITraceRepository     → LokiTraceRepository / MockTraceRepository
  ├── ILLMProvider         → ClaudeProvider / GeminiProvider / MockLLMProvider
  ├── INotifier            → SlackNotifier / TeamsNotifier / ConsoleNotifier
  └── IIndexer             → OpenSearchIndexer / InMemoryIndexer
```

## Usage

```ts
import {
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  LokiTraceRepository,
  ClaudeProvider,
  SlackNotifier,
  InMemoryIndexer,
  loadConfig,
  createLogger,
} from '@junando/core'

const config = await loadConfig()
const logger = createLogger(config)

const useCase = new ProcessIncidentUseCase({
  deduplicationStore: new RedisDeduplicationStore(redisClient),
  traceRepository: new LokiTraceRepository(config.loki),
  llmProvider: new ClaudeProvider(config.llm),
  notifier: new SlackNotifier(config.slack),
  indexer: new InMemoryIndexer(),
  logger,
})

await useCase.execute(normalizedAlerts)
```

## Key Exports

### Domain types

| Export | Description |
|--------|-------------|
| `NormalizedAlert` | Source-agnostic canonical alert |
| `AlertCluster` | Group of alerts sharing the same root cause |
| `Fingerprint` | SHA-256 value object for grouping and deduplication |
| `AlertType` | Enum of supported alert categories |

### Use case

| Export | Description |
|--------|-------------|
| `ProcessIncidentUseCase` | Main pipeline orchestrator |
| `ClusteringService` | Pure clustering logic (no I/O) |

### Ports (interfaces)

`IAlertQueue`, `IDeduplicationStore`, `IIndexer`, `ILLMProvider`, `INotifier`, `ITraceRepository`

### Adapters

| Port | Implementations |
|------|----------------|
| `IDeduplicationStore` | `RedisDeduplicationStore`, `InMemoryDeduplicationStore` |
| `ITraceRepository` | `LokiTraceRepository`, `MockTraceRepository` |
| `ILLMProvider` | `ClaudeProvider`, `GeminiProvider`, `MockLLMProvider` |
| `INotifier` | `SlackNotifier`, `TeamsNotifier`, `ConsoleNotifier` |
| `IIndexer` | `OpenSearchIndexer`, `InMemoryIndexer` |

### Utilities

| Export | Description |
|--------|-------------|
| `loadConfig()` | Loads config from AWS SSM / environment |
| `createLogger()` | Structured logger (pino + Loki transport) |
| `normalizePayload()` | Converts `AlertmanagerPayload` → `NormalizedAlert[]` |
| `metrics` | Prometheus counters (prom-client) |

## Requirements

- Node.js >= 24
- Redis (for `RedisDeduplicationStore`)
- AWS credentials (for `ClaudeProvider` / `loadConfig` with SSM)

## License

Apache-2.0
