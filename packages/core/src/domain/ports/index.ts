import type { NormalizedAlert } from '../entities/alert.js'
import type { AlertCluster } from '../entities/cluster.js'
import type { LLMAnalysis } from '../entities/incident.js'

// ─────────────────────────────────────────────────────────────────────────────
// PORTS — interfaces defined by the domain.
// The domain owns these. Infrastructure implements them.
// Never import a concrete class in this file.
//
// Swapping Redis for DynamoDB   = new IDeduplicationStore adapter
// Swapping Loki for Datadog     = new ITraceRepository adapter
// Swapping Gemini for Claude    = new ILLMProvider adapter
// Swapping Slack for Teams      = new INotifier adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deduplication store.
 * Determines whether an alert fingerprint is new within a rolling TTL window.
 * Implementations: RedisDeduplicationStore, InMemoryDeduplicationStore (tests)
 */
export interface IDeduplicationStore {
  isNew(fingerprint: string, ttlSeconds: number): Promise<boolean>
  reset(fingerprint: string): Promise<void>
}

/**
 * Alert queue.
 * Publishes normalized alerts for async processing.
 * Implementations: SQSAlertQueue, BullMQAlertQueue, InMemoryAlertQueue (tests)
 */
export interface IAlertQueue {
  publish(alert: NormalizedAlert): Promise<void>
}

/**
 * Trace repository.
 * Fetches distributed trace context by trace ID.
 * Implementations: LokiTraceRepository, DatadogTraceRepository, MockTraceRepository (tests)
 */
export interface ITraceRepository {
  findByTraceId(traceId: string): Promise<Record<string, unknown>[]>
}

/**
 * LLM provider.
 * Analyzes an incident cluster and returns a structured diagnosis.
 * Implementations: GeminiProvider, ClaudeProvider, OpenAIProvider, MockLLMProvider (tests)
 */
export interface ILLMProvider {
  analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis>
}

/**
 * Notifier.
 * Delivers incident diagnoses to a ChatOps channel.
 * Implementations: SlackNotifier, TeamsNotifier, ConsoleNotifier (local dev/tests)
 */
export interface INotifier {
  send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void>
}
