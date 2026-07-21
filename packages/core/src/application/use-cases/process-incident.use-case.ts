import type { NormalizedAlert } from '../../domain/entities/alert.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import { RuleActionType } from '../../domain/entities/rule.js';
import type {
  IDeduplicationStore,
  ILLMProvider,
  INotifier,
  IRuleEngine,
  ITraceRepository,
} from '../../domain/ports/index.js';
import { NotifyOutcome } from '../../domain/ports/index.js';
import { ClusteringService } from '../../domain/services/clustering.service.js';
import type { Logger } from '../../shared/logger/index.js';
import {
  Component,
  Outcome,
  WideEventBuilder,
  redact,
  shouldSample,
} from '../../shared/logger/index.js';
import type { ErrorSection, WideEvent } from '../../shared/logger/index.js';
import { dedupNew, dedupDuplicate, suppressedClusters } from '../../shared/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// ProcessIncidentUseCase — Application layer.
// Orchestrates the full pipeline using only domain interfaces (ports).
// Never imports a concrete infrastructure class directly.
//
// Observability: exactly ONE wide event per processed cluster. Stage results
// accumulate into a WideEventBuilder; a single redacted, tail-sampled line is
// emitted at the end of each cluster. Duplicates emit nothing (only metrics).
// ─────────────────────────────────────────────────────────────────────────────

/** Source label for dedup counter metrics. */
const DEDUP_METRIC_SOURCE = 'alertmanager';

interface Dependencies {
  dedup: IDeduplicationStore;
  traces: ITraceRepository;
  llm: ILLMProvider;
  notifier: INotifier;
  logger: Logger;
  dedupTtlSeconds: number;
  clustering?: ClusteringService;
  onClustersBuilt?: (count: number) => void;
  ruleEngine?: IRuleEngine;
}

function toErrorSection(err: unknown): ErrorSection {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      ...(err.stack !== undefined && { stack: err.stack }),
    };
  }
  return { message: String(err) };
}

interface OutcomeSignals {
  llmError: unknown | null;
  notifyError: unknown | null;
}

/**
 * Terminal outcome for a processed cluster. Early returns — no switch/case.
 * Notify failure is fatal (the batch is retried via SQS); LLM failure is
 * degraded (notification still went out without a diagnosis).
 */
function resolveOutcome({ llmError, notifyError }: OutcomeSignals): Outcome {
  if (notifyError != null) return Outcome.Error;
  if (llmError != null) return Outcome.Degraded;
  return Outcome.Success;
}

export class ProcessIncidentUseCase {
  private readonly clustering: ClusteringService;
  private readonly wideEventsEnabled: boolean;

  constructor(private readonly deps: Dependencies) {
    this.clustering = deps.clustering ?? new ClusteringService();
    this.wideEventsEnabled = process.env['WIDE_EVENTS_ENABLED'] !== 'false';
  }

