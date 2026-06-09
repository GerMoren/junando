import type { NormalizedAlert } from '../entities/alert.js';
import type { AlertCluster } from '../entities/cluster.js';
import type { LLMAnalysis } from '../entities/incident.js';
import type { RuleAction } from '../entities/rule.js';

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
  isNew(fingerprint: string, ttlSeconds: number): Promise<boolean>;
  reset(fingerprint: string): Promise<void>;
}

/**
 * Alert queue.
 * Publishes normalized alerts for async processing.
 * Implementations: SQSAlertQueue, BullMQAlertQueue, InMemoryAlertQueue (tests)
 */
export interface IAlertQueue {
  publish(alert: NormalizedAlert): Promise<void>;
}

/**
 * Trace repository.
 * Fetches distributed trace context by trace ID.
 * Implementations: LokiTraceRepository, DatadogTraceRepository, MockTraceRepository (tests)
 */
export interface ITraceRepository {
  findByTraceId(traceId: string): Promise<Record<string, unknown>[]>;
}

/**
 * LLM provider.
 * Analyzes an incident cluster and returns a structured diagnosis.
 * Implementations: GeminiProvider, ClaudeProvider, OpenAIProvider, MockLLMProvider (tests)
 */
export interface ILLMProvider {
  analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMAnalysis>;
}

/**
 * Notifier.
 * Delivers incident diagnoses to a ChatOps channel.
 * Implementations: SlackNotifier, TeamsNotifier, ConsoleNotifier (local dev/tests)
 */
export interface INotifier {
  /**
   * Deliver an incident diagnosis to a ChatOps channel.
   * @param channel — optional channel override for multi-channel routing.
   *   When provided, implementations MAY route to the specified channel
   *   instead of their default. Backward-compatible — existing call sites
   *   work unchanged.
   */
  send(cluster: AlertCluster, analysis: LLMAnalysis | null, channel?: string): Promise<void>;
}

/**
 * Indexer.
 * Persists a typed document into a searchable index/store.
 * Implementations: OpenSearchIndexer, InMemoryIndexer (tests)
 */
export interface IIndexer<TDocument> {
  index(doc: TDocument): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule engine — evaluate rules at pipeline hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of rule engine evaluation.
 */
export interface RuleActionResult {
  suppressed: boolean; // true = don't proceed to next stage
  actions: RuleAction[]; // actions to execute
  matchedRuleId?: string; // which rule matched (for debugging)
  tags: Record<string, string>; // tags to attach to cluster
}

/**
 * Rule engine port — evaluates rules at pipeline hooks.
 */
export interface IRuleEngine {
  /**
   * PRE-LLM: evaluated after dedup, before LLM.
   * Returns actions to apply, or suppressed=true if should not proceed.
   */
  evaluatePreLlm(cluster: AlertCluster): RuleActionResult;

  /**
   * POST-LLM: evaluated after LLM analysis.
   * Returns additional actions based on analysis (escalate, tag, etc.).
   */
  evaluatePostLlm(cluster: AlertCluster, analysis: LLMAnalysis): RuleActionResult;
}