  async execute(alerts: NormalizedAlert[], correlationId: string): Promise<void> {
    const { dedup, traces, llm, notifier, dedupTtlSeconds, ruleEngine } = this.deps;

    // 1. Cluster alerts by fingerprint. The entry point (worker) owns the
    // batch-level wide event; this use case owns one event per cluster.
    const clusters = this.clustering.buildClusters(alerts);
    this.deps.onClustersBuilt?.(clusters.length);

    for (const cluster of clusters) {
      const clusterStartMs = Date.now();
      const builder = new WideEventBuilder(
        `${correlationId}:${cluster.fingerprint}`,
        Component.UseCase,
      )
        .set('correlationId', correlationId)
        .set('cluster', {
          fingerprint: cluster.fingerprint,
          serviceName: cluster.serviceName,
          alertCount: cluster.alertCount,
          spanCount: 0,
        });

      // 2. Deduplicate — skip if seen recently
      const dedupResult = await dedup.isNew(cluster.fingerprint, dedupTtlSeconds);
      builder.set('dedup', {
        isNew: dedupResult.isNew,
        ttlSeconds: dedupResult.ttlSeconds,
        ...(dedupResult.error !== undefined && { error: dedupResult.error }),
      });
      if (!dedupResult.isNew) {
        dedupDuplicate.inc({ source: DEDUP_METRIC_SOURCE });
        continue; // Spec: one wide event per NON-DUPLICATE cluster — emit nothing here.
      }
      dedupNew.inc({ source: DEDUP_METRIC_SOURCE });

      // 3. PRE-LLM rule engine hook — evaluate rules before LLM
      // ────────────────────────────────────────────────────────────────────
      let preLlmRouteChannels: string[] = [];
      let preLlmEscalateChannels: string[] = [];

      if (ruleEngine) {
        const preResult = ruleEngine.evaluatePreLlm(cluster);
        builder.set('rule', {
          matched: preResult.matchedRuleId != null,
          suppressed: preResult.suppressed,
          ...(preResult.matchedRuleId !== undefined && { matchedRuleId: preResult.matchedRuleId }),
        });

        if (preResult.suppressed) {
          if (preResult.matchedRuleId) {
            suppressedClusters.inc({ rule_id: preResult.matchedRuleId });
          }
          this.emit(builder, Outcome.Suppressed, clusterStartMs);
          continue; // Skip LLM, traces, and notification entirely
        }

        // Collect route and escalate channels from PRE-LLM actions
        for (const action of preResult.actions) {
          if (action.type === RuleActionType.Route && 'channel' in action) {
            preLlmRouteChannels.push(action.channel);
          }
          if (action.type === RuleActionType.Escalate && 'channel' in action) {
            preLlmEscalateChannels.push(action.channel);
          }
        }
      }

      // 4. Extract representative traces from the trace repository.
      // Per-trace failures fail open and are counted on the event instead of
      // being logged as scattered warn lines.
      let traceErrors = 0;
      const spanLists = await Promise.all(
        cluster.representativeTraceIds.map((id) =>
          traces.findByTraceId(id).catch(() => {
            traceErrors++;
            return [];
          }),
        ),
      );
      const allSpans = spanLists.flat();
      builder.set('cluster', {
        fingerprint: cluster.fingerprint,
        serviceName: cluster.serviceName,
        alertCount: cluster.alertCount,
        spanCount: allSpans.length,
        ...(traceErrors > 0 && { traceErrors }),
      });

      // 5. LLM inference — fail gracefully, notify anyway with null analysis
      let analysis: LLMAnalysis | null = null;
      let llmError: unknown | null = null;
      try {
        const llmResult = await llm.analyze(cluster, allSpans);
        analysis = llmResult.analysis;
        builder.set('llm', {
          provider: llmResult.provider,
          model: llmResult.model,
          latencyMs: llmResult.latencyMs,
          urgency: llmResult.analysis.urgency_level,
          tokens: llmResult.promptTokens + llmResult.completionTokens,
        });
      } catch (err) {
        llmError = err;
      }

      // 6. POST-LLM rule engine hook — evaluate rules after LLM analysis
      // ────────────────────────────────────────────────────────────────────
      let postLlmEscalateChannels: string[] = [];

      if (ruleEngine && analysis) {
        const postResult = ruleEngine.evaluatePostLlm(cluster, analysis);

        // Collect escalate channels from POST-LLM actions
        for (const action of postResult.actions) {
          if (action.type === RuleActionType.Escalate && 'channel' in action) {
            postLlmEscalateChannels.push(action.channel);
          }
        }

        // Apply tags from postResult to cluster
        if (postResult.tags && Object.keys(postResult.tags).length > 0) {
          cluster.labels = { ...cluster.labels, ...postResult.tags };
        }
      }

      // 7. Notify via ChatOps — with rule-based routing
      // ────────────────────────────────────────────────────────────────────
      const escalateChannels = [...preLlmEscalateChannels, ...postLlmEscalateChannels];
      const notifyStartMs = Date.now();
      try {
        const primaryChannel = preLlmRouteChannels[0]; // First route wins

        // Send primary notification (to route channel or default), then
        // escalation notifications (in addition to primary).
        const results = [await notifier.send(cluster, analysis, primaryChannel)];
        for (const channel of escalateChannels) {
          results.push(await notifier.send(cluster, analysis, channel));
        }

        builder.set('notify', {
          channels: results.flatMap((r) => r.channels),
          outcome: NotifyOutcome.Success,
          latencyMs: Date.now() - notifyStartMs,
        });
      } catch (err) {
        builder.set('notify', {
          channels: [...preLlmRouteChannels, ...escalateChannels],
          outcome: NotifyOutcome.Failure,
          latencyMs: Date.now() - notifyStartMs,
        });
        // The fatal error owns the error section (it triggers the SQS retry);
        // a prior LLM failure is shadowed here but already marked the event degraded-eligible.
        builder.set('error', toErrorSection(err));
        this.emit(builder, Outcome.Error, clusterStartMs);
        throw err; // let the worker retry via SQS
      }

      if (llmError != null) {
        builder.set('error', toErrorSection(llmError));
      }
      this.emit(builder, resolveOutcome({ llmError, notifyError: null }), clusterStartMs);
    }
  }

  /**
   * Flushes the builder into a final event, applies tail sampling, redacts
   * PII, and emits the single canonical log line for the cluster.
   */
  private emit(builder: WideEventBuilder, outcome: Outcome, startMs: number): void {
    if (!this.wideEventsEnabled) return;

    const event: WideEvent = builder
      .set('outcome', outcome)
      .set('durationMs', Date.now() - startMs)
      .flush();

    // Tail sampling: errors and slow events always survive; the rest ~5%.
    if (!shouldSample(event)) {
      return;
    }

    this.deps.logger.info(redact(event as unknown as Record<string, unknown>));
  }
}
